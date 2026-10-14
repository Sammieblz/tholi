import type { Reporter, TestModule, TestRunEndReason } from "vitest/node";
import { mkdir, writeFile } from "node:fs/promises";
import { artifactFiles } from "../../scripts/artifact-files.mjs";
import { buildProvenance } from "./build-provenance";
export default class VisionReporter implements Reporter {
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
      apiArtifactFiles = await artifactFiles("apps/api/dist");
    const tests = modules.flatMap((m) => [...m.children.allTests()]);
    await mkdir("output/vision", { recursive: true });
    await writeFile(
      "output/vision/runtime.json",
      JSON.stringify(
        {
          ...end,
          passed:
            reason === "passed" &&
            !errors.length &&
            tests.length === 4 &&
            JSON.stringify(this.start) === JSON.stringify(end),
          totalTests: tests.length,
          apiArtifactFiles,
        },
        null,
        2,
      ),
    );
  }
}
