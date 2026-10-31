import { runToolingEntry } from "./run-tooling-entry.mjs";
await runToolingEntry(
  "tests/support/prepare-perception-comparison.ts",
  "prepare-perception-comparison",
  process.argv.slice(2),
);
