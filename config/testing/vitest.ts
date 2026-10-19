import { defineConfig } from "vitest/config";
import { resolve } from "node:path";
export default defineConfig({
  test: {
    maxWorkers: 1,
    allowOnly: false,
    reporters: ["default", resolve("tests/support/runtime-reporter.ts")],
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          setupFiles: [resolve("tests/support/browser-api-mock.ts")],
          environment: "node",
          include: ["tests/unit/**/*.test.ts"],
        },
      },
      ...["nlp", "multi-app", "vision"].map((name) => ({
        extends: true as const,
        test: {
          name,
          environment: "node" as const,
          include: [`tests/integration/${name}/**/*.test.ts`],
          fileParallelism: false,
          testTimeout: name === "vision" ? 90_000 : 180_000,
          hookTimeout: name === "vision" ? 90_000 : 180_000,
        },
      })),
    ],
  },
});
