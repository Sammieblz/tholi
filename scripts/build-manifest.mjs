import { artifactFiles } from "./artifact-files.mjs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import assert from "node:assert/strict";
const paths = [
  "dist/demo",
  "dist/test-fixtures",
  "dist/extension",
  "dist/extension-firefox",
  "dist/web",
  "output/deploy/website",
  "apps/api/dist",
  "assets/models",
  "assets/ocr",
];
const file = "output/build-manifest.json";
export async function buildSnapshot() {
  return Object.fromEntries(
    await Promise.all(
      paths.map(async (path) => [path, await artifactFiles(path)]),
    ),
  );
}
export async function verifyBuildManifest() {
  assert.deepEqual(
    await buildSnapshot(),
    JSON.parse(await readFile(file, "utf8")),
    "Shared build artifacts differ",
  );
}
if (process.argv[1]?.endsWith("build-manifest.mjs")) {
  if (process.argv.includes("--verify")) await verifyBuildManifest();
  else {
    await mkdir("output", { recursive: true });
    await writeFile(
      file,
      JSON.stringify(await buildSnapshot(), null, 2) + "\n",
    );
  }
}
