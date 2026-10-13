import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/continuity-browser",
  workers: 1,
  timeout: 120000,
  outputDir: "test-results-continuity",
  reporter: [["list"], ["./tests/support/continuity-reporter.ts"]],
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev:demo",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
});
