import { beforeAll, afterAll, expect, test } from "vitest";
import { readFile, mkdir, writeFile, readdir, stat } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import {
  MiniLM,
  SemanticIndex,
  MemoryDerivedStore,
  cosine,
} from "../../packages/nlp";
import { NavigationCore } from "../../packages/navigation-core";
import { planGoal } from "../../packages/goal-planner";
import { mergeObservation } from "../../packages/site-memory";
import { fixture } from "./fixtures";
const model = new MiniLM(resolve("assets/models") + "/");
const storage = new MemoryDerivedStore(),
  core = new NavigationCore(new SemanticIndex(model, storage));
const input = (
  text: string,
  page = fixture(),
  context?: { target: string },
) => ({
  requestId: crypto.randomUUID(),
  documentId: "fixture-document",
  revision: page.revision,
  observation: page,
  text,
  strategy: "fastest" as const,
  context,
});
let coldStartupMs = 0;
beforeAll(async () => {
  const started = performance.now();
  await model.embed(["offline startup"]);
  coldStartupMs = performance.now() - started;
});
afterAll(async () => {
  await model.dispose();
});
test("reported request paraphrases use actual targets and abstain when references are absent", async () => {
  const page = fixture();
  page.controls = page.controls.filter((c) =>
    ["References", "View history"].includes(c.label),
  );
  page.controls.push({
    ...page.controls[1],
    id: "w0000000000000000-70",
    signature: "privacy-policy",
    label: "Privacy policy",
    context: "Footer",
    destination: { origin: page.origin, path: "/privacy", key: "privacy" },
  });
  for (const [target, requests] of [
    [
      "References",
      [
        "Help me find references",
        "Please show me the references",
        "Could you help me find the references?",
        "I would like to read the references",
        "Where can I read the references?",
        "Where are the references?",
      ],
    ],
    [
      "Privacy policy",
      [
        "Could you show me the privacy policy?",
        "Help me find the privacy policy",
        "I would like to read the privacy policy",
        "Where can I read the privacy policy?",
        "Where is the privacy policy?",
        "Can you guide me to the privacy policy?",
      ],
    ],
  ] as const) {
    for (const text of requests) {
      const result = await core.plan(input(text, page));
      expect(result.plan?.status, text).toBe("guiding");
      expect(result.plan?.steps.at(-1)?.label, text).toBe(target);
      expect(result.request?.original).toBe(text);
      expect(result.activity.llmCalls).toBe(0);
    }
  }
  const absent = {
    ...page,
    controls: page.controls.filter((c) => c.label !== "References"),
  };
  for (const text of [
    "Help me find references",
    "Please show me the references",
    "Where are the references?",
  ]) {
    const result = await core.plan(input(text, absent));
    expect(result.status, text).toBe("unsupported");
    expect(result.plan?.steps || []).toEqual([]);
    expect(result.plan?.status).not.toBe("completed");
  }
});
test("real packaged q8 MiniLM produces normalized 384-dimensional CPU embeddings", async () => {
  const vectors = await model.embed([
    "Change the language to Spanish",
    "Switch the interface language",
    "Delete an account",
  ]);
  expect(vectors[0]).toHaveLength(384);
  expect(Math.abs(cosine(vectors[0], vectors[0]) - 1)).toBeLessThan(0.0001);
  expect(cosine(vectors[0], vectors[1])).toBeGreaterThan(
    cosine(vectors[0], vectors[2]),
  );
});
test("frozen 200-case hybrid acceptance and baseline comparison", async () => {
  const bytes = await readFile("tests/nlp/corpus.json");
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    (await readFile("tests/nlp/corpus.sha256", "utf8")).trim(),
  );
  const corpus = JSON.parse(bytes.toString()).cases;
  expect(corpus).toHaveLength(200);
  const rows: any[] = [];
  const latency: number[] = [];
  for (const c of corpus) {
    const page = fixture(c.duplicate),
      started = performance.now();
    const result = await core.plan(input(c.text, page, c.context));
    latency.push(performance.now() - started);
    const selected = page.controls.find(
      (v) => v.id === result.plan?.steps.at(-1)?.controlId,
    )?.label;
    const compoundTargets = [
      "Languages",
      "Appearance",
      "Contents",
      "Tools",
      "Settings",
      "Languages",
      "Appearance",
      "Search",
      "Contact",
      "Contents",
      "Spanish",
      "Languages",
      "Languages",
      "Languages",
      "Languages",
    ];
    const compoundIndex =
      c.category === "compound-context"
        ? Number(c.id.split("-").at(-1)) - 1
        : -1;
    const expectedTarget =
      compoundIndex >= 0 && compoundIndex < compoundTargets.length
        ? compoundTargets[compoundIndex]
        : ["queue", "reference", "clarification", "unsupported"].includes(
              c.expected,
            )
          ? undefined
          : c.expected;
    const correct =
      c.expected === "clarification"
        ? result.status === "clarification"
        : c.expected === "unsupported"
          ? result.status === "unsupported"
          : c.expected === "queue"
            ? result.request?.tasks.length === c.tasks &&
              selected === expectedTarget
            : c.expected === "reference"
              ? !!result.request?.tasks[0] &&
                !result.request.tasks[0].needsReference &&
                selected === expectedTarget
              : selected === c.expected;
    const baseline = planGoal(page, c.text);
    const query = (await model.embed([c.text]))[0];
    let top = "",
      score = -2;
    for (const control of page.controls) {
      const v = await core.index.vector(control.label);
      const s = cosine(query, v);
      if (s > score) {
        score = s;
        top = control.label;
      }
    }
    rows.push({
      id: c.id,
      split: c.split,
      category: c.category,
      text: c.text,
      expected: c.expected,
      expectedTarget,
      selected,
      status: result.status,
      correct,
      baseline: page.controls.find(
        (v) => v.id === baseline.steps.at(-1)?.controlId,
      )?.label,
      embeddingsOnly: top,
      completed: result.plan?.status === "completed",
      boundaryBypass:
        result.plan?.steps.some(
          (step) =>
            page.controls.find((v) => v.id === step.controlId)?.risk ===
            "consequential",
        ) || false,
    });
  }
  const held = rows.filter((r) => r.split === "held-out"),
    positive = held.filter((r) => r.category === "positive"),
    accepted = held.filter((r) => r.selected),
    precision =
      accepted.filter((r) => r.correct).length / Math.max(accepted.length, 1),
    coverage = positive.filter((r) => r.correct).length / positive.length;
  const ordered = latency.slice(1).sort((a, b) => a - b),
    p95 = ordered[Math.floor(ordered.length * 0.95)];
  const comparison = (field: string) => {
    const accepted = held.filter((r) => r[field]);
    return {
      accepted: accepted.length,
      precision:
        accepted.filter((r) => r[field] === r.expectedTarget).length /
        Math.max(1, accepted.length),
      supportedCoverage:
        positive.filter((r) => r[field] === r.expectedTarget).length /
        positive.length,
    };
  };
  async function size(dir: string): Promise<number> {
    let bytes = 0;
    for (const n of await readdir(dir)) {
      const p = dir + "/" + n,
        s = await stat(p);
      bytes += s.isDirectory() ? await size(p) : s.size;
    }
    return bytes;
  }
  const report = {
    evaluatedAt: new Date().toISOString(),
    hardware: {
      cpu: os.cpus()[0]?.model,
      logicalCPUs: os.cpus().length,
      platform: os.platform(),
      node: process.version,
    },
    precision,
    coverage,
    falseCompletions: held.filter((r) => r.completed).length,
    boundaryBypasses: held.filter((r) => r.boundaryBypass).length,
    coldStartupMs,
    coldIndexingMs: latency[0],
    warmP95Ms: p95,
    comparison: {
      baseline: comparison("baseline"),
      embeddingsOnly: comparison("embeddingsOnly"),
      hybrid: { precision, coverage },
    },
    memory: process.memoryUsage(),
    unpackedBytes: await size("dist/extension"),
    embeddingActivity: core.index.activity,
    llmCalls: 0,
    rows,
  };
  await mkdir("output/nlp", { recursive: true });
  await writeFile("output/nlp/results.json", JSON.stringify(report, null, 2));
  expect(precision).toBeGreaterThanOrEqual(0.95);
  expect(coverage).toBeGreaterThanOrEqual(0.85);
  expect(report.falseCompletions).toBe(0);
  expect(report.boundaryBypasses).toBe(0);
  expect(p95).toBeLessThan(750);
  expect(report.unpackedBytes).toBeLessThan(60 * 1024 * 1024);
});
test("semantic cache invalidates content independently of control state and model revision", async () => {
  const page = fixture();
  await core.plan(input("Open Languages", page));
  const first = core.index.activity.embedded;
  page.revision++;
  page.controls[2].visible = false;
  page.controls[2].risk = "consequential";
  await core.plan(input("Open Languages", page));
  expect(core.index.activity.embedded).toBe(first);
  page.controls[2].label = "Language selector renamed";
  page.revision++;
  await core.plan(input("Open Languages", page));
  expect(core.index.activity.embedded).toBeGreaterThan(first);
});
test("cancellation stops real model indexing between CPU calls", async () => {
  const controller = new AbortController();
  controller.abort();
  await expect(
    core.plan(input("Open Languages"), undefined, controller.signal),
  ).rejects.toThrow();
});
test("semantic retrieval cannot bypass a boundary or complete a search on focus", async () => {
  const page = fixture();
  page.controls[14].label = "Delete account";
  page.controls[14].risk = "consequential";
  page.controls[14].riskReason = "commit";
  const unsafe = await core.plan(input("Please open Delete account", page));
  expect(unsafe.plan?.steps).toEqual([]);
  expect(unsafe.plan?.issue).toBe("consequential");
  const headingPage = fixture();
  headingPage.controls = [
    {
      ...headingPage.controls[0],
      label: "Delete account",
      kind: "section",
      sectionVisible: true,
    },
  ];
  const heading = await core.plan(input("Delete account", headingPage));
  expect(heading.plan?.status).not.toBe("completed");
  expect(heading.plan?.issue).toBe("consequential");
  expect(heading.request?.status).toBe("blocked");
  const authHeadingPage = fixture();
  authHeadingPage.controls = [
    {
      ...authHeadingPage.controls[0],
      label: "Log in",
      kind: "section",
      sectionVisible: true,
    },
  ];
  const authHeading = await core.plan(input("How to log in", authHeadingPage));
  expect(authHeading.plan?.status).not.toBe("completed");
  expect(authHeading.request?.tasks[0].target).not.toBe("Log in");
  const negative = await core.plan(input("Don't log in", page));
  expect(negative.status).toBe("unsupported");
  expect(negative.plan?.steps || []).toEqual([]);
  const numbered = await core.plan(input("Please open Help 42", page));
  expect(numbered.plan?.steps || []).toEqual([]);
  const qualified = await core.plan(
    input("Please open red notifications", page),
  );
  expect(qualified.plan?.steps || []).toEqual([]);
  const togglePage = fixture();
  togglePage.controls = [
    {
      ...togglePage.controls[19],
      kind: "toggle",
      role: "switch",
      checked: false,
    },
  ];
  const disabled = await core.plan(
    input("Please turn notifications off", togglePage),
  );
  expect(disabled.request?.tasks[0].desiredValue).toBe("off");
  expect(disabled.plan?.status).toBe("completed");
  expect(disabled.plan?.steps).toEqual([]);
  const search = await core.plan(input("Please search for Saturn", page));
  expect(search.plan?.status).not.toBe("completed");
  expect(search.request?.tasks[0].desiredValue).toBe("Saturn");
  const task = search.request!;
  task.tasks[0].searchPhase = "results";
  page.revision++;
  const after = await core.plan({
    ...input(task.original, page),
    request: task,
  });
  expect(after.plan?.status).not.toBe("completed");
  expect(after.plan?.steps).toEqual([]);
});
test("clarification reuses original request and binds the selected current signature", async () => {
  const page = fixture("Settings");
  const first = await core.plan(input("Could you show me settings?", page));
  expect(first.clarification?.choices).toHaveLength(2);
  const choice = first.clarification!.choices.find((c) =>
    c.label.includes("Account"),
  )!;
  const next = await core.plan({
    ...input(first.request!.original, page),
    request: first.request,
    choice: choice.signature,
  });
  expect(next.request?.original).toBe(first.request?.original);
  expect(next.plan?.steps[0].controlId).toBe("w0000000000000000-40");
});
test("historical semantic targets require an observed route and a fresh ordinary first binding", async () => {
  const page = fixture();
  page.controls = [
    { ...page.controls[0], label: "Account", signature: "account-entry" },
  ];
  const destination = {
    ...page,
    stateKey: "billing",
    pageKey: "billing",
    controls: [
      {
        ...page.controls[0],
        id: "w0000000000000000-42",
        label: "Billing",
        signature: "billing-control",
        description: "Payment history and invoices",
      },
    ],
  };
  let memory = mergeObservation(undefined, page);
  memory = mergeObservation(memory, destination, {
    from: page.stateKey,
    to: destination.stateKey,
    signature: page.controls[0].signature,
    label: "Account",
  });
  const result = await core.plan(
    input("Can you help me find payment history?", page),
    memory,
  );
  expect(result.plan?.source).toBe("memory");
  expect(result.plan?.steps[0].controlId).toBe(page.controls[0].id);
  memory.transitions[0].active = false;
  const stale = await core.plan(
    input("Can you help me find payment history?", page),
    memory,
  );
  expect(stale.plan?.steps).toEqual([]);
  memory.transitions[0].active = true;
  page.controls[0].risk = "consequential";
  const unsafe = await core.plan(
    input("Can you help me find payment history?", page),
    memory,
  );
  expect(unsafe.plan?.steps).toEqual([]);
});
