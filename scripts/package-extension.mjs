import { verifyFull } from "./verify-full.mjs";
import { requireFullEvidence } from "./evidence.mjs";
import { visionEvidence } from "./verify-vision-release.mjs";
import { readFile, stat, mkdir, writeFile } from "node:fs/promises";
import { artifactFiles } from "./artifact-files.mjs";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { archiveExtension } from "./archive-extension.mjs";
import { multiAppEvidence } from "./verify-multi-app-release.mjs";
import { reliabilityEvidence } from "./verify-reliability-release.mjs";

await verifyFull();

// Package the exact build that passed evaluation; never rebuild or overwrite it.
const extension = resolve("dist/extension");
const manifest = JSON.parse(
  await readFile(join(extension, "manifest.json"), "utf8"),
);
if (!/^\d+\.\d+\.\d+$/.test(manifest.version))
  throw new Error("Invalid release version");
const report = JSON.parse(
  await readFile("output/acceptance/results.json", "utf8"),
);
if (!report.passed || report.extensionVersion !== manifest.version)
  throw new Error(
    "Run the complete passing acceptance matrix for this version before packaging",
  );
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const files = await artifactFiles(extension);
const fullIdentity = requireFullEvidence(report, files);
requireFullEvidence(
  JSON.parse(await readFile("output/qa/unit.json", "utf8")),
  files,
  fullIdentity,
);
const ui = JSON.parse(await readFile("output/qa/ui-build.json", "utf8"));
if (
  !ui.passed ||
  !ui.cases?.length ||
  ui.extensionVersion !== manifest.version ||
  JSON.stringify(ui.artifactFiles) !== JSON.stringify(files)
)
  throw Error(
    "Run the full Tholi UI suite on these exact build bytes before packaging",
  );
requireFullEvidence(ui, files, fullIdentity);
const multiApp = await multiAppEvidence(files);
const vision = await visionEvidence(files);
const reliability = await reliabilityEvidence(files);
const nlp = JSON.parse(await readFile("output/nlp/results.json", "utf8"));
const nlpBrowser = JSON.parse(
  await readFile("output/nlp/browser-build.json", "utf8"),
);
if (
  !nlp.passed ||
  nlp.precision < 0.95 ||
  nlp.coverage < 0.85 ||
  nlp.falseCompletions ||
  nlp.boundaryBypasses ||
  nlp.warmP95Ms >= 750 ||
  nlp.unpackedBytes >= 100 * 1024 * 1024 ||
  JSON.stringify(nlp.artifactFiles) !== JSON.stringify(files) ||
  JSON.stringify(nlpBrowser.artifactFiles) !== JSON.stringify(files) ||
  !nlpBrowser.passed
)
  throw new Error(
    "Run complete passing real-model, API and NLP browser tests for these build bytes before packaging",
  );
if (JSON.stringify(files) !== JSON.stringify(report.artifactFiles))
  throw new Error(
    "Build differs from the evaluated artifact; rerun acceptance",
  );
const regressions = {};
for (const scope of ["e2e", "live"]) {
  const r = JSON.parse(
    await readFile(`output/acceptance/${scope}-regressions.json`, "utf8"),
  );
  if (
    !r.passed ||
    r.extensionVersion !== manifest.version ||
    JSON.stringify(r.artifactFiles) !== JSON.stringify(files)
  )
    throw new Error(
      `Run the full passing ${scope} regression suite for this exact build before packaging`,
    );
  requireFullEvidence(r, files, fullIdentity);
  regressions[scope] = {
    passed: r.passed,
    count: r.cases.length,
    evaluatedAt: r.evaluatedAt,
  };
}
const requested =
  process.argv.find((arg) => arg.startsWith("--target="))?.split("=")[1] ||
  "all";
if (!["all", "chromium", "firefox"].includes(requested))
  throw Error("Unknown extension target");
const targets = requested === "all" ? ["chromium", "firefox"] : [requested];
const release = resolve("output/releases");
await mkdir(release, { recursive: true });
// Check every candidate name before creating any archive. Existing releases are immutable.
for (const target of targets)
  for (const suffix of [".zip", ".sha256", ".json"]) {
    const name = `tholi${target === "firefox" ? "-firefox" : ""}-${manifest.version}`;
    if (await stat(join(release, name + suffix)).catch(() => undefined))
      throw Error(
        "Release artifact already exists; preserve it and bump the version.",
      );
  }
if (
  targets.includes("chromium") &&
  (await stat(
    join(release, `internet-navigator-${manifest.version}.zip`),
  ).catch(() => undefined))
)
  throw Error("Preserve the existing legacy archive and bump the version.");
for (const target of targets) {
  const directory =
    target === "firefox" ? resolve("dist/extension-firefox") : extension;
  const evaluated =
    target === "firefox"
      ? JSON.parse(
          await readFile("output/acceptance/results-firefox.json", "utf8"),
        )
      : report;
  const evaluatedFiles = await artifactFiles(directory);
  requireFullEvidence(evaluated, evaluatedFiles, fullIdentity, target);
  const name = `tholi${target === "firefox" ? "-firefox" : ""}-${manifest.version}`;
  const archive = join(release, name + ".zip");
  await archiveExtension(directory, archive, evaluatedFiles);
  const archiveSha256 = sha(await readFile(archive));
  await writeFile(
    join(release, name + ".sha256"),
    archiveSha256 + "  " + name + ".zip\n",
    { flag: "wx" },
  );
  await writeFile(
    join(release, name + ".json"),
    JSON.stringify(
      {
        status:
          "candidate: native installation and handoff require browser-specific verification",
        target,
        minimumBrowserVersion: target === "firefox" ? "153" : "140",
        installationKind: target === "firefox" ? "temporary" : "unpacked",
        extensionVersion: manifest.version,
        archiveSha256,
        files: evaluatedFiles,
        validation: evaluated.validation,
        buildTargets: evaluated.buildTargets,
        sourceRevision: evaluated.sourceRevision,
        workingTreeDirty: evaluated.workingTreeDirty,
        evaluatedAt: evaluated.evaluatedAt,
        packagedAt: new Date().toISOString(),
        matrixSha256: evaluated.matrixSha256,
        metrics: evaluated.summaries,
        regressions,
        ui: {
          cases: ui.cases.length,
          evaluatedAt: ui.evaluatedAt,
          native: "pending browser-specific native verification",
          motion: ui.cases.find((c) => c.motion)?.motion,
        },
        multiApp,
        vision,
        reliability,
        optionalAI:
          "Capability-gated experiment; the shared baseline uses bundled single-thread CPU MiniLM",
        nlp: {
          precision: nlp.precision,
          coverage: nlp.coverage,
          warmP95Ms: nlp.warmP95Ms,
          hardware: nlp.hardware,
          llmCalls: nlp.llmCalls,
          embeddingActivity: nlp.embeddingActivity,
        },
        checklist: "docs/guides/getting-started.md",
        pending: [
          "signed-in workflow variants",
          "native keyboard and screen reader",
          "browser-specific native permission denial and handoff",
        ],
      },
      null,
      2,
    ) + "\n",
    { flag: "wx" },
  );
  console.log(
    `Verified ${target} candidate: ${archive}\nSHA256: ${archiveSha256}`,
  );
}
await (await import("./sync-downloads.mjs")).syncDownloads();
