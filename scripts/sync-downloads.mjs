import {
  readFile,
  readdir,
  mkdir,
  copyFile,
  writeFile,
  rm,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
export async function syncDownloads() {
  const records = [];
  for (const name of await readdir("output/releases").catch(() => [])) {
    if (!/^(?:tholi|internet-navigator)-\d+\.\d+\.\d+\.json$/.test(name))
      continue;
    const evidence = JSON.parse(
      await readFile(join("output/releases", name), "utf8"),
    );
    if (!evidence.archiveSha256 || !evidence.metrics || !evidence.regressions)
      continue;
    const file = name.replace(/\.json$/, ".zip"),
      bytes = await readFile(join("output/releases", file)).catch(
        () => undefined,
      );
    if (!bytes) continue;
    if (
      createHash("sha256").update(bytes).digest("hex") !==
      evidence.archiveSha256
    )
      throw Error("Packaged download checksum mismatch: " + file);
    records.push({
      version: evidence.extensionVersion,
      url: "/downloads/" + file,
      sha256: evidence.archiveSha256,
      bytes: bytes.length,
      status: evidence.status,
      file,
    });
  }
  records.sort((a, b) => {
    const av = a.version.split(".").map(Number),
      bv = b.version.split(".").map(Number);
    return bv[0] - av[0] || bv[1] - av[1] || bv[2] - av[2];
  });
  const latest = records[0];
  await mkdir("apps/public/downloads", { recursive: true });
  if (!latest) {
    await rm("apps/public/downloads/manifest.json", { force: true });
    console.log(
      "No eligible packaged extension available. Download UI will show source setup.",
    );
    return;
  }
  await copyFile(
    join("output/releases", latest.file),
    join("apps/public/downloads", latest.file),
  );
  const { file, ...manifest } = latest;
  await writeFile(
    "apps/public/downloads/manifest.json",
    JSON.stringify(manifest, null, 2) + "\n",
  );
  // Keep the generated website mirror small. Original gated archives remain
  // immutable in output/releases.
  const mirror = resolve("apps/public/downloads");
  for (const name of await readdir(mirror)) {
    if (
      !/^(?:tholi|internet-navigator)-\d+\.\d+\.\d+\.zip$/.test(name) ||
      name === latest.file
    )
      continue;
    const target = resolve(mirror, name);
    if (dirname(target) !== mirror)
      throw Error("Invalid mirrored archive path");
    await rm(target);
  }
  console.log("Download manifest: " + latest.version);
}
if (process.argv[1]?.endsWith("sync-downloads.mjs")) await syncDownloads();
