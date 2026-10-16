import { expect, test } from "vitest";
import {
  mkdtemp,
  mkdir,
  readFile,
  writeFile,
  rm,
  access,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

test("download sync accepts both release names, preserves archives and rejects tampered bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-downloads-"));
  const releases = join(directory, "output/releases");
  const mirror = join(directory, "apps/public/downloads");
  const script = resolve("scripts/sync-downloads.mjs");
  const run = () =>
    execFileSync(process.execPath, [script], { cwd: directory, stdio: "pipe" });
  const manifest = async () =>
    JSON.parse(await readFile(join(mirror, "manifest.json"), "utf8"));
  const archive = async (stem: string, version: string, bytes: Buffer) => {
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    await writeFile(join(releases, `${stem}.zip`), bytes);
    await writeFile(
      join(releases, `${stem}.json`),
      JSON.stringify({
        extensionVersion: version,
        archiveSha256: sha256,
        metrics: {},
        regressions: {},
        status: "fixture",
      }),
    );
    return sha256;
  };
  try {
    await mkdir(releases, { recursive: true });
    const legacy = Buffer.from("legacy packaged fixture");
    await archive("internet-navigator-0.10.0", "0.10.0", legacy);
    run();
    expect((await manifest()).url).toBe(
      "/downloads/internet-navigator-0.10.0.zip",
    );

    const current = Buffer.from("Tholi packaged fixture");
    const sha256 = await archive("tholi-0.10.1", "0.10.1", current);
    // Backend and unrelated records cannot become extension downloads.
    await writeFile(join(releases, "tholi-api-99.0.0.json"), "{}");
    run();
    expect(await manifest()).toMatchObject({
      version: "0.10.1",
      url: "/downloads/tholi-0.10.1.zip",
      sha256,
      bytes: current.length,
    });
    expect(await readFile(join(mirror, "tholi-0.10.1.zip"))).toEqual(current);
    await expect(
      access(join(mirror, "internet-navigator-0.10.0.zip")),
    ).rejects.toThrow();
    expect(
      await readFile(join(releases, "internet-navigator-0.10.0.zip")),
    ).toEqual(legacy);

    await writeFile(join(releases, "tholi-0.10.1.zip"), "tampered");
    expect(run).toThrow(/Packaged download checksum mismatch/);
    expect((await manifest()).sha256).toBe(sha256);
    expect(await readFile(join(mirror, "tholi-0.10.1.zip"))).toEqual(current);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
