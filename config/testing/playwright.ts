import { defineConfig, type Project } from "@playwright/test";
import { resolve } from "node:path";
import matrix from "../../tests/browser/acceptance/matrix.json" with { type: "json" };
const full = process.env.THOLI_TEST_TIER === "full";
const port = Number(process.env.THOLI_UI_PORT || 5174);
const browserGroup = process.env.THOLI_BROWSER_GROUP;
const domTrace = { mode: "retain-on-failure" as const, screenshots: false };
const project = (
  name: string,
  scope: string,
  directory: string,
  extra: Partial<Project> = {},
): Project => ({
  name,
  testDir: resolve("tests/browser/" + directory),
  outputDir: resolve("test-results/" + name),
  metadata: { scope },
  timeout: 60_000,
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  ...extra,
});
const projects: Project[] = [
  project("core-desktop", "e2e", "extension/core", {
    timeout: 30_000,
    use: { trace: domTrace },
  }),
  project("narrow", "e2e", "extension/core", {
    timeout: 30_000,
    grep: /live inspector explains|generic discovery plans/,
    use: {
      viewport: { width: 720, height: 900 },
      trace: domTrace,
    },
  }),
  project("firefox-extension", "firefox", "extension/firefox", {
    timeout: 120_000,
  }),
  project("nlp", "nlp", "extension/nlp", { timeout: 60_000 }),
  project("multi-app", "multi-app", "extension/multi-app", {
    timeout: 120_000,
    ...(full ? {} : { grepInvert: /mutation benchmark/ }),
  }),
  project("continuity", "continuity", "extension/continuity", {
    timeout: 120_000,
  }),
  project("reliability", "reliability", "extension/reliability", {
    timeout: 180_000,
    ...(full ? {} : { testIgnore: "**/vision.spec.ts" }),
  }),
  project("ui-extension", "ui", "extension/ui", {
    timeout: 45_000,
    ...(full ? {} : { grepInvert: /busy page motion/ }),
  }),
  project("ui-website-firefox", "ui", "website", {
    timeout: 45_000,
    use: {
      browserName: "firefox",
      baseURL: `http://127.0.0.1:${port}`,
      viewport: { width: 1280, height: 900 },
      trace: "retain-on-failure",
    },
    ...(full
      ? {}
      : {
          grep: /download|account|onboarding|theme|cookie|documentation|contact|support/,
        }),
  }),
  project("ui-website", "ui", "website", {
    timeout: 45_000,
    use: {
      baseURL: `http://127.0.0.1:${port}`,
      viewport: { width: 1280, height: 900 },
      trace: "retain-on-failure",
    },
    ...(full
      ? {}
      : { grepInvert: /all website routes reflow|scroll companion stays/ }),
  }),
];
if (browserGroup === "identity")
  projects.push(
    project("native-identity", "identity", "identity", {
      testMatch: "auth.spec.ts",
      timeout: 240_000,
      use: { trace: "off", screenshot: "off", video: "off" },
    }),
  );
if (browserGroup === "identity-web")
  for (const browserName of ["chromium", "firefox"] as const)
    projects.push(
      project(`identity-web-${browserName}`, "identity-web", "identity", {
        testMatch: "web.spec.ts",
        timeout: 300_000,
        use: {
          browserName,
          actionTimeout: 15_000,
          navigationTimeout: 30_000,
          trace: "off",
          screenshot: "off",
          video: "off",
        },
      }),
    );
if (browserGroup === "navigation-baseline")
  projects.push(
    project("navigation-baseline", "navigation-baseline", "live", {
      testMatch: "navigation-baseline.spec.ts",
      timeout: 90000,
      use: { viewport: { width: 1280, height: 900 }, trace: "off" },
    }),
  );
if (full) {
  projects.push(
    project(
      "browser-performance",
      "browser-performance",
      "extension/performance",
      { timeout: 240_000 },
    ),
  );
  projects.push(
    project("branded-browsers", "branded", "extension/branded", {
      timeout: 120_000,
    }),
  );
  for (const { name, width, height } of matrix.viewports) {
    projects.push(
      project("live-" + name, "live", "live", {
        testIgnore: "navigation-baseline.spec.ts",
        use: { viewport: { width, height }, trace: "retain-on-failure" },
      }),
    );
    projects.push(
      project(
        "acceptance-firefox-" + name,
        "acceptance-firefox",
        "acceptance-firefox",
        {
          timeout: 180_000,
          use: { viewport: { width, height }, trace: "retain-on-failure" },
        },
      ),
    );
    projects.push(
      project("acceptance-" + name, "acceptance", "acceptance", {
        timeout: 180_000,
        use: { viewport: { width, height }, trace: domTrace },
      }),
    );
  }
}
// The actual viewport name remains available to fixtures without coupling them
// to a particular project prefix.
export default defineConfig({
  forbidOnly: true,
  workers: 1,
  retries: 0,
  projects,
  reporter: ["identity", "identity-web"].includes(browserGroup || "")
    ? [["list"]]
    : [["list"], [resolve("tests/support/browser-reporter.ts")]],
  webServer: [
    ...(![
      "live",
      "navigation-baseline",
      "firefox",
      "brands",
      "browser-performance",
      "acceptance-firefox",
      "identity",
      "identity-web",
    ].includes(browserGroup || "")
      ? [
          {
            command:
              "node node_modules/vite/bin/vite.js preview --config apps/demo-saas/vite.config.ts --host 127.0.0.1 --port 5173 --strictPort",
            url: "http://127.0.0.1:5173",
            reuseExistingServer:
              !process.env.CI && !process.env.THOLI_BUILD_PREPARED,
            timeout: 30_000,
          },
        ]
      : []),
    ...(!browserGroup || ["ui", "identity-web"].includes(browserGroup)
      ? [
          {
            command: `node node_modules/vite/bin/vite.js preview --config apps/web/vite.config.ts --host 127.0.0.1 --port ${port} --strictPort`,
            url: `http://127.0.0.1:${port}`,
            reuseExistingServer:
              !process.env.CI && !process.env.THOLI_BUILD_PREPARED,
            timeout: 30_000,
          },
        ]
      : []),
  ],
});
