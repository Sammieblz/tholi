import { build } from "esbuild";
import { mkdir, copyFile, cp } from "node:fs/promises";
import { thirdParty } from "./third-party.mjs";
const out = "dist/extension";
await import("./fetch-model.mjs");
await import("./fetch-ocr.mjs");
await mkdir(out, { recursive: true });
await build({
  entryPoints: {
    worker: "apps/extension/src/worker.ts",
    content: "apps/extension/src/content.ts",
    "frame-agent": "apps/extension/src/frame-agent.ts",
    sidepanel: "apps/extension/src/sidepanel.tsx",
    offscreen: "apps/extension/src/offscreen.ts",
  },
  bundle: true,
  outdir: out,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"' },
});
await build({
  entryPoints: ["apps/extension/src/inference.ts"],
  outdir: out,
  bundle: true,
  format: "esm",
  target: "chrome120",
  minify: true,
  conditions: ["browser"],
  alias: {
    "@huggingface/transformers":
      "./node_modules/@huggingface/transformers/src/transformers.js",
    "onnxruntime-web/webgpu": "onnxruntime-web/wasm",
  },
  plugins: [
    {
      name: "browser-only-inference",
      setup(build) {
        build.onResolve(
          { filter: /^(node:|sharp$|\.\/onnx-node\.js$)/ },
          (args) => ({ path: args.path, namespace: "browser-empty" }),
        );
        build.onLoad({ filter: /.*/, namespace: "browser-empty" }, () => ({
          contents:
            "export default {}; export const Readable = undefined; export const pipeline = undefined;",
          loader: "js",
        }));
      },
    },
  ],
  define: { "process.env.NODE_ENV": '"production"' },
});
await copyFile("apps/extension/offscreen.html", out + "/offscreen.html");
await cp("assets/models", out + "/models", { recursive: true });
await mkdir(out + "/runtime", { recursive: true });
for (const name of [
  "ort-wasm-simd-threaded.wasm",
  "ort-wasm-simd-threaded.mjs",
])
  await copyFile(
    "node_modules/onnxruntime-web/dist/" + name,
    out + "/runtime/" + name,
  );
await copyFile("assets/model-lock.json", out + "/model-lock.json");
await copyFile("apps/extension/manifest.json", out + "/manifest.json");
await copyFile("apps/extension/sidepanel.html", out + "/sidepanel.html");
await thirdParty(out);
console.log("Unpacked extension ready: dist/extension");

await build({
  entryPoints: ["apps/extension/src/ocr-worker.ts"],
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "chrome120",
  minify: true,
});
await cp("assets/ocr", out + "/ocr", { recursive: true });
await copyFile("assets/ocr-lock.json", out + "/ocr-lock.json");
for (const file of [
  "tesseract-core-lstm.wasm.js",
  "tesseract-core-simd-lstm.wasm.js",
])
  await copyFile(
    "node_modules/tesseract.js-core/" + file,
    out + "/ocr/" + file,
  );
await copyFile(
  "node_modules/tesseract.js/dist/worker.min.js",
  out + "/ocr/worker.min.js",
);
