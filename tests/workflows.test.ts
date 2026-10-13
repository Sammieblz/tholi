import { test, expect } from "vitest";
import { NavigationCore, workflowGuides } from "../packages/navigation-core";
import { SemanticIndex, MemoryDerivedStore } from "../packages/nlp/retrieval";
import {
  recordWorkflowAction,
  continueWorkflow,
} from "../packages/navigation-core/workflows";
import {
  structuralObservation,
  parameterizedTask,
} from "../packages/navigation-core/privacy";
import { beginJourney, saveTask } from "../packages/goal-planner/task-journey";
import { fixture } from "./nlp/fixtures";
import type { PageSnapshot, PageControl } from "../packages/page-model";
import { interpretRequest } from "../packages/nlp/interpret";
import { advanceJourney } from "../packages/goal-planner/task-journey";
const embedder = {
  async embed(texts: string[]) {
    return texts.map(() =>
      Array.from({ length: 384 }, (_, i) => Number(i === 0)),
    );
  },
  async dispose() {},
};
const core = () =>
  new NavigationCore(new SemanticIndex(embedder, new MemoryDerivedStore()));
function page(origin: string, labels: string[], revision = 1): PageSnapshot {
  const p = fixture();
  return {
    ...p,
    origin,
    revision,
    fingerprint: "state-" + revision,
    stateKey: "state-" + revision,
    controls: labels.map((label, i) => ({
      ...p.controls[0],
      id: `w0000000000000000-${i}`,
      signature: label + "-" + revision,
      label,
      kind: "navigation",
      context: "",
      destination: undefined,
    })),
  };
}
const input = (
  text: string,
  p: PageSnapshot,
  extra: Record<string, unknown> = {},
) => ({
  requestId: crypto.randomUUID(),
  documentId: "doc",
  revision: p.revision,
  observation: p,
  text,
  strategy: "fastest" as const,
  protocolVersion: 2 as const,
  contextRevision: 0,
  ...extra,
});
test("a verified reveal retains the choice handoff instead of targeting a popup search field", async () => {
  const c = core(),
    p = fixture(),
    request = interpretRequest("Show languages");
  const opener = {
    ...p.controls[0],
    label: "37 languages",
    kind: "expand" as const,
    expanded: false,
  };
  p.controls = [opener];
  const started = beginJourney("languages", p.origin);
  started.requestTaskId = request.tasks[0].id;
  const opened = {
    ...p,
    revision: 2,
    stateKey: "opened",
    fingerprint: "opened",
    controls: [
      { ...opener, visible: false, occluded: true, expanded: true },
      {
        ...opener,
        id: "w1111111111111111-1",
        signature: "search-languages",
        label: "Search languages",
        kind: "focus" as const,
        visible: true,
        expanded: undefined,
      },
    ],
  };
  const journey = advanceJourney(started, opened, opener, p.stateKey, 10);
  const result = await c.plan(
    input(request.original, opened, { request, journey }),
  );
  expect(result.plan).toMatchObject({ status: "awaiting-choice", steps: [] });
  expect(result.request?.tasks[0].target).toBe("languages");
  expect(result.activity?.embedded).toBe(0);
  // A preference request without a value also needs the verified choice handoff.
  const preference = interpretRequest("Change language and then open Privacy");
  expect(preference.tasks[0].operation).toBe("choose");
  expect(preference.tasks[0].desiredValue).toBeUndefined();
  const preferenceResult = await c.plan(
    input(preference.original, opened, {
      request: preference,
      journey: { ...journey, requestTaskId: preference.tasks[0].id },
    }),
  );
  expect(preferenceResult.plan).toMatchObject({
    status: "awaiting-choice",
    steps: [],
  });
  expect(preferenceResult.request?.active).toBe(0);
  expect(preferenceResult.request?.tasks[1].status).toBe("pending");
  expect(preferenceResult.activity?.embedded).toBe(0);
  const queued = interpretRequest("Show languages and then choose Spanish");
  expect(queued.tasks).toHaveLength(2);
  const queuedResult = await c.plan(
    input(queued.original, opened, {
      request: queued,
      journey: { ...journey, requestTaskId: queued.tasks[0].id },
    }),
  );
  expect(queuedResult.plan?.status).toBe("completed");
  const closed = {
    ...opened,
    revision: 3,
    controls: [{ ...opener, visible: true, expanded: false }],
  };
  const replanned = await c.plan(
    input(request.original, closed, { request, journey }),
  );
  expect(replanned.plan?.status).toBe("guiding");
  expect(replanned.plan?.steps[0].controlId).toBe(opener.id);
});
test("guides are versioned documented milestones, never selector or URL scripts", () => {
  expect(new Set(workflowGuides.map((g) => g.platform)).size).toBe(6);
  for (const g of workflowGuides) {
    expect(g.sources.every((s) => s.sha256.length === 64)).toBe(true);
    for (const m of g.milestones)
      expect(Object.keys(m)).not.toEqual(
        expect.arrayContaining(["selector", "coordinates", "url"]),
      );
  }
});
test("Cloudflare clarification retains the sentence and binds the selected method to live controls", async () => {
  const c = core(),
    p = page("https://dash.cloudflare.com", ["Workers & Pages"]),
    first = await c.plan(input("Help me deploy a website with Pages", p));
  expect(first.status).toBe("clarification");
  expect(first.request?.original).toBe("Help me deploy a website with Pages");
  const result = await c.plan(
    input(first.request!.original, p, {
      request: first.request,
      workflow: first.workflow,
      choice: "workflow:method:git",
    }),
  );
  expect(result.workflow?.entities).toContainEqual({
    type: "method",
    value: "git",
    source: "clarification",
  });
  expect(result.plan?.steps[0].label).toBe("Workers & Pages");
  expect(result.request?.status).toBe("active");
});
test("an observed menu transition retains the objective and moves to the next milestone", async () => {
  const c = core(),
    p = page("https://dash.cloudflare.com", ["Workers & Pages"]),
    a = await c.plan(input("Deploy my Pages website from GitHub", p));
  const w = recordWorkflowAction(a.workflow!, p.controls[0], true, p),
    next = page(p.origin, ["Create application"], 2);
  next.controls[0].kind = "expand";
  next.controls[0].popup = "dialog";
  const b = await c.plan(
    input(a.request!.original, next, { request: a.request, workflow: w }),
  );
  expect(b.workflow?.objective).toBe(a.workflow?.objective);
  expect(b.plan?.steps[0].label).toBe("Create application");
  expect(b.workflow?.verified).toHaveLength(1);
});
test("opening an entity picker does not verify selection of a requested repository", async () => {
  const c = core(),
    p = page("https://dash.cloudflare.com", ["Repository"]);
  p.controls[0].kind = "expand";
  const a = await c.plan(
    input('Deploy Pages from GitHub repository "private-demo"', p),
  );
  expect(
    workflowGuides.find((g) => g.id === a.workflow?.guideId)?.milestones[
      a.workflow!.activeMilestone
    ].id,
  ).toBe("repository");
  const opened = recordWorkflowAction(a.workflow!, p.controls[0], true, p);
  expect(opened.activeMilestone).toBe(a.workflow!.activeMilestone);
  expect(opened.verified).toHaveLength(0);
  const next = page(p.origin, ["private-demo"], 2);
  next.controls[0].kind = "choice";
  next.controls[0].context = "Repository";
  const b = await c.plan(
    input(a.request!.original, next, { request: a.request, workflow: opened }),
  );
  expect(b.plan?.steps[0]?.label, JSON.stringify(b)).toBe("private-demo");
});
test("field focus and a manual input handoff never verify the supplied contents", async () => {
  const c = core(),
    p = page("https://team.atlassian.net", ["Summary"]);
  p.controls[0].kind = "focus";
  const a = await c.plan(input('Create an issue titled "Broken layout"', p));
  const focused = recordWorkflowAction(a.workflow!, p.controls[0], true, p);
  expect(focused.verified).toHaveLength(0);
  expect(focused.status).toBe("waiting");
  const advanced = continueWorkflow(
    focused,
    workflowGuides.find((g) => g.id === focused.guideId)!,
  );
  expect(advanced.verified).toHaveLength(0);
  expect(advanced.status).not.toBe("completed");
});
test("review never advances the task and stale or unrelated success cannot complete cancellation", async () => {
  const c = core(),
    p = page("https://www.netflix.com", ["Finish Cancellation"]);
  p.controls[0].kind = "action";
  p.controls[0].risk = "consequential";
  p.signals = [
    {
      kind: "status",
      subject: "Membership",
      text: "Membership canceled",
      revision: 1,
    },
  ];
  const a = await c.plan(input("Please cancel my Netflix membership", p));
  expect(a.workflow?.status).toBe("review");
  expect(a.plan?.status).not.toBe("completed");
  expect(a.request?.active).toBe(0);
  const acted = recordWorkflowAction(a.workflow!, p.controls[0]);
  const next = {
    ...p,
    revision: 2,
    fingerprint: "different",
    signals: [
      ...p.signals!,
      {
        kind: "status" as const,
        subject: "Profile",
        text: "Saved successfully",
        revision: 2,
      },
    ],
  };
  const stale = await c.plan(
    input(a.request!.original, next, { request: a.request, workflow: acted }),
  );
  expect(stale.plan?.status).not.toBe("completed");
  next.signals = [
    {
      kind: "status",
      subject: "Membership",
      text: "Cancellation confirmed. Membership ends tomorrow",
      revision: 2,
    },
  ];
  const done = await c.plan(
    input(a.request!.original, next, { request: a.request, workflow: acted }),
  );
  expect(done.plan?.status).toBe("completed");
  expect(done.workflow?.verified.at(-1)?.evidence.kind).toBe("status");
});
test("a failed deployment remains incomplete and a missing target has no invented step", async () => {
  const c = core(),
    p = page("https://dash.cloudflare.com", ["Deploy site"]);
  p.controls[0].kind = "action";
  p.controls[0].risk = "consequential";
  const a = await c.plan(
    input("Deploy Pages using prebuilt files for project named demo", p),
  );
  const acted = recordWorkflowAction(a.workflow!, p.controls[0]);
  const after = {
    ...p,
    revision: 2,
    fingerprint: "failed",
    signals: [
      {
        kind: "failure" as const,
        subject: "demo",
        text: "Deployment failed",
        revision: 2,
      },
    ],
  };
  const result = await c.plan(
    input(a.request!.original, after, { request: a.request, workflow: acted }),
  );
  expect(result.workflow?.status).toBe("failed");
  expect(result.plan?.status).not.toBe("completed");
  const absent = await c.plan(
    input(
      "Cancel my Prime membership",
      page("https://www.amazon.com", ["Help"]),
    ),
  );
  expect(absent.plan?.steps).toEqual([]);
  expect(absent.status).toBe("unsupported");
});
test("corrections replace the entity and invalidate its dependent milestones", async () => {
  const c = core(),
    p = page("https://dash.cloudflare.com", ["Repository"]);
  p.controls[0].kind = "expand";
  const a = await c.plan(
    input('Deploy Pages from GitHub repository "old-demo"', p),
  );
  const b = await c.plan(
    input('Actually use repository "new-demo" instead', p, {
      workflow: a.workflow,
    }),
  );
  expect(b.workflow?.entities.find((e) => e.type === "repository")?.value).toBe(
    "new-demo",
  );
  expect(b.workflow?.pendingAction?.label).toBe("Repository");
  expect(b.workflow?.status).not.toBe("completed");
});
test("named references carry only compatible session entities", async () => {
  const c = core(),
    p = page("https://dash.cloudflare.com", ["Workers & Pages"]);
  const a = await c.plan(
    input('Deploy Pages from GitHub repository "private-demo"', p),
  );
  const b = await c.plan(
    input("Deploy Pages from GitHub using that repository", p, {
      workflow: a.workflow,
    }),
  );
  expect(
    b.workflow?.entities.find((e) => e.type === "repository")?.value,
    JSON.stringify(b),
  ).toBe("private-demo");
});
test("persistent knowledge and routes contain no private names or user values", async () => {
  const p = page("https://github.com", ["Settings", "private-repository"]);
  p.controls[0].context = "private-repository";
  const clean = structuralObservation(p);
  expect(JSON.stringify(clean)).not.toContain("private-repository");
  expect(clean.controls.map((c) => c.label)).toEqual(["Settings"]);
  const c = core();
  await c.index.rank(p, {
    ...(await import("../packages/nlp/interpret")).interpretRequest(
      "Find private-repository",
    ).tasks[0],
  });
  const store = (c.index as unknown as { storage: MemoryDerivedStore }).storage;
  expect(JSON.stringify([...store.indexes.values()])).not.toContain(
    "private-repository",
  );
  const task = parameterizedTask(
    saveTask(beginJourney("Open private-repository", p.origin)),
  );
  expect(JSON.stringify(task)).not.toContain("private-repository");
});
test("explicit exclusions block guide targets and Workers is never silently substituted with Pages", async () => {
  const c = core(),
    p = page("https://www.netflix.com", ["Account"]);
  const a = await c.plan(
    input("Cancel my membership but do not open Account", p),
  );
  expect(a.plan?.steps).toEqual([]);
  const b = await c.plan(
    input(
      "Deploy a Cloudflare Worker",
      page("https://dash.cloudflare.com", ["Workers & Pages"]),
    ),
  );
  expect(b.workflow).toBeUndefined();
  expect(b.plan?.status).not.toBe("completed");
});
