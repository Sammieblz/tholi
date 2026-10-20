import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// Website delivery has its own cadence; extension/API versions remain synchronized.
export async function websiteVersion(requested = "--check") {
  const path = "apps/web/release.json";
  const metadata = JSON.parse(await readFile(path, "utf8"));
  const valid = (value) =>
    typeof value === "string" &&
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(value);
  assert(valid(metadata.version), "Website version must be X.Y.Z");
  const checking = requested === "--check";
  assert(
    checking || valid(requested),
    "Use --check or a website version X.Y.Z",
  );
  const version = checking ? metadata.version : requested;
  if (!checking) {
    const before = metadata.version.split(".").map(Number);
    const after = version.split(".").map(Number);
    const difference = after.findIndex((part, index) => part !== before[index]);
    assert(
      difference >= 0 && after[difference] > before[difference],
      "Website version must increase",
    );
  }
  const notes = `docs/releases/website/v${version}/README.md`;
  assert.equal(
    (await readFile(notes, "utf8")).split(/\r?\n/, 1)[0],
    `# Tholi website ${version}`,
    `Add website release notes at ${notes}`,
  );
  if (
    process.env.GITHUB_REF_TYPE === "tag" &&
    process.env.GITHUB_REF_NAME?.startsWith("web-v")
  )
    assert.equal(
      process.env.GITHUB_REF_NAME,
      `web-v${version}`,
      "Website tag must match website version",
    );
  if (!checking)
    await writeFile(
      path,
      JSON.stringify({ ...metadata, version }, null, 2) + "\n",
    );
  return { version, tag: `web-v${version}`, notes };
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  const release = await websiteVersion(process.argv[2]);
  console.log(
    `Tholi website ${release.version}: release notes and metadata agree.`,
  );
}
