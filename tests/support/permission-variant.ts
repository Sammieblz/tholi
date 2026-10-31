import {
  cp,
  mkdtemp,
  readFile,
  writeFile,
  rm,
  mkdir,
  lstat,
  realpath,
} from "node:fs/promises";
import { join, resolve, dirname, sep, basename } from "node:path";
import { tmpdir } from "node:os";
import { createHash } from "node:crypto";
import { artifactFiles } from "../../scripts/artifact-files.mjs";
const variants = new Map<string, Promise<string>>();
const hash = (value: string) =>
  createHash("sha256").update(value).digest("hex");
/** Immutable built files are shared. Only fixture pregrants need a worker-local copy. */
export async function permissionVariant(
  permissions: string[],
  options: {
    target?: "chromium" | "firefox";
    dataCollection?: readonly string[];
    persistent?: boolean;
  } = {},
) {
  const target = options.target ?? "chromium";
  const dataCollection = [...new Set(options.dataCollection ?? [])].sort();
  const source = resolve(
    target === "firefox" ? "dist/extension-firefox" : "dist/extension",
  );
  if (!permissions.length && !dataCollection.length) return source;
  const declaredPermissions = options.persistent
    ? [...new Set(permissions)].sort()
    : permissions;
  const manifest = JSON.parse(
    await readFile(join(source, "manifest.json"), "utf8"),
  );
  const next = structuredClone(manifest);
  next.host_permissions = [
    ...new Set([...manifest.host_permissions, ...declaredPermissions]),
  ];
  if (dataCollection.length) {
    const declared =
      manifest.browser_specific_settings?.gecko?.data_collection_permissions;
    if (
      target !== "firefox" ||
      !Array.isArray(declared?.required) ||
      !Array.isArray(declared?.optional) ||
      dataCollection.some((category) => !declared.optional.includes(category))
    )
      throw Error(
        "Fixture data grants must already be declared Firefox optional categories.",
      );
    next.browser_specific_settings.gecko.data_collection_permissions = {
      ...declared,
      required: [
        ...new Set([
          ...declared.required.filter(
            (category: string) => category !== "none",
          ),
          ...dataCollection,
        ]),
      ],
      optional: declared.optional.filter(
        (category: string) => !dataCollection.includes(category),
      ),
    };
  }
  // Every mode uses the same grant-only mutation and copier. Identity, code,
  // CSP and all other manifest fields remain the source artifact's exact value.
  const unchanged = structuredClone(next);
  unchanged.host_permissions = manifest.host_permissions;
  if (dataCollection.length)
    unchanged.browser_specific_settings.gecko.data_collection_permissions =
      manifest.browser_specific_settings.gecko.data_collection_permissions;
  if (JSON.stringify(unchanged) !== JSON.stringify(manifest))
    throw Error("The fixture variant changed more than its explicit grants.");
  const serialized = JSON.stringify(next);
  const copy = async (directory: string) => {
    await cp(source, directory, { recursive: true });
    await writeFile(join(directory, "manifest.json"), serialized);
  };
  if (options.persistent) {
    const files = await artifactFiles(source);
    const artifactDigest = hash(JSON.stringify(files));
    const grantDigest = hash(
      JSON.stringify({
        target,
        permissions: declaredPermissions,
        dataCollection,
      }),
    );
    const base = resolve("output/qa/permission-variants");
    await mkdir(base, { recursive: true });
    const workspace = await realpath(resolve("."));
    const actualBase = await realpath(base);
    if (!actualBase.startsWith(workspace + sep))
      throw Error(
        "Persistent permission variants must remain inside this checkout.",
      );
    const directory = join(
      base,
      `${artifactDigest}-${grantDigest}`,
      "extension",
    );
    let exists = false;
    try {
      const entry = await lstat(directory);
      if (!entry.isDirectory() || entry.isSymbolicLink())
        throw Error("The persistent variant is not an owned directory.");
      exists = true;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    }
    if (!exists) {
      await mkdir(dirname(directory), { recursive: true });
      if (!(await realpath(dirname(directory))).startsWith(actualBase + sep))
        throw Error(
          "The persistent variant parent escaped its output directory.",
        );
      await copy(directory);
    }
    const actualDirectory = await realpath(directory);
    if (!actualDirectory.startsWith(actualBase + sep))
      throw Error(
        "The persistent permission variant escaped its output directory.",
      );
    const expected = { ...files, "manifest.json": hash(serialized) };
    if (
      JSON.stringify(await artifactFiles(directory)) !==
      JSON.stringify(expected)
    )
      throw Error(
        "Persistent permission-variant bytes differ from the declared grant-only build.",
      );
    return directory;
  }
  const key = JSON.stringify({
    target,
    permissions: [...permissions].sort(),
    dataCollection,
  });
  if (!variants.has(key))
    variants.set(
      key,
      (async () => {
        const root = await mkdtemp(join(tmpdir(), "tholi-permissions-"));
        const directory = join(root, "extension");
        await copy(directory);
        return directory;
      })(),
    );
  return variants.get(key)!;
}

export async function cleanupPermissionVariants() {
  for (const pending of variants.values()) {
    const root = dirname(await pending);
    if (
      !root.startsWith(resolve(tmpdir()) + sep) ||
      !basename(root).startsWith("tholi-permissions-")
    )
      throw Error("Unsafe permission-variant cleanup");
    await rm(root, { recursive: true, force: true });
  }
  variants.clear();
}
