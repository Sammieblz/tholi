import type {
  Reporter,
  FullConfig,
  FullResult,
  Suite,
  TestCase,
  TestResult,
} from "@playwright/test/reporter";
import { relative } from "node:path";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { artifactFiles } from "../../scripts/artifact-files.mjs";
import { buildProvenance } from "./build-provenance";
import {
  completeCases,
  writeEvidence,
  unchangedBuild,
  type CaseResult,
} from "./evidence";
import AccuracyReporter from "./accuracy-reporter";
const output: Record<string, string> = {
  "navigation-baseline": "output/qa/navigation-baseline.json",
  firefox: "output/qa/firefox-build.json",
  branded: "output/qa/branded-build.json",
  "browser-performance": "output/qa/browser-performance.json",
  e2e: "output/acceptance/e2e-regressions.json",
  live: "output/acceptance/live-regressions.json",
  ui: "output/qa/ui-build.json",
  nlp: "output/nlp/browser-build.json",
  "multi-app": "output/multi-app/browser.json",
  continuity: "output/vision/browser.json",
  reliability: "output/reliability/browser.json",
};
function scope(test: TestCase) {
  return String(test.parent.project()?.metadata.scope);
}
async function websiteProvenance() {
  const [builtFiles, sourceFiles, html] = await Promise.all([
    artifactFiles("dist/web"),
    artifactFiles("apps/web/src"),
    readFile("apps/web/index.html"),
  ]);
  return {
    builtFiles,
    sourceFiles,
    htmlSha256: createHash("sha256").update(html).digest("hex"),
  };
}
export default class BrowserReporter implements Reporter {
  private start?: Awaited<ReturnType<typeof buildProvenance>>;
  private website?: Awaited<ReturnType<typeof websiteProvenance>>;
  private firefoxBuild?: Awaited<ReturnType<typeof buildProvenance>>;
  private browsers = new Map<string, unknown[]>();
  private expected = new Map<string, string[]>();
  private files = new Map<string, Set<string>>();
  private projects = new Map<string, Set<string>>();
  private cases = new Map<string, CaseResult[]>();
  private accuracy?: AccuracyReporter;
  private firefoxAccuracy?: AccuracyReporter;
  async onBegin(config: FullConfig, suite: Suite) {
    const firefoxOnly =
      suite.allTests().length > 0 &&
      suite
        .allTests()
        .every((test) =>
          ["firefox", "acceptance-firefox"].includes(scope(test)),
        );
    this.start = await buildProvenance(firefoxOnly ? "firefox" : "chromium");
    if (firefoxOnly) this.firefoxBuild = this.start;
    else if (
      suite
        .allTests()
        .some((test) => ["firefox", "acceptance-firefox"].includes(scope(test)))
    )
      this.firefoxBuild = await buildProvenance("firefox");
    for (const test of suite.allTests()) {
      const group = scope(test);
      this.files.set(
        group,
        new Set([
          ...(this.files.get(group) || []),
          relative(process.cwd(), test.location.file).replaceAll("\\", "/"),
        ]),
      );
      this.projects.set(
        group,
        new Set([
          ...(this.projects.get(group) || []),
          test.parent.project()!.name,
        ]),
      );
      this.expected.set(group, [...(this.expected.get(group) || []), test.id]);
    }
    if (this.expected.has("ui")) this.website = await websiteProvenance();
    if (this.expected.has("acceptance-firefox")) {
      this.firefoxAccuracy = new AccuracyReporter("firefox");
      await this.firefoxAccuracy.onBegin(config, suite);
    }
    if (this.expected.has("acceptance")) {
      this.accuracy = new AccuracyReporter();
      await this.accuracy.onBegin(config, suite);
    }
  }
  async onTestEnd(test: TestCase, result: TestResult) {
    const group = scope(test);
    for (const attachment of result.attachments.filter(
      (item) => item.name === "browser-runtime",
    )) {
      this.browsers.set(group, [
        ...(this.browsers.get(group) || []),
        JSON.parse(
          (attachment.body || (await readFile(attachment.path!))).toString(),
        ),
      ]);
    }
    if (group === "acceptance-firefox") {
      await this.firefoxAccuracy!.onTestEnd(test, result);
      return;
    }
    if (group === "acceptance") {
      await this.accuracy!.onTestEnd(test, result);
      return;
    }
    const extra: Record<string, unknown> = {};
    for (const [name, key] of [
      ["navigation-baseline", "measurement"],
      ["motion-benchmark", "motion"],
      ["native-surfaces", "surfaces"],
      ["paired-performance", "pairedPerformance"],
      ["pixel-privacy", "pixelPrivacy"],
      ["route-motion-timing", "routeMotion"],
      ["website-motion-timing", "websiteMotion"],
    ]) {
      const attachment = result.attachments.find((a) => a.name === name);
      if (attachment)
        extra[key] = JSON.parse(
          (attachment.body || (await readFile(attachment.path!))).toString(),
        );
    }
    const disposals = await Promise.all(
      result.attachments
        .filter((item) => item.name === "browser-disposal")
        .map(async (item) =>
          JSON.parse((item.body || (await readFile(item.path!))).toString()),
        ),
    );
    this.cases.set(group, [
      ...(this.cases.get(group) || []),
      {
        id: test.id,
        name: test.titlePath().join(" / "),
        status: result.status,
        elapsedMs: result.duration,
        ...(disposals.length
          ? {
              disposalMs: disposals.reduce(
                (sum, item) => sum + item.elapsedMs,
                0,
              ),
            }
          : {}),
        ...extra,
      },
    ]);
  }
  async onEnd(result: FullResult) {
    const unchanged = await unchangedBuild(this.start!);
    let passed =
      result.status === "passed" && unchanged && this.expected.size > 0;
    for (const [group, expected] of this.expected) {
      if (["acceptance", "acceptance-firefox"].includes(group)) continue;
      const cases = this.cases.get(group) || [];
      const groupPassed =
        passed &&
        completeCases(expected, cases) &&
        (group !== "ui" ||
          JSON.stringify(this.website) ===
            JSON.stringify(await websiteProvenance()));
      passed &&= groupPassed;
      if (!output[group]) throw Error("Unknown evidence scope: " + group);
      await writeEvidence(output[group], {
        ...(group === "firefox" ? this.firefoxBuild : this.start),
        browsers: this.browsers.get(group) || [],
        scope: group,
        evaluatedAt: new Date().toISOString(),
        passed: groupPassed,
        files: [...(this.files.get(group) || [])].sort(),
        projects: [...(this.projects.get(group) || [])],
        expected: expected.length,
        configuredCount: expected.length,
        cases,
        ...(group === "ui" ? { website: this.website } : {}),
        ...(["continuity", "reliability"].includes(group)
          ? {
              nativePermissions: "pending user-assisted check",
              authenticatedWorkflows: "pending signed-in verification",
            }
          : {}),
      });
    }
    if (this.firefoxAccuracy) {
      const accuracy = await this.firefoxAccuracy.onEnd(result);
      passed = passed && accuracy.status === "passed";
    }
    if (this.accuracy) {
      const accuracy = await this.accuracy.onEnd(result);
      passed = passed && accuracy.status === "passed";
    }
    return { status: passed ? ("passed" as const) : ("failed" as const) };
  }
}
