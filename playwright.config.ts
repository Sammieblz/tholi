import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "tests/e2e",
  projects: [
    { name: "desktop", use: { viewport: { width: 1280, height: 900 } } },
    { name: "narrow", use: { viewport: { width: 720, height: 900 } } },
  ],
  workers: 1,
  timeout: 30000,
  reporter: [
    ["list"],
    ["./tests/support/regression-reporter.ts", { scope: "e2e", expected: 78 }],
  ],
  use: { trace: "retain-on-failure" },
  webServer: {
    command: "npm run dev:demo",
    url: "http://127.0.0.1:5173",
    reuseExistingServer: true,
    timeout: 30000,
  },
});
