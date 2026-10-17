import { createHash } from "node:crypto";
export const digest = (files) =>
  createHash("sha256").update(JSON.stringify(files)).digest("hex");
export function validationIdentity() {
  return {
    selection:
      process.env.THOLI_VALIDATION_SELECTION === "complete"
        ? "complete"
        : "focused",
    tier: process.env.THOLI_TEST_TIER === "full" ? "full" : "pr",
    runId: process.env.THOLI_VALIDATION_RUN || "uncoordinated",
  };
}
export function requireFullEvidence(report, files, identity) {
  if (
    !report?.passed ||
    report.validation?.tier !== "full" ||
    report.validation?.selection !== "complete" ||
    !report.validation.runId ||
    report.validation.runId === "uncoordinated" ||
    JSON.stringify(report.artifactFiles) !== JSON.stringify(files) ||
    report.validation.buildDigest !== digest(files) ||
    (identity && report.validation.runId !== identity.runId)
  )
    throw Error(
      "Complete full validation from one run and the exact build is required before packaging.",
    );
  return report.validation;
}
