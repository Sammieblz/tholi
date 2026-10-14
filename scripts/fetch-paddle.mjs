import { readFile, writeFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "assets/paddle";
await mkdir(root, { recursive: true });
const lock = JSON.parse(await readFile("assets/paddle-lock.json", "utf8"));
for (const asset of lock.assets) {
  const path = root + "/" + asset.file;
  let bytes = await readFile(path).catch(() => undefined);
  const valid = (b) =>
    b &&
    b.length === asset.bytes &&
    createHash("sha256").update(b).digest("hex") === asset.sha256;
  if (!valid(bytes)) {
    const response = await fetch(asset.url);
    if (!response.ok)
      throw new Error("Paddle asset fetch failed: " + asset.file);
    bytes = Buffer.from(await response.arrayBuffer());
    if (!valid(bytes))
      throw new Error("Paddle asset hash mismatch: " + asset.file);
    await writeFile(path, bytes);
  }
}
