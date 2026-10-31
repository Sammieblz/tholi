import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { artifactFiles } from "../../../scripts/artifact-files.mjs";
import { vertexNavigationProvenance } from "./adapters/vertex-navigation-model";

const hash = (value: string | Uint8Array) =>
  createHash("sha256").update(value).digest("hex");
export const evaluationProtocolFile =
  "docs/development/testing/perception-comparison.md";

/** Derive provenance from the real owners and bytes, never a parallel prompt or capture policy. */
export async function evaluationProvenance(root = process.cwd()) {
  const git = (args: string[]) =>
    execFileSync("git", args, {
      cwd: root,
      encoding: "utf8",
      windowsHide: true,
    });
  const sourceRevision = git(["rev-parse", "HEAD"]).trim();
  const names = [
    ...new Set(
      git([
        "ls-files",
        "--cached",
        "--others",
        "--exclude-standard",
        "-z",
        "--",
        "apps",
        "packages",
        "routes",
        "tests",
        "config",
        "scripts",
        "package.json",
        "package-lock.json",
        "tsconfig.json",
        "vitest.config.ts",
        "playwright.config.ts",
        evaluationProtocolFile,
      ])
        .split("\0")
        .filter(Boolean),
    ),
  ].sort();
  const files: Record<string, string> = {};
  for (const name of names)
    files[name] = hash(await readFile(resolve(root, name)));
  const manifestBytes = await readFile(
    resolve(root, "output/build-manifest.json"),
  );
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  for (const [directory, expected] of Object.entries(manifest)) {
    if (
      !/^(?:dist\/(?:demo|test-fixtures|extension|extension-firefox|web)|output\/deploy\/website|apps\/api\/dist|assets\/(?:models|ocr))$/.test(
        directory,
      )
    )
      throw Error("Unexpected build provenance directory.");
    if (
      JSON.stringify(await artifactFiles(resolve(root, directory))) !==
      JSON.stringify(expected)
    )
      throw Error("Evaluation build bytes changed.");
  }
  if (!manifest["dist/extension"] || !manifest["apps/api/dist"])
    throw Error("Evaluation build provenance is incomplete.");
  const captureFiles = Object.fromEntries(
    Object.entries(files).filter(([name]) =>
      /^(?:packages\/(?:vision|page-discovery)\/|packages\/navigation-core\/privacy\.ts$|apps\/extension\/src\/(?:background\/(?:frame-coordinator|journey-service|vision-service)|platform\/|content\/(?:observation-composition|visual-guidance|page-coach|runtime)))/.test(
        name,
      ),
    ),
  );
  if (!Object.keys(captureFiles).length)
    throw Error("Capture policy provenance is missing.");
  return {
    sourceRevision,
    clean:
      git(["status", "--porcelain", "--untracked-files=normal"]).trim() === "",
    hashes: {
      sourceSha256: hash(JSON.stringify(files)),
      extensionBuildSha256: hash(JSON.stringify(manifest["dist/extension"])),
      buildManifestSha256: hash(manifestBytes),
      ...vertexNavigationProvenance(),
      capturePolicySha256: hash(JSON.stringify(captureFiles)),
      protocolSha256: hash(
        await readFile(resolve(root, evaluationProtocolFile)),
      ),
      corpusSha256: hash(
        await readFile(
          resolve(root, "tests/fixtures/navigation-baseline/corpus.json"),
        ),
      ),
      holdoutSha256: hash(
        await readFile(
          resolve(
            root,
            "tests/fixtures/perception-comparison/fresh-holdout.json",
          ),
        ),
      ),
    },
  };
}
