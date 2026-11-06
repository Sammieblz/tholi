import { expect, it } from "vitest";
import targets from "../../../config/testing/native-platforms.json" with { type: "json" };
import {
  matchesBrowserBackingScale,
  validatePlatformReports,
} from "../../../scripts/verify-platform.mjs";
import { digest } from "../../../scripts/evidence.mjs";

const files = { "worker.js": "synthetic-build-digest" };
const builds = { chromium: digest(files), firefox: "firefox-build" };
const identity = { runId: "one-run" };
const fullOptions = { full: true, artifactFiles: files, identity };
function cohort() {
  return targets.map((target) => ({
    passed: true,
    target: "chromium",
    scope: "platform",
    artifactFiles: files,
    buildTargets: builds,
    host: {
      variant: target.runner,
      platform: target.platform,
      arch: target.arch,
      osVersion: `${target.major}.1`,
      translated: false,
    },
    validation: {
      tier: "full",
      selection: "complete",
      runId: "one-run",
      buildDigest: builds.chromium,
    },
    expected: 7,
    configuredCount: 7,
    projects: ["platform-chrome", "platform-firefox", "platform-vision"],
    browsers: [
      {
        target: "chromium",
        platform: "mac",
        version: "156.0",
        runtimePlatform: {
          os: "mac",
          arch: target.arch === "arm64" ? "arm64" : "x86-64",
        },
      },
      {
        target: "firefox",
        platform: "mac",
        version: "157.0",
        runtimePlatform: {
          os: "mac",
          arch: target.arch === "arm64" ? "aarch64" : "x86-64",
        },
      },
    ],
    cases: Array.from({ length: 7 }, (_, index) => ({
      id: `case-${index}`,
      status: "passed",
      pixelPrivacy:
        index >= 5
          ? {
              target: index === 5 ? "chromium" : "firefox",
              requestedBackingScale: 2,
              imagesPersisted: false,
              measurements: [0.8, 1.25, 2].map((browserZoom) => ({
                browserZoom,
                devicePixelRatio: browserZoom * 2,
              })),
            }
          : undefined,
    })),
  }));
}

it("requires one complete same-build native Mac cohort across both architectures and OS versions", () => {
  expect(validatePlatformReports(cohort(), builds, fullOptions)).toMatchObject({
    passed: true,
    targets: 4,
    casesPerTarget: 7,
  });
  expect(() => validatePlatformReports(cohort().slice(1), builds)).toThrow(
    /Every native/,
  );
  const duplicate = cohort();
  duplicate[1] = duplicate[0];
  expect(() => validatePlatformReports(duplicate, builds)).toThrow(/unique/);
});

it("rejects claimed Mac coverage from a different host, translated architecture or stale extension", () => {
  for (const change of [
    (report: ReturnType<typeof cohort>[number]) => {
      report.host.platform = "win32";
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.host.arch = "x64";
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.host.osVersion = "14.0";
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.host.translated = true;
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.buildTargets = { ...builds, firefox: "stale" };
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.browsers[0].runtimePlatform.arch = "x86-64";
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.browsers[1].runtimePlatform.os = "linux";
    },
  ]) {
    const reports = cohort();
    change(reports[0]);
    expect(() => validatePlatformReports(reports, builds)).toThrow();
  }
});

it("rejects omitted or failed native cases, mixed runs and PR reports used as full certification", () => {
  for (const change of [
    (report: ReturnType<typeof cohort>[number]) => {
      report.cases.pop();
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.cases[0].status = "skipped";
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.validation.runId = "another-run";
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.validation.tier = "pr";
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.browsers = [report.browsers[0]];
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.browsers[0].platform = "windows";
    },
  ]) {
    const reports = cohort();
    change(reports[3]);
    expect(() =>
      validatePlatformReports(reports, builds, fullOptions),
    ).toThrow();
  }
});

it("binds a complete same-build Mac cohort to the existing full acceptance run", () => {
  const previous = cohort();
  for (const report of previous) report.validation.runId = "earlier-run";
  expect(() => validatePlatformReports(previous, builds, fullOptions)).toThrow(
    "one complete cohort",
  );
  expect(() =>
    validatePlatformReports(cohort(), builds, {
      full: true,
      artifactFiles: files,
    }),
  ).toThrow("acceptance cohort identity");
  expect(() =>
    validatePlatformReports(cohort(), builds, {
      ...fullOptions,
      identity: { runId: "uncoordinated" },
    }),
  ).toThrow("acceptance cohort identity");
});

it("requires observed 2x browser backing scale for both browsers at every declared zoom", () => {
  expect(
    matchesBrowserBackingScale({ browserZoom: 0.8, devicePixelRatio: 1.6 }, 2),
  ).toBe(true);
  expect(
    matchesBrowserBackingScale(
      { browserZoom: 0.8, devicePixelRatio: 60 / 38 },
      2,
    ),
  ).toBe(true);
  expect(
    matchesBrowserBackingScale(
      { browserZoom: 1.25, devicePixelRatio: 1.25 },
      1,
    ),
  ).toBe(true);
  for (const change of [
    (report: ReturnType<typeof cohort>[number]) => {
      report.cases[5].pixelPrivacy = undefined;
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.cases[5].pixelPrivacy!.requestedBackingScale = 1;
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.cases[6].pixelPrivacy!.measurements[0].devicePixelRatio = 0.8;
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.cases[6].pixelPrivacy!.measurements.pop();
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.cases[6].pixelPrivacy!.target = "chromium";
    },
    (report: ReturnType<typeof cohort>[number]) => {
      report.cases[5].pixelPrivacy!.imagesPersisted = true;
    },
  ]) {
    const reports = cohort();
    change(reports[0]);
    expect(() => validatePlatformReports(reports, builds, fullOptions)).toThrow(
      "requested 2x backing scale",
    );
  }
  for (const measurement of [
    undefined,
    { browserZoom: 0, devicePixelRatio: 2 },
    { browserZoom: 1, devicePixelRatio: Number.NaN },
  ])
    expect(matchesBrowserBackingScale(measurement, 2)).toBe(false);
});
