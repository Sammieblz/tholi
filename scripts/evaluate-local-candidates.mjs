import { runToolingEntry } from "./run-tooling-entry.mjs";
if (process.argv.length !== 2)
  throw new Error(
    "This qualification probe accepts no remote endpoint or model options.",
  );
await runToolingEntry(
  "tests/integration/nlp/local-candidate-probe.ts",
  "local-candidate-probe",
  [],
);
