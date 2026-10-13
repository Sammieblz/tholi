import { readFile } from "node:fs/promises";
export async function multiAppEvidence(files, apiFiles) {
  const reports = {};
  for (const name of ["model", "runtime", "browser", "performance"]) {
    const report = JSON.parse(
      await readFile(`output/multi-app/${name}.json`, "utf8"),
    );
    if (
      !report.passed ||
      report.extensionVersion !== "0.8.0" ||
      JSON.stringify(report.artifactFiles) !== JSON.stringify(files)
    )
      throw Error(
        `Run passing v0.8 ${name} validation for the exact build bytes.`,
      );
    reports[name] = report;
  }
  if (
    apiFiles &&
    JSON.stringify(reports.runtime.apiArtifactFiles) !==
      JSON.stringify(apiFiles)
  )
    throw Error("v2 API bytes differ from evaluated bytes.");
  return {
    platforms: reports.model.platforms,
    corpusSha256: reports.model.corpusSha256,
    totalTests: reports.runtime.totalTests,
    browserCases: reports.browser.cases.length,
    initialMs: reports.performance.initialMs,
    refreshP95Ms: reports.performance.refreshP95Ms,
    warmP95Ms: reports.performance.warmP95Ms,
    capabilityMatrix: "docs/v0.8.0-capabilities.md",
    authenticatedChecks: "pending user-assisted signed-in verification",
  };
}
