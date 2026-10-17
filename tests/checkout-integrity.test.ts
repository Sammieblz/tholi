import { test, expect } from "vitest";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { copyFile, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

test("Windows-style Git checkout preserves hashed recording text and frozen corpus bytes", async () => {
  const directory = await mkdtemp(join(tmpdir(), "tholi-checkout-"));
  const repository = join(directory, "repository");
  const checkout = join(directory, "checkout");
  const records: { file: string; sha256: string; bytes?: number }[] = [];
  const media = "apps/public/media/video";
  const provenance = JSON.parse(
    await readFile(`${media}/provenance.json`, "utf8"),
  );
  for (const theme of ["light", "dark"]) {
    const asset = provenance.variants[theme].assets.captions;
    records.push({
      file: `${media}/${asset.file}`,
      sha256: asset.sha256,
      bytes: asset.bytes,
    });
  }
  records.push({
    file: `${media}/${provenance.transcript.file}`,
    sha256: provenance.transcript.sha256,
  });
  for (const corpus of [
    "nlp",
    "multi-app",
    "continuity",
    "reliability-vision",
  ]) {
    records.push({
      file: `tests/${corpus}/corpus.json`,
      sha256: (await readFile(`tests/${corpus}/corpus.sha256`, "utf8")).trim(),
    });
  }
  try {
    await mkdir(repository);
    for (const file of [
      ".gitattributes",
      ...records.map((record) => record.file),
    ]) {
      await mkdir(dirname(join(repository, file)), { recursive: true });
      await copyFile(file, join(repository, file));
    }
    const git = (...args: string[]) =>
      execFileSync(
        "git",
        ["-c", "core.autocrlf=true", "-c", "core.safecrlf=false", ...args],
        { cwd: repository, stdio: "pipe" },
      );
    git("init", "--quiet");
    git("add", "--", ".gitattributes", ...records.map((record) => record.file));
    // This materializes fresh files rather than reading an existing LF worktree.
    git(
      "checkout-index",
      "--all",
      `--prefix=${checkout.replaceAll("\\", "/")}/`,
    );
    for (const record of records) {
      const bytes = await readFile(join(checkout, record.file));
      if (record.bytes !== undefined)
        expect(bytes.length, record.file).toBe(record.bytes);
      expect(
        createHash("sha256").update(bytes).digest("hex"),
        record.file,
      ).toBe(record.sha256);
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}, 15000);
