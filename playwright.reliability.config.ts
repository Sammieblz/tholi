import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/reliability-browser",
  workers: 1,
  timeout: 180000,
  outputDir: "test-results-reliability",
  reporter: [["list"], ["./tests/support/reliability-reporter.ts"]],
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev:demo",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
});
