import type { Reporter, TestModule, TestRunEndReason } from "vitest/node";
import { relative } from "node:path";
import { readFile } from "node:fs/promises";
import { artifactFiles } from "../../scripts/artifact-files.mjs";
import { buildProvenance } from "./build-provenance";
import { completeCases, writeEvidence, type CaseResult } from "./evidence";
export default class RuntimeReporter implements Reporter {
  private start?: Awaited<ReturnType<typeof buildProvenance>>;
  async onTestRunStart() {
    this.start = await buildProvenance().catch(() => undefined);
  }
  async onTestRunEnd(
    modules: readonly TestModule[],
    errors: readonly unknown[],
    reason: TestRunEndReason,
  ) {
    const scope = process.env.THOLI_RUNTIME_SCOPE || "unit";
    const tests = modules.flatMap((m) => [...m.children.allTests()]);
    const cases: CaseResult[] = tests.map((t) => ({
      id: t.id,
      name: t.fullName,
      status: t.result().state,
    }));
    const end = await buildProvenance().catch(() => undefined);
    const passed =
      reason === "passed" &&
      !errors.length &&
      completeCases(
        tests.map((t) => t.id),
        cases,
      ) &&
      JSON.stringify(this.start) === JSON.stringify(end);
    const path =
      scope === "unit"
        ? "output/qa/unit.json"
        : scope === "nlp"
          ? "output/nlp/results.json"
          : `output/${scope}/runtime.json`;
    const previous =
      scope === "nlp" &&
      modules.some((module) => module.moduleId.endsWith("real-model.test.ts"))
        ? JSON.parse(await readFile(path, "utf8").catch(() => "{}"))
        : {};
    await writeEvidence(path, {
      ...previous,
      ...end,
      passed,
      evaluatedAt: new Date().toISOString(),
      totalTests: tests.length,
      cases,
      suites: modules
        .map((m) => relative(process.cwd(), m.moduleId).replaceAll("\\", "/"))
        .sort(),
      ...(scope !== "unit"
        ? { apiArtifactFiles: await artifactFiles("apps/api/dist") }
        : {}),
    });
  }
}
