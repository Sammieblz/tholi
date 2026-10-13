import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    environment: "node",
    include: ["tests/vision/**/*.test.ts"],
    fileParallelism: false,
    testTimeout: 90000,
    hookTimeout: 90000,
    reporters: ["default", "./tests/support/vision-reporter.ts"],
  },
});
