import { createHash } from "node:crypto";
/** Additional feature cases cannot substitute for any native branded surface proof. */
export function requireBrandedNativeSurfaces(cases) {
  for (const browser of ["chrome", "edge", "brave"]) {
    const title =
      browser +
      " loads the built Chromium target and verifies a website interaction";
    const matches = (cases || []).filter((item) => item.name?.endsWith(title));
    if (
      matches.length !== 1 ||
      !matches[0].surfaces?.nativeSidebar ||
      !matches[0].surfaces?.minimizedArrival
    )
      throw Error("Missing unique branded native surface proof: " + browser);
  }
}
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
export function requireFullEvidence(
  report,
  files,
  identity,
  target = "chromium",
) {
  if (
    !report?.passed ||
    report.target !== target ||
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
