import { cp, mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve, dirname, sep, basename } from "node:path";
import { tmpdir } from "node:os";
const variants = new Map<string, Promise<string>>();
/** Immutable built files are shared. Only fixture pregrants need a worker-local copy. */
export async function permissionVariant(
  permissions: string[],
  options: {
    target?: "chromium" | "firefox";
    dataCollection?: readonly string[];
  } = {},
) {
  const target = options.target ?? "chromium";
  const dataCollection = [...new Set(options.dataCollection ?? [])].sort();
  const source = resolve(
    target === "firefox" ? "dist/extension-firefox" : "dist/extension",
  );
  if (!permissions.length && !dataCollection.length) return source;
  const key = JSON.stringify({
    target,
    permissions: [...permissions].sort(),
    dataCollection,
  });
  if (!variants.has(key))
    variants.set(
      key,
      (async () => {
        const manifest = JSON.parse(
          await readFile(join(source, "manifest.json"), "utf8"),
        );
        const next = structuredClone(manifest);
        next.host_permissions = [
          ...new Set([...manifest.host_permissions, ...permissions]),
        ];
        if (dataCollection.length) {
          const declared =
            manifest.browser_specific_settings?.gecko
              ?.data_collection_permissions;
          if (
            target !== "firefox" ||
            !Array.isArray(declared?.required) ||
            !Array.isArray(declared?.optional) ||
            dataCollection.some(
              (category) => !declared.optional.includes(category),
            )
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
        // A fixture copy can change grants only. Code, identity, CSP and every
        // other manifest setting must remain the source artifact's exact value.
        const unchanged = structuredClone(next);
        unchanged.host_permissions = manifest.host_permissions;
        if (dataCollection.length)
          unchanged.browser_specific_settings.gecko.data_collection_permissions =
            manifest.browser_specific_settings.gecko.data_collection_permissions;
        if (JSON.stringify(unchanged) !== JSON.stringify(manifest))
          throw Error(
            "The fixture variant changed more than its explicit grants.",
          );
        const root = await mkdtemp(join(tmpdir(), "tholi-permissions-"));
        const directory = join(root, "extension");
        await cp(source, directory, { recursive: true });
        const file = join(directory, "manifest.json");
        await writeFile(file, JSON.stringify(next));
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
