import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    maxWorkers: 1,
    environment: "jsdom",
    include: ["tests/**/*.test.ts"],
    exclude: ["tests/nlp/**", "tests/multi-app/**", "tests/vision/**"],
  },
});
