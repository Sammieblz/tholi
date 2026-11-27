import { createHash } from "node:crypto";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { resolve, dirname } from "node:path";

if (process.argv.length !== 3 || process.argv[2] !== "--download")
  throw new Error(
    "Candidate assets require an explicit --download. They are not part of ordinary builds.",
  );
const root = resolve("assets/local-candidates"),
  lockPath = "assets/local-candidates-lock.json";
const previous = JSON.parse(await readFile(lockPath, "utf8").catch(() => "{}"));
const candidates = [
  {
    id: "bge-small",
    model: "Xenova/bge-small-en-v1.5",
    revision: "ea104dacec62c0de699686887e3f920caeb4f3e3",
    weightHash:
      "6c9c6101a956d62dfb5e7190c538226c0c5bb9cb27b651234b6df063ee7dbfe4",
  },
  {
    id: "e5-small",
    model: "Xenova/e5-small-v2",
    revision: "02af79985278377e65c724a76275707cb0333c70",
    weightHash:
      "7d9092cb25f2bd1c023b7e8d2aa459044a02030ac880e5a59fdaf27af69f1ded",
  },
];
const names = [
  "config.json",
  "tokenizer.json",
  "tokenizer_config.json",
  "special_tokens_map.json",
  "onnx/model_quantized.onnx",
];
const profiles = [];
for (const candidate of candidates) {
  const old = previous.profiles?.find((p) => p.id === candidate.id);
  if (old && old.revision !== candidate.revision)
    throw new Error("Candidate revision differs from its reviewed lock.");
  const files = {};
  for (const name of names) {
    const path = resolve(root, candidate.model, name);
    if (!path.startsWith(root + "/") && !path.startsWith(root + "\\"))
      throw new Error("Invalid candidate path.");
    let bytes = await readFile(path).catch(() => undefined);
    if (!bytes) {
      const response = await fetch(
        `https://huggingface.co/${candidate.model}/resolve/${candidate.revision}/${name}`,
        { signal: AbortSignal.timeout(60000) },
      );
      if (!response.ok)
        throw new Error(`Candidate download failed: ${candidate.id}/${name}`);
      const chunks = [];
      let size = 0;
      for await (const part of response.body) {
        size += part.byteLength;
        if (size > 40 * 1024 * 1024) {
          await response.body.cancel().catch(() => {});
          throw new Error("Candidate download exceeds its limit.");
        }
        chunks.push(part);
      }
      bytes = Buffer.concat(chunks);
    }
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const expected =
      old?.files?.[name]?.sha256 ||
      (name.endsWith(".onnx") ? candidate.weightHash : undefined);
    if (expected && sha256 !== expected)
      throw new Error(`Candidate integrity failed: ${candidate.id}/${name}`);
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, bytes);
    files[name] = { bytes: bytes.length, sha256 };
  }
  profiles.push({
    ...candidate,
    dtype: "q8",
    dimensions: 384,
    qualified: false,
    files,
  });
}
await writeFile(
  lockPath,
  JSON.stringify(
    {
      schemaVersion: 1,
      purpose: "Offline qualification only. No production pack is promoted.",
      profiles,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Verified two optional ranking candidates. Default extension assets are unchanged.",
);
