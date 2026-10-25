import metadata from "../../../../package.json" with { type: "json" };

/** Canonical repository links come from the root package metadata. */
export const repositoryUrl = metadata.repository.url.replace(/\.git$/, "");
export const repositorySourceUrl = `${repositoryUrl}/blob/main/`;

export function resolvePublicOrigin(value: unknown) {
  if (typeof value === "string" && value.trim()) {
    const url = new URL(value);
    if (
      !["https:", "http:"].includes(url.protocol) ||
      url.username ||
      url.password
    )
      throw new Error(
        "VITE_THOLI_PUBLIC_ORIGIN must be an HTTP(S) origin without credentials",
      );
    return url.origin;
  }
  return "https://tholi.io";
}
export const publicOrigin = resolvePublicOrigin(
  import.meta.env?.VITE_THOLI_PUBLIC_ORIGIN,
);
