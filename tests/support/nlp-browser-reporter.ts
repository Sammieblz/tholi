import type {
  Reporter,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import { mkdir, writeFile } from "node:fs/promises";
import { buildProvenance } from "./build-provenance";
export default class NlpBrowserReporter implements Reporter {
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
    await mkdir("output/nlp", { recursive: true });
    await writeFile(
      "output/nlp/browser-build.json",
      JSON.stringify(
        {
          ...end,
          evaluatedAt: new Date().toISOString(),
          passed:
            result.status === "passed" &&
            this.expected === 12 &&
            this.cases.length === 12 &&
            this.cases.every((c) => c.status === "passed") &&
            JSON.stringify(this.start) === JSON.stringify(end),
          cases: this.cases,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
