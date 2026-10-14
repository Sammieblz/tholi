import { defineConfig } from "@playwright/test";
const port = Number(process.env.THOLI_UI_PORT || 5174);
const baseURL = `http://127.0.0.1:${port}`;
export default defineConfig({
  testDir: "tests/ui",
  workers: 1,
  timeout: 45000,
  reporter: [["list"], ["./tests/support/ui-reporter.ts"]],
  use: {
    baseURL,
    viewport: { width: 1280, height: 900 },
    trace: "retain-on-failure",
  },
  webServer: {
    command: `npm run dev:web -- --port ${port}`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 30000,
  },
});
