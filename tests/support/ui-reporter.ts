import type {
  Reporter,
  FullConfig,
  Suite,
  TestCase,
  TestResult,
  FullResult,
} from "@playwright/test/reporter";
import { mkdir, writeFile, readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { artifactFiles } from "../../scripts/artifact-files.mjs";
import { buildProvenance } from "./build-provenance";
export default class UIReporter implements Reporter {
  private start?: Awaited<ReturnType<typeof buildProvenance>>;
  private expected = 0;
  private website?: Awaited<ReturnType<typeof websiteProvenance>>;
  private cases: {
    id: string;
    status: string;
    motion?: { nodes: number; frameP95Ms: number; sameRoot: boolean };
    routeMotion?: { workload: string; frameP95Ms: number };
    websiteMotion?: unknown;
  }[] = [];
  async onBegin(_config: FullConfig, suite: Suite) {
    this.start = await buildProvenance();
    this.website = await websiteProvenance();
    this.expected = suite.allTests().length;
  }
  onTestEnd(test: TestCase, result: TestResult) {
    const motion = result.attachments.find(
      (a) => a.name === "motion-benchmark",
    )?.body;
    const routeMotion = result.attachments.find(
      (a) => a.name === "route-motion-timing",
    )?.body;
    const websiteMotion = result.attachments.find(
      (a) => a.name === "website-motion-timing",
    )?.body;
    this.cases.push({
      id: test.titlePath().join(" / "),
      status: result.status,
      ...(motion ? { motion: JSON.parse(motion.toString()) } : {}),
      ...(routeMotion
        ? { routeMotion: JSON.parse(routeMotion.toString()) }
        : {}),
      ...(websiteMotion
        ? { websiteMotion: JSON.parse(websiteMotion.toString()) }
        : {}),
    });
  }
  async onEnd(result: FullResult) {
    const end = await buildProvenance();
    const websiteEnd = await websiteProvenance();
    const passed =
      result.status === "passed" &&
      this.expected === 29 &&
      this.cases.length === 29 &&
      this.cases.every((c) => c.status === "passed") &&
      JSON.stringify(websiteEnd) === JSON.stringify(this.website) &&
      JSON.stringify(end) === JSON.stringify(this.start);
    await mkdir("output/qa", { recursive: true });
    await writeFile(
      "output/qa/ui-build.json",
      JSON.stringify(
        {
          ...this.start,
          website: this.website,
          passed,
          expected: 29,
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
