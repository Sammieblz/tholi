import { test, expect, beforeAll, afterAll } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import os from "node:os";
import { MiniLM, SemanticIndex, MemoryDerivedStore } from "../../packages/nlp";
import { NavigationCore } from "../../packages/navigation-core";
import { appFixture } from "./fixtures";
import { buildProvenance } from "../support/build-provenance";
const model = new MiniLM(resolve("assets/models") + "/"),
  storage = new MemoryDerivedStore(),
  core = new NavigationCore(new SemanticIndex(model, storage));
beforeAll(async () => {
  await model.embed(["offline multi-app startup"]);
});
afterAll(async () => {
  await model.dispose();
});
test("frozen 360-case real-model benchmark reports per-platform held-out precision and coverage", async () => {
  const before = await buildProvenance(),
    bytes = await readFile("tests/multi-app/corpus.json"),
    corpus = JSON.parse(bytes.toString()),
    rows: any[] = [];
  expect(corpus.cases).toHaveLength(360);
  expect(createHash("sha256").update(bytes).digest("hex")).toBe(
    (await readFile("tests/multi-app/corpus.sha256", "utf8")).trim(),
  );
  for (const c of corpus.cases) {
    const observation = appFixture(
        c.platform,
        c.origin,
        c.category === "ambiguous",
      ),
      input = {
        requestId: crypto.randomUUID(),
        documentId: "fixture",
        revision: observation.revision,
        observation,
        text: c.text,
        strategy: "fastest" as const,
        protocolVersion: 2 as const,
        contextRevision: 0,
      };
    let prior;
    if (c.prior) prior = await core.plan({ ...input, text: c.prior });
    const result = await core.plan({
      ...input,
      workflow: prior?.workflow,
      context: prior ? { target: prior.request!.tasks[0].target } : undefined,
    });
    const selected =
      result.plan?.steps[0]?.label ||
      (result.workflow?.status === "review"
        ? result.workflow.pendingAction?.label
        : undefined);
    const correct =
      c.category === "positive"
        ? selected === c.expected && result.plan?.status === "guiding"
        : c.category === "ambiguous"
          ? result.status === "clarification"
          : !selected && result.status === "unsupported";
    rows.push({
      ...c,
      selected,
      status: result.status,
      planStatus: result.plan?.status,
      guide: result.workflow?.guideId,
      correct,
      falseCompletion: result.plan?.status === "completed",
      boundaryBypass:
        result.workflow?.status === "review" && !!result.plan?.steps.length,
    });
  }
  const platforms = Object.fromEntries(
    [...new Set<string>(rows.map((r) => r.platform))].map((platform) => {
      const held = rows.filter(
          (r) => r.platform === platform && r.split === "held-out",
        ),
        accepted = held.filter((r) => r.selected),
        positives = held.filter((r) => r.category === "positive");
      return [
        platform,
        {
          cases: held.length,
          accepted: accepted.length,
          precision:
            accepted.filter((r) => r.correct).length /
            Math.max(1, accepted.length),
          coverage:
            positives.filter((r) => r.correct).length / positives.length,
          clarification: held.filter(
            (r) => r.category === "ambiguous" && r.correct,
          ).length,
          unsupported: held.filter(
            (r) => r.category === "unsupported" && r.correct,
          ).length,
        },
      ];
    }),
  );
  const passed =
    Object.values(platforms).every(
      (p: any) => p.precision >= 0.95 && p.coverage >= 0.85,
    ) && rows.every((r) => !r.falseCompletion && !r.boundaryBypass);
  const after = await buildProvenance();
  expect(after).toEqual(before);
  await mkdir("output/multi-app", { recursive: true });
  await writeFile(
    "output/multi-app/model.json",
    JSON.stringify(
      {
        evaluatedAt: new Date().toISOString(),
        corpusSha256: createHash("sha256").update(bytes).digest("hex"),
        hardware: { cpu: os.cpus()[0].model, node: process.version },
        platforms,
        rows,
        passed,
        llmCalls: 0,
        embeddingActivity: core.index.activity,
        ...after,
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    JSON.stringify({
      platforms,
      passed,
      failures: rows
        .filter((r) => !r.correct)
        .map((r) => ({
          id: r.id,
          text: r.text,
          status: r.status,
          selected: r.selected,
          guide: r.guide,
        })),
    }),
  );
  expect(passed).toBe(true);
});
