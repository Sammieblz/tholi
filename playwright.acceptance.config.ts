import { defineConfig } from "@playwright/test";
import matrix from "./tests/acceptance/matrix.json" with { type: "json" };
export default defineConfig({
  testDir: "tests/acceptance",
  outputDir: "test-results-acceptance",
  workers: 1,
  timeout: 180000,
  projects: matrix.viewports.map(({ name, width, height }) => ({
    name,
    use: { viewport: { width, height } },
  })),
  reporter: [["list"], ["./tests/support/accuracy-reporter.ts"]],
  use: { trace: "retain-on-failure" },
});
