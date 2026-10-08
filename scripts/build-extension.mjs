import { build } from "esbuild";
import { mkdir, copyFile, rm } from "node:fs/promises";
const out = "dist/extension";
await mkdir(out, { recursive: true });
await build({
  entryPoints: {
    worker: "apps/extension/src/worker.ts",
    content: "apps/extension/src/content.ts",
    sidepanel: "apps/extension/src/sidepanel.tsx",
  },
  bundle: true,
  outdir: out,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
await copyFile("apps/extension/manifest.json", out + "/manifest.json");
await copyFile("apps/extension/sidepanel.html", out + "/sidepanel.html");
console.log("Unpacked extension ready: dist/extension");
