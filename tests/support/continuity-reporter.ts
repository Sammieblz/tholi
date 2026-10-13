import type {
  Reporter,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import { mkdir, writeFile } from "node:fs/promises";
import { buildProvenance } from "./build-provenance";
export default class ContinuityReporter implements Reporter {
  private start?: Awaited<ReturnType<typeof buildProvenance>>;
  private expected = 0;
  private cases: { name: string; status: string }[] = [];
  async onBegin(_config: unknown, suite: Suite) {
    this.expected = suite.allTests().length;
    this.start = await buildProvenance();
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.cases.push({ name: test.title, status: result.status });
  }
  async onEnd(result: FullResult) {
    const end = await buildProvenance();
    await mkdir("output/vision", { recursive: true });
    await writeFile(
      "output/vision/browser.json",
      JSON.stringify(
        {
          ...end,
          passed:
            result.status === "passed" &&
            this.expected === 3 &&
            this.cases.length === 3 &&
            this.cases.every((c) => c.status === "passed") &&
            JSON.stringify(this.start) === JSON.stringify(end),
          cases: this.cases,
          nativeCapturePermission: "pending user-assisted Chrome check",
          authenticatedWorkflows: "pending user-assisted signed-in check",
        },
        null,
        2,
      ),
    );
  }
}
