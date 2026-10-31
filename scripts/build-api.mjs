import { build } from "esbuild";
import { mkdir, readdir, realpath, unlink } from "node:fs/promises";
import { join, resolve } from "node:path";

const out = "apps/api/dist";
await mkdir(out, { recursive: true });
const resolvedOut = resolve(out);
if (
  resolvedOut !== join(resolve("."), "apps", "api", "dist") ||
  (await realpath(out)) !== resolvedOut
)
  throw new Error("Unexpected API output path.");
for (const entry of await readdir(out, { withFileTypes: true }))
  if (entry.isFile() && /\.(?:js|js\.map)$/.test(entry.name))
    await unlink(join(resolvedOut, entry.name));

await build({
  entryPoints: [
    "apps/api/src/cli.ts",
    "apps/api/src/service.ts",
    "apps/api/src/worker.ts",
    "apps/api/src/server.ts",
    "apps/api/src/inference.ts",
    "apps/api/src/ocr.ts",
    "apps/api/src/model-experiment.ts",
    "apps/api/src/model-evaluation.ts",
    { in: "apps/api/src/database/cli.ts", out: "database-cli" },
  ],
  outdir: out,
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  splitting: true,
  chunkNames: "[name]-[hash]",
  packages: "external",
  sourcemap: true,
});
