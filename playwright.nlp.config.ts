import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/nlp-browser",
  workers: 1,
  timeout: 60000,
  outputDir: "test-results-nlp",
  reporter: [["list"], ["./tests/support/nlp-browser-reporter.ts"]],
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev:demo",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
  },
});
