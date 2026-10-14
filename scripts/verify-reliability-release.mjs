import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
export async function reliabilityEvidence(files) {
  const report = JSON.parse(
      await readFile("output/reliability/browser.json", "utf8"),
    ),
    comparison = JSON.parse(
      await readFile("output/reliability/vision-comparison.json", "utf8"),
    ),
    policy = JSON.parse(
      await readFile("dist/extension/vision-policy.json", "utf8"),
    );
  if (
    !report.passed ||
    JSON.stringify(report.artifactFiles) !== JSON.stringify(files)
  )
    throw Error("Run complete reliability browser checks for matching bytes.");
  const sha = createHash("sha256")
    .update(await readFile("tests/reliability-vision/corpus.json"))
    .digest("hex");
  if (comparison.corpusSha256 !== sha)
    throw Error("UI image corpus differs from evaluated corpus.");
  const engine = policy.paddleDefault ? "paddle" : "tesseract",
    metrics = comparison.metrics[engine];
  if (
    metrics.runtimeError ||
    metrics.heldOut !== 24 ||
    metrics.precision < 0.95 ||
    metrics.coverage < 0.85 ||
    metrics.warmP95Ms >= 2000
  )
    throw Error("Default OCR engine did not pass its held-out gates.");
  return {
    engine,
    metrics,
    paddle: comparison.metrics.paddle,
    nativePermissions: report.nativePermissions,
    signedInAmazon: report.signedInAmazon,
  };
}
