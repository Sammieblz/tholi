import { chromium } from "@playwright/test";
import { build } from "esbuild";
import { mkdir, writeFile } from "node:fs/promises";
// Read-only, fresh unauthenticated profile. No screenshots, traces, clicks,
// credentials, persisted DOM snapshots or automatic workflow actions.
const code = (
  await build({
    entryPoints: ["packages/page-discovery/index.ts"],
    bundle: true,
    write: false,
    format: "iife",
    globalName: "publicDiscovery",
    platform: "browser",
    target: "chrome120",
  })
).outputFiles[0].text;
const checks = [
  ["cloudflare", "https://dash.cloudflare.com/"],
  ["github", "https://github.com/"],
  ["jira", "https://www.atlassian.com/software/jira"],
  ["youtube", "https://www.youtube.com/"],
  ["netflix", "https://www.netflix.com/"],
  ["amazon", "https://www.amazon.com/"],
];
const browser = await chromium.launch({ headless: true }),
  results = [];
try {
  for (const [platform, url] of checks) {
    const page = await browser.newPage();
    try {
      const response = await page.goto(url, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });
      if (!response?.ok()) throw Error("HTTP " + response?.status());
      await page.evaluate(
        code + ";globalThis.publicDiscovery=publicDiscovery;",
      );
      const observation = await page.evaluate(async () => {
        const d = new publicDiscovery.PageDiscovery();
        let snapshot;
        const stop = d.observe(() => (snapshot = d.snapshot()));
        await new Promise((r) => setTimeout(r, 500));
        snapshot = d.snapshot();
        stop();
        return {
          controls: snapshot.controls.length,
          visible: snapshot.controls.filter((c) => c.visible).length,
          coverage: snapshot.coverage?.map((s) => ({
            role: s.role,
            complete: s.complete,
            omitted: s.omitted,
            virtualized: s.virtualized,
          })),
          partial: snapshot.partial,
        };
      });
      if (!observation.controls)
        throw Error(
          "No accessible controls were observed; page access or rendering needs a user-assisted check.",
        );
      results.push({
        platform,
        url,
        status: "public discovery checked",
        ...observation,
        authenticatedWorkflow: "pending user-assisted signed-in verification",
      });
    } catch (error) {
      results.push({
        platform,
        url,
        status: "pending public check",
        reason: error.message.split("\n")[0],
        authenticatedWorkflow: "pending user-assisted signed-in verification",
      });
    } finally {
      await page.close();
    }
    console.log(platform + ": " + results.at(-1).status);
  }
} finally {
  await browser.close();
}
await mkdir("output/multi-app", { recursive: true });
await writeFile(
  "output/multi-app/public.json",
  JSON.stringify(
    {
      evaluatedAt: new Date().toISOString(),
      results,
      scope:
        "Unauthenticated public page discovery only; no signed-in workflow passes.",
    },
    null,
    2,
  ) + "\n",
);
