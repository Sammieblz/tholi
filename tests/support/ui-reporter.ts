import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import { mkdir, writeFile } from "node:fs/promises";
import { buildProvenance } from "./build-provenance";
export default class UIReporter implements Reporter {
  private start?: Awaited<ReturnType<typeof buildProvenance>>;
  private expected = 0;
  private cases: {
    id: string;
    status: string;
    motion?: { nodes: number; frameP95Ms: number; sameRoot: boolean };
  }[] = [];
  async onBegin(_config: FullConfig, suite: Suite) {
    this.start = await buildProvenance();
    this.expected = suite.allTests().length;
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const motion = result.attachments.find(
      (a) => a.name === "motion-benchmark",
    )?.body;
    this.cases.push({
      id: test.titlePath().join(" / "),
      status: result.status,
      ...(motion ? { motion: JSON.parse(motion.toString()) } : {}),
    });
  }
  async onEnd(result: FullResult) {
    const end = await buildProvenance();
    const passed =
      result.status === "passed" &&
      this.expected === 10 &&
      this.cases.length === 10 &&
      this.cases.every((c) => c.status === "passed") &&
      JSON.stringify(end) === JSON.stringify(this.start);
    await mkdir("output/qa", { recursive: true });
    await writeFile(
      "output/qa/ui-build.json",
      JSON.stringify(
        {
          ...this.start,
          passed,
          expected: 10,
          cases: this.cases,
          evaluatedAt: new Date().toISOString(),
        },
        null,
        2,
      ),
    );
    return { status: passed ? ("passed" as const) : ("failed" as const) };
  }
}
