import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/ui",
  workers: 1,
  timeout: 45000,
  reporter: [["list"], ["./tests/support/ui-reporter.ts"]],
  use: { viewport: { width: 1280, height: 900 }, trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev:web",
    url: "http://127.0.0.1:5174",
    reuseExistingServer: false,
    timeout: 30000,
  },
});
