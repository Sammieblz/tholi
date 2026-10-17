import { verifyFull } from "./verify-full.mjs";
import { requireFullEvidence } from "./evidence.mjs";
import { visionEvidence } from "./verify-vision-release.mjs";
import { readFile, mkdir, cp, writeFile, stat } from "node:fs/promises";
import { resolve, join } from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { thirdParty } from "./third-party.mjs";
import { artifactFiles } from "./artifact-files.mjs";
import { multiAppEvidence } from "./verify-multi-app-release.mjs";
import { reliabilityEvidence } from "./verify-reliability-release.mjs";
await verifyFull();
const report = JSON.parse(await readFile("output/nlp/results.json", "utf8"));
const fullIdentity = requireFullEvidence(report, report.artifactFiles);
requireFullEvidence(
  JSON.parse(await readFile("output/qa/unit.json", "utf8")),
  report.artifactFiles,
  fullIdentity,
);
if (!report.passed)
  throw new Error(
    "Run passing real-model and API validation before packaging.",
  );
const apiFiles = await artifactFiles("apps/api/dist");
if (JSON.stringify(apiFiles) !== JSON.stringify(report.apiArtifactFiles))
  throw new Error("API bytes differ from the passing evaluation.");
const multiApp = await multiAppEvidence(report.artifactFiles, apiFiles);
const vision = await visionEvidence(report.artifactFiles, apiFiles);
const reliability = await reliabilityEvidence(report.artifactFiles);
const apiPackage = JSON.parse(await readFile("apps/api/package.json", "utf8"));
const version = apiPackage.version;
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("Invalid version");
const release = resolve("output/releases"),
  staging = join(release, "backend-" + version),
  name = "tholi-api-" + version;
await mkdir(release, { recursive: true });
if (
  (await stat(join(release, name + ".tgz")).catch(() => undefined)) ||
  (await stat(join(release, `internet-navigator-api-${version}.tgz`)).catch(
    () => undefined,
  ))
)
  throw new Error("Preserve the existing release; bump the version.");
await mkdir(staging, { recursive: true });
await cp("apps/api/dist", join(staging, "dist"), { recursive: true });
await cp("assets/ocr", join(staging, "assets/ocr"), { recursive: true });
await cp("assets/ocr-lock.json", join(staging, "assets/ocr-lock.json"));
await cp("assets/models", join(staging, "assets/models"), { recursive: true });
await cp("assets/model-lock.json", join(staging, "assets/model-lock.json"));
const rootPackage = JSON.parse(await readFile("package.json", "utf8"));
const setupSource = new URL(
  "blob/main/docs/guides/backend.md",
  rootPackage.repository.url.replace(/\.git$/, "") + "/",
);
const setup = (await readFile("docs/guides/backend.md", "utf8")).replace(
  /\]\(([^)]+)\)/g,
  (match, href) =>
    /^[a-z][a-z0-9+.-]*:|^#/i.test(href)
      ? match
      : `](${new URL(href, setupSource).href})`,
);
await writeFile(join(staging, "README.md"), setup);
await thirdParty(staging);
const dependencies = {};
const lock = JSON.parse(await readFile("package-lock.json", "utf8"));
for (const dependency of [
  "tesseract.js",
  "tesseract.js-core",
  "compromise",
  "@huggingface/transformers",
  "zod",
  "fastify",
  "@fastify/cors",
  "@fastify/swagger",
  "zod-to-json-schema",
])
  dependencies[dependency] =
    lock.packages["node_modules/" + dependency].version;
await writeFile(
  join(staging, "package.json"),
  JSON.stringify(
    {
      name: apiPackage.name,
      description: apiPackage.description,
      version,
      type: "module",
      license: "MIT",
      engines: { node: ">=24.19.0 <25" },
      scripts: { start: "node dist/cli.js" },
      dependencies,
    },
    null,
    2,
  ) + "\n",
);
const npm = process.platform === "win32" ? "npm.cmd" : "npm";
const opts = {
  cwd: staging,
  encoding: "utf8",
  shell: process.platform === "win32",
};
execFileSync(npm, ["install", "--package-lock-only", "--ignore-scripts"], opts);
await cp(
  join(staging, "package-lock.json"),
  join(staging, "npm-shrinkwrap.json"),
);
const packed = JSON.parse(
  execFileSync(npm, ["pack", "--json", "--ignore-scripts"], opts),
)[0];
const archive = join(release, name + ".tgz");
await cp(join(staging, packed.filename), archive);
const sha256 = createHash("sha256")
  .update(await readFile(archive))
  .digest("hex");
await writeFile(
  join(release, name + ".sha256"),
  sha256 + "  " + name + ".tgz\n",
);
await writeFile(
  join(release, name + ".json"),
  JSON.stringify(
    {
      version,
      sha256,
      node: "24.19.x",
      modelRevision: "751bff37182d3f1213fa05d7196b954e230abad9",
      evaluatedAt: report.evaluatedAt,
      apiTestsPassed: report.passed,
      multiApp,
      vision,
      reliability,
      setup: "docs/guides/backend.md",
    },
    null,
    2,
  ) + "\n",
);
console.log("Verified backend package: " + archive + "\nSHA256: " + sha256);
