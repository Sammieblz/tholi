import type { Reporter, TestModule, TestRunEndReason } from "vitest/node";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { buildProvenance } from "./build-provenance";
export default class MultiAppReporter implements Reporter {
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
      tests = modules.flatMap((m) => [...m.children.allTests()]),
      apiArtifactFiles: Record<string, string> = {};
    for (const name of (await readdir("apps/api/dist")).sort())
      apiArtifactFiles[name] = createHash("sha256")
        .update(await readFile("apps/api/dist/" + name))
        .digest("hex");
    const suites = modules.map((m) =>
      m.moduleId.replaceAll("\\", "/").split("/").at(-1),
    );
    await mkdir("output/multi-app", { recursive: true });
    await writeFile(
      "output/multi-app/runtime.json",
      JSON.stringify(
        {
          ...end,
          evaluatedAt: new Date().toISOString(),
          passed:
            reason === "passed" &&
            !errors.length &&
            [
              "api.test.ts",
              "model.test.ts",
              "migration.test.ts",
              "runtime.test.ts",
            ].every((s) => suites.includes(s)) &&
            JSON.stringify(this.start) === JSON.stringify(end),
          totalTests: tests.length,
          suites,
          apiArtifactFiles,
        },
        null,
        2,
      ) + "\n",
    );
  }
}
