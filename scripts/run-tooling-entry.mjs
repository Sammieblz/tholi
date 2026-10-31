import { build } from "esbuild";
import { mkdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

export async function runToolingEntry(entry, name, args) {
  await mkdir("output/qa", { recursive: true });
  const file = `output/qa/${name}.mjs`;
  await build({
    entryPoints: [entry],
    outfile: file,
    bundle: true,
    platform: "node",
    target: "node24",
    format: "esm",
    packages: "external",
  });
  const result = spawnSync(process.execPath, [file, ...args], {
    stdio: "inherit",
  });
  process.exitCode = result.status ?? 1;
}
