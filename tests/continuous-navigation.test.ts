import { test, expect } from "vitest";
import { appFixture } from "./multi-app/fixtures";
import {
  advanceJourney,
  beginJourney,
} from "../packages/goal-planner/task-journey";
import { journeySchema, type SiteMemory } from "../packages/page-model";
import { searchRoute } from "../packages/goal-planner/route-graph";
import {
  appendLedger,
  returnPlan,
  suspendJourney,
} from "../packages/navigation-core/continuity";
import { interpretRequest } from "../packages/nlp/interpret";
import { needsVision, fuseVisual } from "../packages/vision/fusion";
import { OcrQueue } from "../packages/vision/queue";
import { NavigationCore } from "../packages/navigation-core";
import { SemanticIndex, MemoryDerivedStore } from "../packages/nlp/retrieval";
import {
  recordWorkflowAction,
  continueWorkflow,
} from "../packages/navigation-core/workflows";
import {
  recognitionInputSchema,
  validatePng,
  sameVisualStamp,
  type VisualObservation,
} from "../packages/vision/contracts";
const page = () => appFixture("github", "https://github.com");
test("80 verified interactions checkpoint without losing destination across serialized restart", () => {
  let journey = beginJourney(
    "Change language to Spanish",
    "https://github.com",
  );
  const p = page();
  for (let i = 0; i < 80; i++)
    journey = advanceJourney(
      journey,
      { ...p, stateKey: "s" + i },
      p.controls[0],
      "s" + (i - 1),
      500,
    );
  const restored = journeySchema.parse(JSON.parse(JSON.stringify(journey)));
  expect(restored.totalVerified).toBe(80);
  expect(restored.progress).toHaveLength(30);
  expect(restored.checkpoint?.count).toBe(75);
  expect(restored.checkpoint?.objective.value).toBe("Spanish");
  expect(restored.status).toBe("active");
  const request = interpretRequest("Change language to Spanish");
  const parked = suspendJourney(restored, request, p.origin, 7)!;
  expect(parked.request.status).toBe("paused");
  expect(request.status).not.toBe("paused");
  expect(parked.journey.goal).toBe(journey.goal);
});
test("observed routes longer than twelve steps continue under a bounded search budget", () => {
  const p = page();
  p.stateKey = "s0";
  p.controls[0].signature = "edge0";
  const memory: SiteMemory = {
    schemaVersion: 1,
    origin: p.origin,
    version: 234,
    lastSeen: Date.now(),
    pages: [],
    templates: [],
    transitions: Array.from({ length: 80 }, (_, i) => ({
      from: "s" + i,
      to: "s" + (i + 1),
      signature: "edge" + i,
      label: "Step " + i,
      evidence: "observed",
      active: true,
      lastVerified: Date.now(),
    })),
  };
  let result = searchRoute(
    p,
    memory,
    new Set(["s80"]),
    "fewest-clicks",
    Date.now(),
    5,
  );
  expect(result.status).toBe("pending");
  for (let i = 0; i < 30 && result.status === "pending"; i++)
    result = searchRoute(
      p,
      memory,
      new Set(["s80"]),
      "fewest-clicks",
      Date.now(),
      5,
    );
  expect(result.path).toHaveLength(80);
  p.controls[0].risk = "consequential";
  expect(searchRoute(p, memory, new Set(["s80"])).status).toBe("missing");
});
test("return routes traverse known predecessors without inventing reversible actions", () => {
  const p = page();
  p.controls[0].label = "New repository";
  p.stateKey = "home";
  let ledger = appendLedger([], p, 7, "homeDoc");
  p.controls[0].label = "Profile";
  p.stateKey = "profile";
  ledger = appendLedger(ledger, p, 7, "profileDoc");
  p.controls[0].label = "Security settings";
  p.stateKey = "security";
  ledger = appendLedger(ledger, p, 7, "securityDoc");
  const plan = returnPlan(p, "Help me create a new repository", ledger, 7)!;
  expect(plan.action).toMatchObject({
    kind: "history-back",
    expectedState: "profile",
  });
  expect(plan.status).not.toBe("completed");
  expect(returnPlan(p, "Buy a car", ledger, 7)).toBeUndefined();
  expect(
    returnPlan(p, "Help me create a repository", ledger, 7, ["repository"]),
  ).toBeUndefined();
  p.stateKey = "original";
  p.controls[0].label = "References";
  let sameDocument = appendLedger([], p, 7, "sameDoc");
  p.stateKey = "mutated";
  p.controls[0].label = "Help";
  sameDocument = appendLedger(sameDocument, p, 7, "sameDoc");
  expect(returnPlan(p, "Find References", sameDocument, 7)).toBeUndefined();
});
const visual = (): VisualObservation => ({
  requestId: crypto.randomUUID(),
  journeyId: crypto.randomUUID(),
  contextRevision: 0,
  documentId: "d",
  observationRevision: 1,
  viewportRevision: 2,
  captureId: crypto.randomUUID(),
  regions: [
    {
      text: "Deploy website",
      confidence: 97,
      box: { x: 20, y: 40, width: 130, height: 25 },
    },
  ],
  elapsedMs: 20,
  engine: "tesseract-6.0.1-eng-fast",
});
test("OCR is gated by route eligibility and never establishes completion or known effects", () => {
  const p = page();
  const base = {
    goal: "Deploy website",
    source: "semantics" as const,
    status: "unresolved" as const,
    confidence: 0,
    reason: "Missing",
    steps: [],
  };
  expect(needsVision({ ...base, issue: "no-match" })).toBe(true);
  for (const issue of ["ambiguous", "consequential", "unknown-effect"] as const)
    expect(needsVision({ ...base, issue })).toBe(false);
  expect(needsVision({ ...base, issue: "no-match" }, true)).toBe(false);
  const observation = visual(),
    plan = fuseVisual(
      p,
      observation,
      "deploy website",
      "Please deploy my website",
    )!;
  expect(plan.action).toMatchObject({ kind: "visual", risk: "unknown" });
  expect(plan.status).toBe("awaiting-choice");
  expect(plan.steps).toEqual([]);
  expect(
    fuseVisual(p, observation, "deploy website", "Deploy website", ["deploy"]),
  ).toBeUndefined();
  observation.regions.push({ ...observation.regions[0] });
  expect(
    fuseVisual(p, observation, "deploy website", "Deploy website"),
  ).toBeUndefined();
  expect(
    sameVisualStamp(observation, { ...observation, viewportRevision: 3 }),
  ).toBe(false);
});
test("OCR bounds reject mismatched dimensions and malformed PNGs", () => {
  const v = visual();
  const { regions, elapsedMs, engine, ...stamp } = v;
  expect(
    recognitionInputSchema.safeParse({
      ...stamp,
      image: "a",
      width: 4000,
      height: 4000,
      cssWidth: 100,
      cssHeight: 100,
    }).success,
  ).toBe(false);
  expect(() =>
    validatePng({
      ...stamp,
      image: btoa("not a png"),
      width: 100,
      height: 100,
      cssWidth: 100,
      cssHeight: 100,
    }),
  ).toThrow();
});
test("OCR queue replaces waiting captures and cancellation prevents stale delivery", async () => {
  let release: () => void = () => {};
  const seen: number[] = [];
  const queue = new OcrQueue<number, number>(async (input, signal) => {
    seen.push(input);
    if (input === 1) await new Promise<void>((r) => (release = r));
    signal.throwIfAborted();
    return input;
  });
  const first = queue.submit(1),
    second = queue.submit(2);
  const secondResult = second.catch((e) => e.message);
  const third = queue.submit(3);
  expect(await secondResult).toContain("replaced");
  release();
  expect(await first).toBe(1);
  expect(await third).toBe(3);
  expect(seen).toEqual([1, 3]);
});
test("GitHub creation holds the objective through menu, form, review and named arrival", async () => {
  const core = new NavigationCore(
    new SemanticIndex(
      {
        embed: async (texts) => texts.map(() => Array(384).fill(0)),
        dispose: async () => {},
      },
      new MemoryDerivedStore(),
    ),
  );
  const p = page(),
    text = 'Create a new repository called "demo" in owner "alice"';
  p.controls = [
    {
      ...p.controls[0],
      label: "Create new",
      signature: "create-menu",
      kind: "expand",
    },
  ];
  const input = (previous?: any) => ({
    requestId: previous?.requestId || crypto.randomUUID(),
    documentId: "d" + p.revision,
    revision: p.revision,
    text,
    observation: p,
    strategy: "fastest" as const,
    protocolVersion: 2 as const,
    contextRevision: previous?.workflow?.revision || 0,
    request: previous?.request,
    workflow: previous?.workflow,
  });
  let r = await core.plan(input());
  expect(r.workflow?.guideId).toBe("github.repository.create");
  expect(r.plan?.steps[0].label).toBe("Create new");
  r.workflow = recordWorkflowAction(r.workflow!, p.controls[0], true, p);
  p.revision++;
  p.fingerprint = "form";
  p.controls = [
    {
      ...p.controls[0],
      label: "Repository name",
      signature: "name",
      kind: "focus",
    },
  ];
  r = await core.plan(input(r));
  expect(r.plan?.status).not.toBe("completed");
  r.workflow = continueWorkflow(r.workflow!, coreGuide());
  p.revision++;
  p.fingerprint = "review";
  p.controls = [
    {
      ...p.controls[0],
      label: "Create repository",
      signature: "commit",
      kind: "action",
      risk: "consequential",
    },
  ];
  r = await core.plan(input(r));
  expect(r.workflow?.status).toBe("review");
  r.workflow = recordWorkflowAction(r.workflow!, p.controls[0]);
  p.revision++;
  p.fingerprint = "done";
  p.controls = [];
  p.signals = [
    {
      kind: "arrival",
      subject: "alice / wrong-repo",
      text: "alice / wrong-repo",
      revision: p.revision,
    },
  ];
  r = await core.plan(input(r));
  expect(r.plan?.status).not.toBe("completed");
  p.revision++;
  p.fingerprint = "requested";
  p.signals = [
    {
      kind: "arrival",
      subject: "alice / demo",
      text: "alice / demo",
      revision: p.revision,
    },
  ];
  r = await core.plan(input(r));
  expect(r.plan?.status).not.toBe("completed");
  p.revision++;
  p.fingerprint = "creation-receipt";
  p.signals = [
    {
      kind: "created-item",
      subject: "alice / demo",
      text: "Repository successfully created",
      revision: p.revision,
    },
  ];
  r = await core.plan(input(r));
  expect(r.plan?.status).toBe("completed");
});
import { workflowGuides } from "../packages/navigation-core/guides";
const coreGuide = () =>
  workflowGuides.find((g) => g.id === "github.repository.create")!;
