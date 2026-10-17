import { build } from "esbuild";
import { mkdir, realpath, readdir, unlink } from "node:fs/promises";
import { resolve, join } from "node:path";

const outdir = resolve("dist/test-fixtures");
await mkdir(outdir, { recursive: true });
if ((await realpath(outdir)) !== outdir)
  throw Error("Unexpected browser fixture output path");
for (const file of await readdir(outdir, { withFileTypes: true }))
  if (file.isFile() && /\.(js|css|woff2)$/.test(file.name))
    await unlink(join(outdir, file.name));

// Browser-only fixtures are shared immutable test artifacts, never shipped in
// the website, extension or API packages.
await build({
  entryPoints: {
    runtime: "tests/fixtures/multi-app/runtime-entry.ts",
    "auth-inspection": "tests/fixtures/live/auth-inspection.ts",
    "sidebar-presentation": "tests/fixtures/ui/sidebar-presentation.tsx",
    "widget-presentation": "tests/fixtures/ui/widget-presentation.tsx",
  },
  outdir,
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  jsx: "automatic",
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "file" },
  publicPath: "/__tholi_fixtures/",
});
