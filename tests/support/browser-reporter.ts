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
  private expected = new Map<string, string[]>();
  private files = new Map<string, Set<string>>();
  private projects = new Map<string, Set<string>>();
  private cases = new Map<string, CaseResult[]>();
  private accuracy?: AccuracyReporter;
  async onBegin(config: FullConfig, suite: Suite) {
    this.start = await buildProvenance();
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
    if (this.expected.has("acceptance")) {
      this.accuracy = new AccuracyReporter();
      await this.accuracy.onBegin(config, suite);
    }
  }
  async onTestEnd(test: TestCase, result: TestResult) {
    const group = scope(test);
    if (group === "acceptance") {
      await this.accuracy!.onTestEnd(test, result);
      return;
    }
    const extra: Record<string, unknown> = {};
    for (const [name, key] of [
      ["motion-benchmark", "motion"],
      ["route-motion-timing", "routeMotion"],
      ["website-motion-timing", "websiteMotion"],
    ]) {
      const attachment = result.attachments.find((a) => a.name === name);
      if (attachment)
        extra[key] = JSON.parse(
          (attachment.body || (await readFile(attachment.path!))).toString(),
        );
    }
    this.cases.set(group, [
      ...(this.cases.get(group) || []),
      {
        id: test.id,
        name: test.titlePath().join(" / "),
        status: result.status,
        ...extra,
      },
    ]);
  }
  async onEnd(result: FullResult) {
    const unchanged = await unchangedBuild(this.start!);
    let passed =
      result.status === "passed" && unchanged && this.expected.size > 0;
    for (const [group, expected] of this.expected) {
      if (group === "acceptance") continue;
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
        ...this.start,
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
    if (this.accuracy) {
      const accuracy = await this.accuracy.onEnd(result);
      passed = passed && accuracy.status === "passed";
    }
    return { status: passed ? ("passed" as const) : ("failed" as const) };
  }
}
