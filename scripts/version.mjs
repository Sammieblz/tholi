import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

// The root package owns the release number; workspace names and storage/schema
// versions are compatibility identifiers and must not be renamed by this tool.
export async function syncVersion(requested) {
  const root = process.cwd();
  const read = async (path) =>
    JSON.parse(await readFile(resolve(root, path), "utf8"));
  const valid = (version) =>
    /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/.test(version) &&
    version.split(".").every((part) => Number(part) <= 65535);
  const metadata = await read("package.json");
  assert(
    valid(metadata.version),
    "Root version must be a browser-compatible X.Y.Z",
  );
  const paths = [
    "package.json",
    ...metadata.workspaces.map((path) => `${path}/package.json`),
  ];
  const packages = await Promise.all(paths.map(read));
  const names = new Set(packages.slice(1).map((pkg) => pkg.name));
  const manifest = await read("apps/extension/manifest.json");
  const lock = await read("package-lock.json");
  const checking = requested === "--check";
  assert(
    checking || valid(requested || ""),
    "Use --check or a release version X.Y.Z",
  );
  const version = checking ? metadata.version : requested;

  if (!checking) {
    const before = metadata.version.split(".").map(Number);
    const after = version.split(".").map(Number);
    const difference = after.findIndex((part, index) => part !== before[index]);
    assert(
      difference >= 0 && after[difference] > before[difference],
      "Release version must increase",
    );
  }
  const notes = `docs/releases/v${version}/README.md`;
  assert(
    (await readFile(resolve(root, notes), "utf8")).split(/\r?\n/, 1)[0] ===
      `# Tholi ${version}`,
    `Add version-specific release notes at ${notes} before versioning`,
  );

  for (let index = 0; index < packages.length; index++) {
    const pkg = packages[index];
    const path = paths[index];
    const key = index === 0 ? "" : path.slice(0, -"/package.json".length);
    const locked = lock.packages[key];
    assert(locked, `${path} is missing from package-lock.json`);
    if (checking) {
      assert.equal(pkg.version, version, `${path} version drift`);
      assert.equal(locked.version, version, `${path} lockfile version drift`);
    } else pkg.version = locked.version = version;
    for (const field of [
      "dependencies",
      "devDependencies",
      "optionalDependencies",
      "peerDependencies",
    ])
      for (const name of Object.keys(pkg[field] || {})) {
        if (!names.has(name)) continue;
        if (checking) {
          assert.equal(
            pkg[field][name],
            version,
            `${path}: ${name} version drift`,
          );
          assert.equal(
            locked[field]?.[name],
            version,
            `${path}: ${name} lockfile drift`,
          );
        } else {
          pkg[field][name] = version;
          (locked[field] ||= {})[name] = version;
        }
      }
  }
  if (checking) {
    assert.equal(lock.version, version, "Root lockfile version drift");
    assert.equal(manifest.version, version, "Extension manifest version drift");
    if (process.env.GITHUB_REF_TYPE === "tag")
      assert.equal(
        process.env.GITHUB_REF_NAME,
        `v${version}`,
        "Release tag must match package version",
      );
    console.log(
      `Tholi ${version}: packages, lockfile, extension and release notes agree.`,
    );
  } else {
    manifest.version = lock.version = version;
    // Complete every read and validation before changing metadata. External
    // dependency resolutions, frozen inputs and historical evidence stay intact.
    for (const [index, path] of paths.entries())
      await writeFile(
        resolve(root, path),
        JSON.stringify(packages[index], null, 2) + "\n",
      );
    for (const [path, value] of [
      ["package-lock.json", lock],
      ["apps/extension/manifest.json", manifest],
    ])
      await writeFile(
        resolve(root, path),
        JSON.stringify(value, null, 2) + "\n",
      );
    console.log(
      `Prepared Tholi ${version}. Update current-version documentation, then run check:version and validation. No commit, tag or archive was created.`,
    );
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  await syncVersion(process.argv[2]);
