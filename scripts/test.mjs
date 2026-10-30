import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";
import { randomUUID } from "node:crypto";
const task = process.argv[2] || "unit";
const args = process.argv.slice(3);
const group = args.includes("--group")
  ? args[args.indexOf("--group") + 1]
  : undefined;
const forwarded = args.filter(
  (_, index) =>
    !args.includes("--group") ||
    (index !== args.indexOf("--group") &&
      index !== args.indexOf("--group") + 1),
);
const full =
  task !== "ci" &&
  (process.env.THOLI_TEST_TIER === "full" ||
    [
      "full",
      "brands",
      "browser-performance",
      "live",
      "navigation-baseline",
      "acceptance",
      "acceptance-chromium",
      "acceptance-firefox",
      "models",
      "ui",
      "reliability",
      "multi-app-browser",
      "nlp",
      "multi-app",
      "vision",
      "identity",
      "identity-web",
    ].includes(task));
const env = {
  ...process.env,
  THOLI_TEST_TIER: full ? "full" : "pr",
  THOLI_VALIDATION_RUN: process.env.THOLI_VALIDATION_RUN || randomUUID(),
};
env.THOLI_VALIDATION_SELECTION =
  ["ci", "full"].includes(task) && !forwarded.length ? "complete" : "focused";
const timings = [];
function run(label, file, parameters) {
  const start = Date.now();
  const result = spawnSync(process.execPath, [file, ...parameters], {
    stdio: "inherit",
    env,
  });
  timings.push({
    task: label,
    elapsedMs: Date.now() - start,
    exitCode: result.status ?? 1,
  });
  mkdirSync("output/qa", { recursive: true });
  writeFileSync(
    `output/qa/timing-${task}-${group || "all"}.json`,
    JSON.stringify(
      { tier: env.THOLI_TEST_TIER, runId: env.THOLI_VALIDATION_RUN, timings },
      null,
      2,
    ),
  );
  if (result.status !== 0) process.exit(result.status || 1);
}
function npm(script) {
  run(
    script,
    process.env.npm_execpath ||
      fileURLToPath(
        new URL(
          "node_modules/npm/bin/npm-cli.js",
          pathToFileURL(process.execPath),
        ),
      ),
    ["run", script],
  );
}
function vitest(scope) {
  env.THOLI_RUNTIME_SCOPE = scope;
  run(scope, "node_modules/vitest/vitest.mjs", [
    "run",
    `--project=${scope}`,
    ...forwarded,
  ]);
}
const browserGroups = {
  identity: ["native-identity"],
  "identity-web": ["identity-web-chromium", "identity-web-firefox"],
  "navigation-baseline": ["navigation-baseline"],
  core: ["core-desktop", "narrow"],
  integration: ["nlp", "multi-app", "continuity", "reliability"],
  ui: ["ui-extension", "ui-website", "ui-website-firefox"],
  firefox: ["firefox-extension"],
  brands: ["branded-browsers"],
  "browser-performance": ["browser-performance"],
  live: ["live-desktop", "live-narrow"],
  acceptance: [
    "acceptance-desktop",
    "acceptance-narrow",
    "acceptance-firefox-desktop",
    "acceptance-firefox-narrow",
  ],
  "acceptance-chromium": ["acceptance-desktop", "acceptance-narrow"],
  "acceptance-firefox": [
    "acceptance-firefox-desktop",
    "acceptance-firefox-narrow",
  ],
  "nlp-browser": ["nlp"],
  "multi-app-browser": ["multi-app"],
  continuity: ["continuity"],
  reliability: ["reliability"],
};
function browser(scope) {
  env.THOLI_BROWSER_GROUP = scope;
  env.THOLI_BROWSER_NETWORK = ["identity", "identity-web"].includes(scope)
    ? "local-identity"
    : [
          "navigation-baseline",
          "live",
          "acceptance",
          "acceptance-chromium",
          "acceptance-firefox",
        ].includes(scope)
      ? "public"
      : "fixtures";
  run(scope, "node_modules/playwright/cli.js", [
    "test",
    ...(forwarded.some((arg) => arg.startsWith("--project"))
      ? []
      : browserGroups[scope].map((project) => `--project=${project}`)),
    ...forwarded,
  ]);
}
if (["nlp", "multi-app", "vision", "nlp-browser"].includes(task))
  npm("build:api");
if (["ci", "full"].includes(task) && !env.THOLI_BUILD_PREPARED) {
  npm("typecheck");
  npm("build");
  run("freeze-build", "scripts/build-manifest.mjs", []);
}
if (["ci", "full"].includes(task) && env.THOLI_BUILD_PREPARED)
  run("verify-build", "scripts/build-manifest.mjs", ["--verify"]);
if (["ci", "full"].includes(task)) env.THOLI_BUILD_PREPARED = "1";
if (["ci", "full"].includes(task)) {
  const scopes = group
    ? [group]
    : task === "full"
      ? [
          "unit",
          "models",
          "core",
          "integration",
          "firefox",
          "ui",
          "brands",
          "browser-performance",
          "live",
          "acceptance-chromium",
          "acceptance-firefox",
        ]
      : ["unit", "core", "integration", "firefox", "ui"];
  for (const scope of scopes) {
    if (scope === "unit") vitest("unit");
    else if (scope === "models")
      for (const model of ["nlp", "multi-app", "vision"]) vitest(model);
    else if (browserGroups[scope]) browser(scope);
    else throw Error("Unknown test group: " + scope);
  }
} else if (["unit", "nlp", "multi-app", "vision"].includes(task)) {
  if (task !== "unit" && !existsSync("dist/extension/manifest.json"))
    npm("build:extension");
  vitest(task);
} else if (browserGroups[task]) browser(task);
else throw Error("Unknown test task: " + task);

if (task === "full" && !group) run("certify", "scripts/verify-full.mjs", []);
