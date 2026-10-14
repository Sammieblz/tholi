import type { Reporter, TestModule, TestRunEndReason } from "vitest/node";
import { readFile, writeFile } from "node:fs/promises";
import { artifactFiles } from "../../scripts/artifact-files.mjs";
import { buildProvenance } from "./build-provenance";
export default class NlpReporter implements Reporter {
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
      tests = modules.flatMap((m) => [...m.children.allTests()]);
    const report = JSON.parse(
      await readFile("output/nlp/results.json", "utf8"),
    );
    report.passed =
      reason === "passed" &&
      !errors.length &&
      tests.length === 11 &&
      JSON.stringify(this.start) === JSON.stringify(end);
    report.totalTests = tests.length;
    report.apiArtifactFiles = await artifactFiles("apps/api/dist");
    report.artifactFiles = end.artifactFiles;
    report.extensionVersion = end.extensionVersion;
    await writeFile(
      "output/nlp/results.json",
      JSON.stringify(report, null, 2) + "\n",
    );
  }
}
