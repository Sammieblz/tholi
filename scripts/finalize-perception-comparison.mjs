import { runToolingEntry } from "./run-tooling-entry.mjs";
await runToolingEntry(
  "tests/support/finalize-perception-comparison.ts",
  "finalize-perception-comparison",
  process.argv.slice(2),
);
