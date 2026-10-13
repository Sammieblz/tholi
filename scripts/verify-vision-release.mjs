import { readFile } from "node:fs/promises";
export async function visionEvidence(files, apiFiles) {
  const reports = {};
  for (const name of ["runtime", "routes", "browser", "performance"]) {
    const report = JSON.parse(
      await readFile("output/vision/" + name + ".json", "utf8"),
    );
    if (
      !report.passed ||
      report.extensionVersion !== "0.9.0" ||
      JSON.stringify(report.artifactFiles) !== JSON.stringify(files)
    )
      throw new Error(
        "Run passing v0.9 " + name + " checks for the matching build bytes",
      );
    reports[name] = report;
  }
  if (
    apiFiles &&
    JSON.stringify(reports.runtime.apiArtifactFiles) !==
      JSON.stringify(apiFiles)
  )
    throw new Error("OCR API bytes differ from evaluated bytes");
  return {
    corpusSha256: reports.routes.corpusSha256,
    platforms: reports.routes.platforms,
    ocrWarmP95Ms: reports.performance.warmP95Ms,
    browserCases: reports.browser.cases.length,
    nativeAndAuthenticatedChecks: "pending user-assisted verification",
  };
}
