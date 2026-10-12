import { readFile, readdir } from "node:fs/promises";
import { createHash } from "node:crypto";

export async function buildProvenance() {
  const artifactFiles: Record<string, string> = {};
  const names: string[] = [];
  async function walk(directory: string, prefix = "") {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory())
        await walk(directory + "/" + entry.name, name + "/");
      else names.push(name);
    }
  }
  await walk("dist/extension");
  for (const name of names.sort())
    artifactFiles[name] = createHash("sha256")
      .update(await readFile("dist/extension/" + name))
      .digest("hex");
  const manifest = JSON.parse(
    await readFile("dist/extension/manifest.json", "utf8"),
  );
  return { artifactFiles, extensionVersion: manifest.version as string };
}
