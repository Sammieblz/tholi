import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, stat, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { comparisonEvidence } from "./comparison-report";

try {
  const { values } = parseArgs({
    options: {
      report: { type: "string" },
      plan: { type: "string" },
      journal: { type: "string" },
      output: { type: "string" },
    },
  });
  if (
    !values.report ||
    !values.plan ||
    !values.journal ||
    !values.output ||
    resolve(values.output) === resolve(values.report)
  )
    throw Error("Explicit distinct finalization inputs are required.");
  if ((await stat(values.report)).size > 16 * 1024 * 1024)
    throw Error("The report exceeds its bound.");
  const bytes = await readFile(values.report);
  if (bytes.length > 16 * 1024 * 1024)
    throw Error("The report exceeds its bound.");
  const report = JSON.parse(bytes.toString("utf8"));
  if (report.scope !== "perception-comparison" || !Array.isArray(report.cases))
    throw Error("A comparison collection report is required.");
  // The existing audit owner validates the hash chain and usage. This tool
  // never parses an independent accounting format or starts the API server.
  const audit = JSON.parse(
    execFileSync(
      process.execPath,
      ["apps/api/dist/model-evaluation.js", "--audit", values.journal],
      { encoding: "utf8", maxBuffer: 4 * 1024 * 1024, windowsHide: true },
    ),
  );
  if (!audit.closed)
    throw Error("Close the evaluation service before finalization.");
  const final = {
    ...report,
    ...(await comparisonEvidence(report.cases, {
      mode: report.experimentMode,
      planFile: values.plan,
      audit,
    })),
    finalizedAt: new Date().toISOString(),
    collectionReportSha256: createHash("sha256").update(bytes).digest("hex"),
  };
  if (!final.costJournal)
    throw Error("The closed journal does not match the plan.");
  await writeFile(values.output, JSON.stringify(final, null, 2) + "\n", {
    flag: "wx",
  });
  process.stdout.write(
    JSON.stringify({
      finalized: true,
      qualityEvidenceAvailable: final.qualityEvidenceAvailable,
      betaGateDecision: final.betaGateDecision,
    }) + "\n",
  );
} catch {
  process.stderr.write(
    "Comparison finalization refused. Check the unchanged collection report, exact plan and closed journal.\n",
  );
  process.exitCode = 1;
}
