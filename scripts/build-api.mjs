import { build } from "esbuild";
await build({
  entryPoints: [
    "apps/api/src/cli.ts",
    "apps/api/src/server.ts",
    "apps/api/src/inference.ts",
  ],
  outdir: "apps/api/dist",
  bundle: true,
  platform: "node",
  target: "node24",
  format: "esm",
  packages: "external",
  sourcemap: true,
});
