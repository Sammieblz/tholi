import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function buildProvenance() {
  const artifactFiles: Record<string, string> = {};
  for (const name of (await readdir("dist/extension")).sort())
    artifactFiles[name] = createHash("sha256")
      .update(await readFile("dist/extension/" + name))
      .digest("hex");
  const manifest = JSON.parse(
    await readFile("dist/extension/manifest.json", "utf8"),
  );
  return { artifactFiles, extensionVersion: manifest.version as string };
}
