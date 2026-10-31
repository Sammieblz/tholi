import { readFile, readdir } from "node:fs/promises";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { existsSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";

/** An explicit local-identity side build must never replace shared release bytes. */
export function websiteArtifactDirectory(
  root = process.cwd(),
  environment = process.env,
) {
  const configured = environment.THOLI_IDENTITY_WEB_DIRECTORY;
  if (!configured) return resolve(root, "dist/web");
  if (
    environment.THOLI_BROWSER_GROUP !== "identity-web" ||
    !isAbsolute(configured)
  )
    throw new Error(
      "Website artifact override requires the local identity group.",
    );
  const qa = realpathSync(resolve(root, "output/qa"));
  const target = resolve(configured);
  const within = relative(qa, target);
  if (
    !within ||
    within.startsWith(".." + sep) ||
    isAbsolute(within) ||
    within.split(sep).length < 2
  )
    throw new Error(
      "Website identity artifacts must be inside a dedicated QA directory.",
    );
  // Check existing ancestors too: a lexical QA path may traverse a junction.
  let ancestor = target;
  while (!existsSync(ancestor)) ancestor = resolve(ancestor, "..");
  const actual = relative(qa, realpathSync(ancestor));
  if (actual === ".." || actual.startsWith(".." + sep) || isAbsolute(actual))
    throw new Error("Website identity artifact ancestor escapes QA.");
  return target;
}

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
