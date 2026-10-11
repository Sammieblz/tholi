import type {
  Reporter,
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { mkdir, writeFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { buildProvenance } from "./build-provenance";

export default class RegressionReporter implements Reporter {
  private start?: Awaited<ReturnType<typeof buildProvenance>>;
  private configuredCount = 0;
  private cases: { id: string; status: string }[] = [];
  constructor(private options: { scope: "e2e" | "live"; expected: number }) {}
  async onBegin(_config: FullConfig, suite: Suite) {
    this.configuredCount = suite.allTests().length;
    this.start = await buildProvenance();
  }
  onTestEnd(test: TestCase, result: TestResult) {
    this.cases.push({
      id: test.titlePath().join(" / "),
      status: result.status,
    });
  }
  async onEnd(result: FullResult) {
    const end = await buildProvenance();
    const passed =
      result.status === "passed" &&
      this.configuredCount === this.options.expected &&
      this.cases.length === this.options.expected &&
      new Set(this.cases.map((c) => c.id)).size === this.options.expected &&
      this.cases.every((c) => c.status === "passed") &&
      JSON.stringify(end) === JSON.stringify(this.start);
    await mkdir("output/acceptance", { recursive: true });
    await writeFile(
      `output/acceptance/${this.options.scope}-regressions.json`,
      JSON.stringify(
        {
          format: "navigator-regression-v1",
          scope: this.options.scope,
          ...this.start,
          evaluatedAt: new Date().toISOString(),
          expected: this.options.expected,
          configuredCount: this.configuredCount,
          sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
            encoding: "utf8",
          }).trim(),
          workingTreeDirty: !!execFileSync("git", ["status", "--porcelain"], {
            encoding: "utf8",
          }).trim(),
          passed,
          cases: this.cases,
        },
        null,
        2,
      ) + "\n",
    );
    return { status: passed ? ("passed" as const) : ("failed" as const) };
  }
}
