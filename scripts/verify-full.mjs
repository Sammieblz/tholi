import { verifyBuildManifest } from "./build-manifest.mjs";
import { createHash } from "node:crypto";
import { artifactFiles } from "./artifact-files.mjs";
import { readdir, readFile } from "node:fs/promises";
import { requireFullEvidence, digest } from "./evidence.mjs";
import assert from "node:assert/strict";
import { syncVersion } from "./version.mjs";
export async function verifyFull() {
  await syncVersion("--check");
  await verifyBuildManifest();
  const { version } = JSON.parse(await readFile("package.json", "utf8"));
  for (const directory of ["dist/extension", "dist/extension-firefox"])
    assert.equal(
      JSON.parse(await readFile(`${directory}/manifest.json`, "utf8")).version,
      version,
      `${directory} must be rebuilt for the current release version`,
    );
  const sources = async (directory, suffix) =>
    (
      await Promise.all(
        (await readdir(directory, { withFileTypes: true })).map(
          async (entry) =>
            entry.isDirectory()
              ? sources(directory + "/" + entry.name, suffix)
              : entry.name.endsWith(suffix)
                ? [directory + "/" + entry.name]
                : [],
        ),
      )
    )
      .flat()
      .sort();
  const files = await artifactFiles("dist/extension");
  const read = async (path) => JSON.parse(await readFile(path, "utf8"));
  const acceptance = await read("output/acceptance/results.json");
  const identity = requireFullEvidence(acceptance, files);
  const buildTargets = {
    chromium: digest(files),
    firefox: digest(await artifactFiles("dist/extension-firefox")),
  };
  const targetMatch = (report) =>
    assert.deepEqual(
      report.buildTargets,
      buildTargets,
      "Evidence must match both target builds",
    );
  targetMatch(acceptance);
  const reports = [
    "output/qa/unit.json",
    "output/qa/ui-build.json",
    "output/acceptance/e2e-regressions.json",
    "output/acceptance/live-regressions.json",
    "output/nlp/results.json",
    "output/nlp/browser-build.json",
    ...["model", "runtime", "browser", "performance"].map(
      (name) => `output/multi-app/${name}.json`,
    ),
    ...["runtime", "routes", "browser", "performance"].map(
      (name) => `output/vision/${name}.json`,
    ),
    "output/reliability/browser.json",
  ];
  await (
    await import("./verify-reliability-release.mjs")
  ).reliabilityEvidence(files);
  const api = await artifactFiles("apps/api/dist");
  for (const path of reports) {
    const report = await read(path);
    requireFullEvidence(report, files, identity);
    targetMatch(report);
    if (report.apiArtifactFiles)
      assert.deepEqual(report.apiArtifactFiles, api, path + " API bytes");
    if (report.website) {
      assert.deepEqual(
        report.website.builtFiles,
        await artifactFiles("dist/web"),
        "Website bytes",
      );
      assert.equal(
        report.website.htmlSha256,
        createHash("sha256")
          .update(await readFile("apps/web/index.html"))
          .digest("hex"),
        "Website bootstrap bytes",
      );
      assert.deepEqual(
        report.website.sourceFiles,
        await artifactFiles("apps/web/src"),
        "Website source",
      );
    }
  }
  const paired = await read("output/qa/browser-performance.json");
  requireFullEvidence(paired, files, identity);
  targetMatch(paired);
  const measurements = paired.cases?.flatMap(
    (item) => item.pairedPerformance?.measurements || [],
  );
  assert.deepEqual(
    measurements?.map((item) => item.target).sort(),
    ["chromium", "firefox"],
    "Both browser performance measurements are required",
  );
  for (const item of measurements) {
    assert(
      item.version &&
        Number.parseInt(item.version) >=
          (item.target === "firefox" ? 153 : 140),
      "Missing supported browser version in paired performance",
    );
    assert(item.planning.warmP95Ms < 750);
    assert(item.ocr.warmP95Ms < 2000);
    assert(item.stopMs < 1000);
  }
  const branded = await read("output/qa/branded-build.json");
  requireFullEvidence(branded, files, identity);
  targetMatch(branded);
  for (const name of ["chrome", "edge", "brave"])
    assert(
      branded.browsers?.some(
        (browser) => browser.name === name && browser.version,
      ),
      "Missing branded runtime evidence: " + name,
    );
  const firefoxFiles = await artifactFiles("dist/extension-firefox");
  const firefox = await read("output/qa/firefox-build.json");
  requireFullEvidence(firefox, firefoxFiles, identity, "firefox");
  targetMatch(firefox);
  assert(
    firefox.cases?.some((item) => item.name.includes("event-page restart")),
    "Firefox event-page/settings boundary coverage is required",
  );
  assert.deepEqual(
    firefox.projects,
    ["firefox-extension"],
    "Firefox extension conformance is required",
  );
  assert(
    firefox.cases?.some(
      (item) => item.surfaces?.nativeSidebar && item.surfaces?.minimizedArrival,
    ),
    "Firefox native surfaces are required",
  );
  assert(
    branded.cases?.every(
      (item) => item.surfaces?.nativeSidebar && item.surfaces?.minimizedArrival,
    ),
    "Branded native surfaces are required",
  );
  const firefoxAcceptance = await read(
    "output/acceptance/results-firefox.json",
  );
  requireFullEvidence(firefoxAcceptance, firefoxFiles, identity, "firefox");
  targetMatch(firefoxAcceptance);
  assert.deepEqual(
    firefoxAcceptance.projects?.sort(),
    ["acceptance-firefox-desktop", "acceptance-firefox-narrow"],
    "Complete Firefox acceptance is required",
  );
  for (const [path, names] of [
    ["output/acceptance/e2e-regressions.json", ["core-desktop", "narrow"]],
    [
      "output/qa/ui-build.json",
      ["ui-extension", "ui-website", "ui-website-firefox"],
    ],
    [
      "output/acceptance/live-regressions.json",
      ["live-desktop", "live-narrow"],
    ],
    [
      "output/acceptance/results.json",
      ["acceptance-desktop", "acceptance-narrow"],
    ],
  ]) {
    assert.deepEqual(
      (await read(path)).projects?.sort(),
      names.sort(),
      path + " must cover every required project",
    );
  }
  for (const [path, directories, field] of [
    ["output/qa/unit.json", ["tests/unit"], "suites"],
    [
      "output/qa/firefox-build.json",
      ["tests/browser/extension/firefox"],
      "files",
    ],
    [
      "output/qa/branded-build.json",
      ["tests/browser/extension/branded"],
      "files",
    ],
    [
      "output/qa/browser-performance.json",
      ["tests/browser/extension/performance"],
      "files",
    ],
    ["output/nlp/results.json", ["tests/integration/nlp"], "suites"],
    [
      "output/multi-app/runtime.json",
      ["tests/integration/multi-app"],
      "suites",
    ],
    ["output/vision/runtime.json", ["tests/integration/vision"], "suites"],
    [
      "output/acceptance/e2e-regressions.json",
      ["tests/browser/extension/core"],
      "files",
    ],
    [
      "output/acceptance/live-regressions.json",
      ["tests/browser/live"],
      "files",
    ],
    [
      "output/qa/ui-build.json",
      ["tests/browser/extension/ui", "tests/browser/website"],
      "files",
    ],
    ["output/nlp/browser-build.json", ["tests/browser/extension/nlp"], "files"],
    [
      "output/multi-app/browser.json",
      ["tests/browser/extension/multi-app"],
      "files",
    ],
    [
      "output/vision/browser.json",
      ["tests/browser/extension/continuity"],
      "files",
    ],
    [
      "output/reliability/browser.json",
      ["tests/browser/extension/reliability"],
      "files",
    ],
  ]) {
    const expected = (
      await Promise.all(
        directories.map((directory) =>
          sources(directory, field === "suites" ? ".test.ts" : ".spec.ts"),
        ),
      )
    )
      .flat()
      .sort();
    assert.deepEqual(
      (await read(path))[field]?.sort(),
      expected,
      path + " must retain every required suite owner",
    );
  }
  return identity;
}
if (process.argv[1]?.endsWith("verify-full.mjs")) {
  await verifyFull();
  console.log(
    "Full validation evidence matches one run and final build bytes.",
  );
}
