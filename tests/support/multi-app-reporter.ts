import type { Reporter, TestModule, TestRunEndReason } from "vitest/node";
import { mkdir, writeFile } from "node:fs/promises";
import { artifactFiles } from "../../scripts/artifact-files.mjs";
import { buildProvenance } from "./build-provenance";
export default class MultiAppReporter implements Reporter {
  private start?: Awaited<ReturnType<typeof buildProvenance>>;
  async onTestRunStart() {
    this.start = await buildProvenance();
  }
  async onTestRunEnd(
    modules: readonly TestModule[],
    errors: readonly unknown[],
    reason: TestRunEndReason,
  ) {
    const end = await buildProvenance(),
      tests = modules.flatMap((m) => [...m.children.allTests()]),
      apiArtifactFiles = await artifactFiles("apps/api/dist");
    const suites = modules.map((m) =>
      m.moduleId.replaceAll("\\", "/").split("/").at(-1),
    );
    await mkdir("output/multi-app", { recursive: true });
    await writeFile(
      "output/multi-app/runtime.json",
      JSON.stringify(
        {
          ...end,
          evaluatedAt: new Date().toISOString(),
          passed:
            reason === "passed" &&
            !errors.length &&
            [
              "api.test.ts",
              "model.test.ts",
              "migration.test.ts",
              "runtime.test.ts",
            ].every((s) => suites.includes(s)) &&
            JSON.stringify(this.start) === JSON.stringify(end),
          totalTests: tests.length,
          suites,
          apiArtifactFiles,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
