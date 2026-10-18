import type {
  Reporter,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import {
  acceptanceCaseSchema,
  acceptancePassed,
  summarize,
  type AcceptanceCase,
} from "../../packages/acceptance-metrics";
import { buildProvenance } from "./build-provenance";
export default class AccuracyReporter implements Reporter {
  constructor(private target: "chromium" | "firefox" = "chromium") {}
  private build?: Awaited<ReturnType<typeof buildProvenance>>;
  private samples: AcceptanceCase[] = [];
  private missing: string[] = [];
  private failures: string[] = [];
  private browsers = new Set<string>();
  private projects: string[] = [];
  async onBegin(_config: unknown, _suite: Suite) {
    this.build = await buildProvenance(this.target);
    this.projects = [
      ...new Set(
        _suite
          .allTests()
          .filter(
            (t) =>
              t.parent.project()?.metadata.scope ===
              (this.target === "firefox" ? "acceptance-firefox" : "acceptance"),
          )
          .map((t) => t.parent.project()!.name),
      ),
    ];
  }
  async onTestEnd(test: TestCase, result: TestResult) {
    for (const a of result.attachments.filter(
      (a) => a.name === "navigator-browser-version",
    )) {
      this.browsers.add((a.body || (await readFile(a.path!))).toString());
    }
    const samples = result.attachments.filter(
      (a) => a.name === "navigator-acceptance-case",
    );
    if (!samples.length) this.missing.push(test.titlePath().join(" / "));
    for (const sample of samples) {
      try {
        const content = sample.body || (await readFile(sample.path!));
        this.samples.push(
          acceptanceCaseSchema.parse(JSON.parse(content.toString())),
        );
      } catch {
        this.missing.push(
          test.titlePath().join(" / ") + " (invalid attachment)",
        );
      }
    }
    if (result.status !== "passed")
      this.failures.push(test.titlePath().join(" / "));
  }
  async onEnd(result: FullResult) {
    const matrix = await readFile("tests/browser/acceptance/matrix.json"),
      definition = JSON.parse(matrix.toString());
    const build = await buildProvenance(this.target);
    const live = this.samples.filter((c) => c.suite === "live"),
      fixture = this.samples.filter((c) => c.suite === "fixture"),
      authored = this.samples.filter((c) => c.suite === "authored");
    const liveExpected =
      definition.articles.length *
      definition.goals.length *
      definition.viewports.length;
    const fixtureExpected =
      (definition.goals.length + definition.negativeCases.length) *
      definition.viewports.length;
    const authoredExpected = 0;
    const unique = new Set(this.samples.map((c) => c.id));
    const expectedIds = definition.viewports.flatMap((v: { name: string }) => [
      ...definition.articles.flatMap((article: string) =>
        definition.goals.map(
          (g: { id: string }) => `${v.name}/${article}/${g.id}`,
        ),
      ),
      ...[
        ...definition.goals.map((g: { id: string }) => g.id),
        ...definition.negativeCases,
      ].map((id: string) => `${v.name}/fixture/${id}`),
    ]);
    const missingCases = expectedIds.filter((id: string) => !unique.has(id));
    const unexpectedCases = [...unique].filter(
      (id) => !expectedIds.includes(id),
    );
    const summaries = {
      live: summarize(live),
      fixture: summarize(fixture),
      authored: summarize(authored),
    };
    const passed =
      result.status === "passed" &&
      JSON.stringify(build) === JSON.stringify(this.build) &&
      !this.missing.length &&
      !this.failures.length &&
      !missingCases.length &&
      !unexpectedCases.length &&
      this.browsers.size > 0 &&
      unique.size === this.samples.length &&
      live.length === liveExpected &&
      fixture.length === fixtureExpected &&
      authored.length === authoredExpected &&
      acceptancePassed(summaries.live, definition.gates) &&
      acceptancePassed(summaries.fixture, definition.gates);
    const report = {
      format: "navigator-acceptance-v2",
      evaluatedAt: new Date().toISOString(),
      artifactFiles: build.artifactFiles,
      validation: build.validation,
      target: this.target,
      buildTargets: build.buildTargets,
      projects: this.projects,
      authoredEvidence: "output/qa/unit.json",
      matrixSha256: createHash("sha256").update(matrix).digest("hex"),
      extensionVersion: build.extensionVersion,
      protocolVersion: "1.0.0",
      sourceRevision: execFileSync("git", ["rev-parse", "HEAD"], {
        encoding: "utf8",
      }).trim(),
      workingTreeDirty: !!execFileSync("git", ["status", "--porcelain"], {
        encoding: "utf8",
      }).trim(),
      environment: {
        platform: process.platform,
        node: process.version,
        browsers: [...this.browsers],
        viewports: definition.viewports,
      },
      liveExpected,
      fixtureExpected,
      authoredExpected,
      missingCases,
      unexpectedCases,
      summaries,
      missing: this.missing,
      failures: this.failures,
      passed,
      cases: this.samples,
    };
    await mkdir("output/acceptance", { recursive: true });
    const output =
      this.target === "firefox"
        ? "output/acceptance/results-firefox.json"
        : "output/acceptance/results.json";
    await writeFile(output, JSON.stringify(report, null, 2));
    process.stdout.write(
      `Acceptance report: ${output}; ${passed ? "PASSED" : "FAILED"}\n`,
    );
    return { status: passed ? ("passed" as const) : ("failed" as const) };
  }
}
