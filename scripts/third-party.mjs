import {
  readFile,
  readdir,
  mkdir,
  copyFile,
  writeFile,
} from "node:fs/promises";
import { join } from "node:path";
export async function thirdParty(out) {
  const lock = JSON.parse(await readFile("package-lock.json", "utf8")),
    records = [];
  await mkdir(join(out, "licenses"), { recursive: true });
  for (const [path, metadata] of Object.entries(lock.packages)) {
    if (!path.includes("node_modules/") || metadata.dev || metadata.link)
      continue;
    const pkg = JSON.parse(
      await readFile(join(path, "package.json"), "utf8").catch(() => "{}"),
    );
    if (!pkg.name) continue;
    records.push({
      name: pkg.name,
      version: pkg.version,
      license: pkg.license || metadata.license,
      repository: pkg.repository,
    });
    const names = await readdir(path).catch(() => []);
    for (const name of names.filter((n) =>
      /^(?:licen[sc]e|notice)(?:\.|$)/i.test(n),
    ))
      await copyFile(
        join(path, name),
        join(out, "licenses", pkg.name.replaceAll("/", "_") + "-" + name),
      );
  }
  records.sort((a, b) => a.name.localeCompare(b.name));
  await writeFile(
    join(out, "third-party.json"),
    JSON.stringify(records, null, 2) + "\n",
  );
  await copyFile("LICENSE", join(out, "LICENSE"));
  await copyFile("THIRD_PARTY_NOTICES.md", join(out, "THIRD_PARTY_NOTICES.md"));
  await copyFile(
    "node_modules/@huggingface/transformers/LICENSE",
    join(out, "licenses", "model-Apache-2.0.txt"),
  );
}
