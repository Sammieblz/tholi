import { visionEvidence } from "./verify-vision-release.mjs";
import { readFile, readdir, stat, mkdir, writeFile } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { multiAppEvidence } from "./verify-multi-app-release.mjs";

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
const files = {};
const names = [];
async function walk(directory, prefix = "") {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const name = prefix + entry.name;
    if (entry.isDirectory())
      await walk(join(directory, entry.name), name + "/");
    else names.push(name);
  }
}
await walk(extension);
for (const name of names.sort()) {
  files[name] = sha(await readFile(join(extension, name)));
}
const multiApp = await multiAppEvidence(files);
const vision = await visionEvidence(files);
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
  nlp.unpackedBytes >= 60 * 1024 * 1024 ||
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
  regressions[scope] = {
    passed: r.passed,
    count: r.cases.length,
    evaluatedAt: r.evaluatedAt,
  };
}
const release = resolve("output/releases");
await mkdir(release, { recursive: true });
const name = `internet-navigator-${manifest.version}`;
const archive = join(release, name + ".zip");
if (await stat(archive).catch(() => undefined))
  throw new Error(
    "Release archive already exists; preserve it and bump the version for changes",
  );
const quote = (s) => "'" + s.replaceAll("'", "''") + "'";
execFileSync("powershell.exe", [
  "-NoProfile",
  "-Command",
  "$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n" +
    "[System.IO.Compression.ZipFile]::CreateFromDirectory(" +
    quote(extension) +
    "," +
    quote(archive) +
    ",[System.IO.Compression.CompressionLevel]::Optimal,$false)",
]);
// Read every zipped member back and compare its bytes with the evaluated build.
const zipped = JSON.parse(
  execFileSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-Command",
      "$ErrorActionPreference='Stop'\nAdd-Type -AssemblyName System.IO.Compression.FileSystem\n" +
        "$taskZip=[System.IO.Compression.ZipFile]::OpenRead(" +
        quote(archive) +
        ")\n" +
        "try { @($taskZip.Entries | ForEach-Object { $taskStream=$_.Open(); try { $taskHash=[System.Security.Cryptography.SHA256]::Create(); [pscustomobject]@{name=$_.FullName;sha256=([BitConverter]::ToString($taskHash.ComputeHash($taskStream))).Replace('-','').ToLowerInvariant()} } finally { $taskStream.Dispose();$taskHash.Dispose() } }) | ConvertTo-Json -Compress } finally {$taskZip.Dispose()}",
    ],
    { encoding: "utf8" },
  ),
);
if (
  zipped.length !== Object.keys(files).length ||
  zipped.some((f) => files[f.name.replaceAll("\\", "/")] !== f.sha256)
)
  throw new Error("Archive verification failed");
const archiveSha256 = sha(await readFile(archive));
await writeFile(
  join(release, name + ".sha256"),
  archiveSha256 + "  " + name + ".zip\n",
);
await writeFile(
  join(release, name + ".json"),
  JSON.stringify(
    {
      status: "candidate: native Chrome handoff pending",
      extensionVersion: manifest.version,
      archiveSha256,
      files,
      sourceRevision: report.sourceRevision,
      workingTreeDirty: report.workingTreeDirty,
      evaluatedAt: report.evaluatedAt,
      packagedAt: new Date().toISOString(),
      matrixSha256: report.matrixSha256,
      metrics: report.summaries,
      regressions,
      multiApp,
      vision,
      optionalAI:
        "Experimental LLM disabled; real CPU MiniLM evaluated separately",
      nlp: {
        precision: nlp.precision,
        coverage: nlp.coverage,
        warmP95Ms: nlp.warmP95Ms,
        hardware: nlp.hardware,
        llmCalls: nlp.llmCalls,
        embeddingActivity: nlp.embeddingActivity,
      },
      checklist: "docs/chrome-handoff.md",
      pending: [
        "six-platform signed-in workflow verification",
        "native side-panel reload/activation",
        "native keyboard and screen reader",
        "per-site permission denial/recovery",
      ],
    },
    null,
    2,
  ) + "\n",
);
console.log(`Verified candidate: ${archive}\nSHA256: ${archiveSha256}`);
