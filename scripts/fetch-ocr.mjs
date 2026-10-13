import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const lock = JSON.parse(await readFile("assets/ocr-lock.json", "utf8"));
await mkdir("assets/ocr", { recursive: true });
for (const file of lock.files) {
  const path = "assets/ocr/" + file.name;
  let bytes = await readFile(path).catch(() => undefined);
  const hash = (b) => createHash("sha256").update(b).digest("hex");
  if (!bytes || hash(bytes) !== file.sha256) {
    const response = await fetch(file.url);
    if (!response.ok) throw new Error("OCR asset fetch failed");
    bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length !== file.bytes || hash(bytes) !== file.sha256)
      throw new Error("OCR asset integrity mismatch");
    await writeFile(path, bytes);
  }
}
