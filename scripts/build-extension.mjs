import { build } from "esbuild";
import {
  mkdir,
  copyFile,
  cp,
  readdir,
  unlink,
  realpath,
  readFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { resolve, join } from "node:path";
import { thirdParty } from "./third-party.mjs";
import { opencvCsp } from "./opencv-csp.mjs";
import { buildBrand } from "./build-brand.mjs";
const out = "dist/extension";
const withPaddle = process.argv.includes("--with-paddle");
const visionPolicy = JSON.parse(
  await readFile("assets/vision-policy.json", "utf8"),
);
if (visionPolicy.paddleDefault && !withPaddle)
  throw Error("Default Paddle inference requires a build with Paddle assets");
await import("./fetch-model.mjs");
await import("./fetch-ocr.mjs");
if (withPaddle) await import("./fetch-paddle.mjs");
await mkdir(out, { recursive: true });
// Remove obsolete generated chunks before building reproducible asset bytes.
const resolvedOut = resolve(out);
if (
  resolvedOut !== join(resolve("."), "dist", "extension") ||
  (await realpath(out)) !== resolvedOut
)
  throw Error("Unexpected extension output path");
for (const entry of await readdir(out, { withFileTypes: true }))
  if (entry.isFile() && /\.(?:js|js\.map|woff2)$/.test(entry.name))
    await unlink(join(resolvedOut, entry.name));
// Switching from an experimental build must not leave inactive models behind.
if (!withPaddle) {
  const paddleDirectory = join(resolvedOut, "paddle");
  const actual = await realpath(paddleDirectory).catch((error) => {
    if (error.code !== "ENOENT") throw error;
  });
  if (actual) {
    if (actual !== paddleDirectory) throw Error("Unexpected Paddle asset path");
    await rm(paddleDirectory, { recursive: true });
  }
  for (const name of ["paddle-lock.json", "opencv-adaptation.json"])
    await unlink(join(resolvedOut, name)).catch((error) => {
      if (error.code !== "ENOENT") throw error;
    });
}
await build({
  entryPoints: {
    worker: "apps/extension/src/entries/worker.ts",
    content: "apps/extension/src/entries/content.ts",
    "theme-page": "apps/extension/src/entries/theme-page.ts",
    "frame-agent": "apps/extension/src/entries/frame-agent.ts",
    sidepanel: "apps/extension/src/entries/sidepanel.tsx",
    offscreen: "apps/extension/src/entries/offscreen.ts",
  },
  bundle: true,
  outdir: out,
  format: "iife",
  target: "chrome120",
  sourcemap: true,
  define: { "process.env.NODE_ENV": '"production"' },
  loader: { ".woff2": "file" },
});
await build({
  entryPoints: { inference: "apps/extension/src/inference/nlp-worker.ts" },
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
await copyFile("apps/extension/widget.html", out + "/widget.html");
await buildBrand(out);
await thirdParty(out);

await build({
  entryPoints: { "ocr-worker": "apps/extension/src/inference/ocr-worker.ts" },
  outdir: out,
  bundle: true,
  format: "esm",
  platform: "browser",
  splitting: true,
  plugins: [
    ...(withPaddle ? [opencvCsp] : []),
    {
      name: "opencv-browser-only",
      setup(build) {
        build.onResolve({ filter: /^(fs|path)$/ }, (args) => ({
          path: args.path,
          namespace: "node-unavailable",
        }));
        build.onLoad({ filter: /.*/, namespace: "node-unavailable" }, () => ({
          contents: "export default {};",
          loader: "js",
        }));
      },
    },
  ],
  target: "chrome120",
  minify: true,
  define: {
    __PADDLE_BUNDLED__: String(withPaddle),
    __PADDLE_DEFAULT__: String(visionPolicy.paddleDefault),
  },
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
if (withPaddle) {
  await cp("assets/paddle", out + "/paddle", { recursive: true });
  await copyFile("assets/paddle-lock.json", out + "/paddle-lock.json");
  await copyFile(
    "assets/opencv-adaptation.json",
    out + "/opencv-adaptation.json",
  );
}
await writeFile(
  out + "/vision-policy.json",
  JSON.stringify({ ...visionPolicy, paddleBundled: withPaddle }, null, 2) +
    "\n",
);
await copyFile("assets/discovery-lock.json", out + "/discovery-lock.json");
await copyFile(
  "node_modules/playwright-core/LICENSE",
  out + "/licenses/playwright-discovery-Apache-2.0.txt",
);

console.log("Unpacked extension ready: dist/extension");
