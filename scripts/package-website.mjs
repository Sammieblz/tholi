import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, access } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
import { websiteVersion } from "./website-version.mjs";
import { verifyFull } from "./verify-full.mjs";
import { artifactFiles } from "./artifact-files.mjs";
import { archiveExtension } from "./archive-extension.mjs";

const release = await websiteVersion();
const validation = await verifyFull();
const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
  encoding: "utf8",
}).trim();
assert.equal(
  execFileSync("git", ["status", "--porcelain", "--untracked-files=normal"], {
    encoding: "utf8",
  }).trim(),
  "",
  "Commit release source and notes before packaging website provenance",
);
assert(
  /^[a-f0-9]{40}$/.test(sourceRevision),
  "Missing website source revision",
);
const files = await artifactFiles("dist/web");
assert(files["index.html"], "Build the website before packaging");
assert.equal(
  JSON.parse(await readFile("dist/web/website-release.json", "utf8")).version,
  release.version,
  "Website build version must match release metadata",
);
await mkdir("output/releases", { recursive: true });
const stem = `output/releases/tholi-web-${release.version}`;
for (const suffix of [".zip", ".json", ".zip.sha256"]) {
  let exists = false;
  try {
    await access(stem + suffix);
    exists = true;
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  assert(
    !exists,
    "Website archives and evidence are immutable: " + stem + suffix,
  );
}
await archiveExtension(resolve("dist/web"), resolve(stem + ".zip"), files, {
  allowEmptyDirectories: true,
});
assert.deepEqual(
  await artifactFiles("dist/web"),
  files,
  "Website build changed during packaging",
);
const sha256 = createHash("sha256")
  .update(await readFile(stem + ".zip"))
  .digest("hex");
const { version: productVersion } = JSON.parse(
  await readFile("package.json", "utf8"),
);
await writeFile(
  stem + ".json",
  JSON.stringify(
    { ...release, productVersion, sourceRevision, validation, files, sha256 },
    null,
    2,
  ) + "\n",
  { flag: "wx" },
);
await writeFile(
  stem + ".zip.sha256",
  `${sha256}  tholi-web-${release.version}.zip\n`,
  { flag: "wx" },
);
console.log(`Verified website archive: ${stem}.zip`);
