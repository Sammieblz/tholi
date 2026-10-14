import { readFile } from "node:fs/promises";
import { artifactFiles as hashArtifacts } from "../../scripts/artifact-files.mjs";

export async function buildProvenance() {
  const artifactFiles = await hashArtifacts("dist/extension");
  const manifest = JSON.parse(
    await readFile("dist/extension/manifest.json", "utf8"),
  );
  return { artifactFiles, extensionVersion: manifest.version as string };
}
