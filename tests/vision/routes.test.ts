import { test, expect } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { MiniLM, SemanticIndex, MemoryDerivedStore } from "../../packages/nlp";
import { NavigationCore } from "../../packages/navigation-core";
import { appFixture } from "../multi-app/fixtures";
import { buildProvenance } from "../support/build-provenance";
test("frozen 64-case held-out requests preserve precision, supported coverage and clarification", async () => {
  const bytes = await readFile("tests/continuity/corpus.json"),
    sha256 = createHash("sha256").update(bytes).digest("hex");
  expect(sha256).toBe(
    (await readFile("tests/continuity/corpus.sha256", "utf8")).trim(),
  );
  const corpus = JSON.parse(bytes.toString());
  expect(corpus.cases).toHaveLength(64);
  const model = new MiniLM(resolve("assets/models") + "/"),
    core = new NavigationCore(
      new SemanticIndex(model, new MemoryDerivedStore()),
    );
  const rows: any[] = [];
  const timings: number[] = [];
  try {
    await model.embed(["warm planning"]);
    for (const c of corpus.cases) {
      const p = appFixture(
        c.platform,
        c.platform === "github"
          ? "https://github.com"
          : "https://dash.cloudflare.com",
      );
      p.controls = [
        {
          ...p.controls[0],
          label: c.platform === "github" ? "Create new" : "Workers & Pages",
          kind: "expand",
          context: "Global navigation",
          signature: "primary",
        },
        {
          ...p.controls[0],
          id: "w0000000000000000-1",
          label: "Settings",
          context: "Account",
          signature: "account",
        },
        {
          ...p.controls[0],
          id: "w0000000000000000-2",
          label: "Settings",
          context: "Workspace",
          signature: "workspace",
        },
      ];
      const start = performance.now();
      let r = await core.plan({
        requestId: crypto.randomUUID(),
        documentId: "heldout",
        revision: p.revision,
        text: c.text,
        observation: p,
        strategy: "fastest",
        protocolVersion: 2,
        contextRevision: 0,
      });
      const methodChoice = r.clarification?.choices.find(
        (c) => c.id === "workflow:method:git",
      );
      if (c.category === "supported" && methodChoice)
        r = await core.plan({
          requestId: r.requestId,
          documentId: "heldout",
          revision: p.revision,
          text: c.text,
          observation: p,
          strategy: "fastest",
          protocolVersion: 2,
          contextRevision: r.workflow?.revision || 0,
          request: r.request,
          workflow: r.workflow,
          choice: methodChoice.id,
        });
      timings.push(performance.now() - start);
      const target =
        r.plan?.status === "guiding" ? r.plan.steps[0]?.label : undefined;
      rows.push({
        ...c,
        actual: target,
        accepted: !!target,
        correct: c.expected ? target === c.expected : !target,
        clarificationUsed: !!methodChoice,
        reason: r.reason,
        falseCompletion: r.plan?.status === "completed",
      });
    }
  } finally {
    await model.dispose();
  }
  const platforms: any = {};
  let passed = true;
  for (const platform of ["github", "cloudflare"]) {
    const r = rows.filter((v) => v.platform === platform),
      accepted = r.filter((v) => v.accepted),
      positive = r.filter((v) => v.category === "supported"),
      precision = accepted.length
        ? accepted.filter((v) => v.correct).length / accepted.length
        : 0,
      coverage = positive.filter((v) => v.correct).length / positive.length;
    platforms[platform] = {
      precision,
      coverage,
      supported: positive.length,
      accepted: accepted.length,
    };
    passed &&=
      precision >= 0.95 &&
      coverage >= 0.85 &&
      r.every((v) => !v.falseCompletion && (!v.accepted || v.correct));
  }
  const report = {
    ...(await buildProvenance()),
    passed,
    corpusSha256: sha256,
    platforms,
    warmP95Ms: timings.sort((a, b) => a - b)[
      Math.ceil(timings.length * 0.95) - 1
    ],
    rows,
    authenticatedChecks: "pending",
  };
  await mkdir("output/vision", { recursive: true });
  await writeFile("output/vision/routes.json", JSON.stringify(report, null, 2));
  expect(
    passed,
    JSON.stringify(report.platforms) +
      " failures " +
      JSON.stringify(rows.filter((v) => !v.correct)),
  ).toBe(true);
});
