import type {
  Reporter,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import { mkdir, writeFile } from "node:fs/promises";
import { buildProvenance } from "./build-provenance";
export default class ReliabilityReporter implements Reporter {
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
    await mkdir("output/reliability", { recursive: true });
    await writeFile(
      "output/reliability/browser.json",
      JSON.stringify(
        {
          ...end,
          passed:
            result.status === "passed" &&
            this.expected === 2 &&
            this.cases.length === 2 &&
            this.cases.every((c) => c.status === "passed") &&
            JSON.stringify(end) === JSON.stringify(this.start),
          cases: this.cases,
          nativePermissions:
            "pending: fixture host permissions were pregranted",
          signedInAmazon: "pending: journey uses authored responses",
        },
        null,
        2,
      ),
    );
  }
}
