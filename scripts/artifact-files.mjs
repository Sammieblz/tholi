import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { createHash } from "node:crypto";

// Packaging and test reports must describe the same recursively sorted bytes.
export async function artifactFiles(directory) {
  const names = [];
  async function walk(path, prefix = "") {
    for (const entry of await readdir(path, { withFileTypes: true })) {
      const name = prefix + entry.name;
      if (entry.isDirectory()) await walk(join(path, entry.name), name + "/");
      else if (entry.isFile()) names.push(name);
      else throw new Error("Unsupported artifact entry: " + name);
    }
  }
  await walk(directory);
  const files = {};
  for (const name of names.sort())
    files[name] = createHash("sha256")
      .update(await readFile(join(directory, name)))
      .digest("hex");
  return files;
}
