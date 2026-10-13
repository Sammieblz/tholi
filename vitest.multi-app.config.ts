import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/multi-app/**/*.test.ts"],
    testTimeout: 180000,
    hookTimeout: 180000,
    fileParallelism: false,
    reporters: ["default", "./tests/support/multi-app-reporter.ts"],
  },
});
