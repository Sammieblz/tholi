import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
const revision = "751bff37182d3f1213fa05d7196b954e230abad9";
const root = "assets/models/Xenova/all-MiniLM-L6-v2";
const names = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];
const lockPath = "assets/model-lock.json";
const previous = JSON.parse(await readFile(lockPath, "utf8").catch(() => "{}"));
if (previous.revision && previous.revision !== revision)
  throw new Error("Model revision and committed integrity manifest disagree.");
const files = {};
for (const name of names) {
  const path = `${root}/${name}`;
  let bytes = await readFile(path).catch(() => undefined);
  if (!bytes) {
    const response = await fetch(
      `https://huggingface.co/Xenova/all-MiniLM-L6-v2/resolve/${revision}/${name}`,
    );
    if (!response.ok)
      throw new Error(`Model download failed: ${name} (${response.status})`);
    bytes = Buffer.from(await response.arrayBuffer());
  }
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  const expected =
    previous.files?.[name]?.sha256 ||
    (name.endsWith(".onnx")
      ? "afdb6f1a0e45b715d0bb9b11772f032c399babd23bfc31fed1c170afc848bdb1"
      : undefined);
  if (expected && expected !== sha256)
    throw new Error(`Model integrity failed: ${name}`);
  await mkdir(path.slice(0, path.lastIndexOf("/")), { recursive: true });
  await writeFile(path, bytes);
  files[name] = { sha256, bytes: bytes.length };
}
await writeFile(
  lockPath,
  JSON.stringify(
    {
      model: "Xenova/all-MiniLM-L6-v2",
      revision,
      dtype: "q8",
      dimensions: 384,
      files,
    },
    null,
    2,
  ) + "\n",
);
console.log("Verified pinned offline MiniLM assets");
