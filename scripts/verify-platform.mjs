import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { artifactFiles } from "./artifact-files.mjs";
import { digest, requireFullEvidence } from "./evidence.mjs";

const targets = JSON.parse(
  await readFile(
    new URL("../config/testing/native-platforms.json", import.meta.url),
    "utf8",
  ),
);

/** Firefox rounds CSS units to device pixels, so fractional zoom allows a small ratio tolerance. */
export function matchesBrowserBackingScale(measurement, requestedScale) {
  return (
    [1, 2].includes(requestedScale) &&
    Number.isFinite(measurement?.browserZoom) &&
    measurement.browserZoom > 0 &&
    Number.isFinite(measurement.devicePixelRatio) &&
    measurement.devicePixelRatio > 0 &&
    Math.abs(
      measurement.devicePixelRatio / measurement.browserZoom - requestedScale,
    ) <= 0.05
  );
}

export function validatePlatformReports(reports, buildTargets, options = {}) {
  if (reports.length !== targets.length)
    throw Error("Every native macOS target is required.");
  if (
    options.full &&
    (!options.identity?.runId || options.identity.runId === "uncoordinated")
  )
    throw Error(
      "Full native validation requires the acceptance cohort identity.",
    );
  let expectedCount, runId;
  for (const target of targets) {
    const matches = reports.filter(
      (report) => report.host?.variant === target.runner,
    );
    if (matches.length !== 1)
      throw Error("Native platform reports must be unique and complete.");
    const report = matches[0],
      host = report.host;
    if (
      !report.passed ||
      report.scope !== "platform" ||
      host.platform !== target.platform ||
      host.arch !== target.arch ||
      Number(host.osVersion.split(".")[0]) !== target.major ||
      host.translated !== false
    )
      throw Error(
        "Native macOS runtime identity does not match the requested target.",
      );
    if (JSON.stringify(report.buildTargets) !== JSON.stringify(buildTargets))
      throw Error(
        "Native evidence must match both immutable extension builds.",
      );
    const projects = [...(report.projects || [])].sort();
    if (
      JSON.stringify(projects) !==
        JSON.stringify([
          "platform-chrome",
          "platform-firefox",
          "platform-vision",
        ]) ||
      report.expected < 9 ||
      report.expected !== report.configuredCount ||
      report.cases?.length !== report.expected ||
      new Set(report.cases.map((item) => item.id)).size !== report.expected ||
      report.cases.some((item) => item.status !== "passed")
    )
      throw Error("Complete native browser and capture cases are required.");
    const privateLearning = report.cases.flatMap((item) =>
      item.privateLearning ? [item.privateLearning] : [],
    );
    if (
      privateLearning.length !== 2 ||
      JSON.stringify(privateLearning.map((item) => item.target).sort()) !==
        JSON.stringify(["chromium", "firefox"]) ||
      privateLearning.some(
        (item) =>
          item.known?.completedTasksByDom !== 1 ||
          item.known.decisions !== 0 ||
          item.known.liveProviderCalls !== 0 ||
          item.known.liveProviderTokens !== 0 ||
          item.changedStructure?.fakeDecisions !== 1 ||
          item.changedStructure.liveProviderCalls !== 0 ||
          item.changedStructure.liveProviderTokens !== 0 ||
          item.localStoppedNewRequests !== true ||
          !Array.isArray(item.layouts) ||
          item.layouts.length !== 8 ||
          ["light", "dark"].some((theme) => {
            const layouts = item.layouts.filter(
              (layout) => layout.theme === theme,
            );
            return (
              layouts.length !== 4 ||
              new Set(layouts.map((layout) => layout.viewport)).size !== 4
            );
          }) ||
          item.layouts.some(
            (layout) =>
              !Number.isFinite(layout.viewport) ||
              layout.viewport <= 0 ||
              layout.overflow ||
              !layout.focused ||
              !layout.reduced ||
              layout.outline === "none" ||
              !Number.isFinite(layout.outlineWidth) ||
              layout.outlineWidth < 2 ||
              !Array.isArray(layout.targets) ||
              !layout.targets.length ||
              layout.targets.some(
                (height) => !Number.isFinite(height) || height < 44,
              ),
          ),
      )
    )
      throw Error(
        "Both native browsers must verify private learning, zero-call reuse and current UI behavior.",
      );
    if (
      !report.browsers?.some((browser) => browser.target === "chromium") ||
      !report.browsers.some((browser) => browser.target === "firefox")
    )
      throw Error("Both native browser targets are required.");
    if (
      report.browsers.some(
        (browser) =>
          !/mac|darwin/i.test(browser.platform || "") ||
          !browser.version ||
          !browser.driverVersion ||
          (browser.target === "chromium" &&
            browser.driverVersion.split(".")[0] !==
              browser.version.split(".")[0]) ||
          browser.runtimePlatform?.os !== "mac" ||
          !(
            target.arch === "arm64" ? ["arm64", "aarch64"] : ["x86-64"]
          ).includes(browser.runtimePlatform.arch),
      )
    )
      throw Error(
        "Native browsers must identify their macOS runtime architecture and version.",
      );
    const captures = report.cases.flatMap((item) =>
      item.pixelPrivacy ? [item.pixelPrivacy] : [],
    );
    if (
      captures.length !== 2 ||
      JSON.stringify(captures.map((capture) => capture.target).sort()) !==
        JSON.stringify(["chromium", "firefox"]) ||
      captures.some(
        (capture) =>
          capture.requestedBackingScale !== 2 ||
          capture.imagesPersisted !== false ||
          !Array.isArray(capture.measurements) ||
          JSON.stringify(
            capture.measurements
              .map((item) => item.browserZoom)
              .sort((a, b) => a - b),
          ) !== JSON.stringify([0.8, 1.25, 2]) ||
          capture.measurements.some(
            (measurement) => !matchesBrowserBackingScale(measurement, 2),
          ),
      )
    )
      throw Error(
        "Both browsers must verify the requested 2x backing scale at each zoom.",
      );
    if (
      !report.validation?.runId ||
      report.validation.runId === "uncoordinated" ||
      report.validation.selection !== "complete" ||
      (options.full && report.validation.tier !== "full")
    )
      throw Error("Coordinated platform validation is required.");
    expectedCount ??= report.expected;
    runId ??= report.validation.runId;
    if (
      report.expected !== expectedCount ||
      report.validation.runId !== runId ||
      (options.identity && report.validation.runId !== options.identity.runId)
    )
      throw Error("Native reports must belong to one complete cohort.");
    if (options.full)
      requireFullEvidence(report, options.artifactFiles, options.identity);
  }
  return {
    passed: true,
    targets: targets.length,
    runId,
    casesPerTarget: expectedCount,
  };
}

export async function platformEvidence(buildTargets, options = {}) {
  const reports = await Promise.all(
    targets.map(async (target) =>
      JSON.parse(
        await readFile(`output/qa/platform/${target.runner}.json`, "utf8"),
      ),
    ),
  );
  return validatePlatformReports(reports, buildTargets, options);
}

async function main() {
  const chromium = await artifactFiles("dist/extension"),
    firefox = await artifactFiles("dist/extension-firefox"),
    full = process.argv.includes("--full"),
    identity = full
      ? requireFullEvidence(
          JSON.parse(await readFile("output/acceptance/results.json", "utf8")),
          chromium,
        )
      : process.env.THOLI_VALIDATION_RUN
        ? { runId: process.env.THOLI_VALIDATION_RUN }
        : undefined;
  const result = await platformEvidence(
    { chromium: digest(chromium), firefox: digest(firefox) },
    { full, artifactFiles: chromium, identity },
  );
  process.stdout.write(JSON.stringify(result) + "\n");
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await main();
