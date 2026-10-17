import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, dirname, sep, basename } from "node:path";
import { tmpdir } from "node:os";
const variants = new Map<string, Promise<string>>();
/** Immutable built files are shared. Only fixture pregrants need a worker-local copy. */
export async function permissionVariant(permissions: string[]) {
  if (!permissions.length) return resolve("dist/extension");
  const key = JSON.stringify([...permissions].sort());
  if (!variants.has(key))
    variants.set(
      key,
      (async () => {
        const root = await mkdtemp(join(tmpdir(), "tholi-permissions-"));
        const directory = join(root, "extension");
        await cp(resolve("dist/extension"), directory, { recursive: true });
        const file = join(directory, "manifest.json");
        const manifest = JSON.parse(await readFile(file, "utf8"));
        await writeFile(
          file,
          JSON.stringify({
            ...manifest,
            host_permissions: [...manifest.host_permissions, ...permissions],
          }),
        );
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
