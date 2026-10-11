import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/live",
  outputDir: "test-results-live",
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "narrow", use: { viewport: { width: 720, height: 900 } } },
  ],
  workers: 1,
  timeout: 60000,
  reporter: [
    ["list"],
    ["./tests/support/regression-reporter.ts", { scope: "live", expected: 16 }],
  ],
  use: { trace: "retain-on-failure" },
});
