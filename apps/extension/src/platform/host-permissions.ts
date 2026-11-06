import manifest from "../../manifest.json" with { type: "json" };

/** Shared with the canonical manifest, for installation and explicit recovery. */
export const websiteHostPermissions: readonly string[] =
  manifest.host_permissions;

/** Host grants omit ports; task identity still uses the exact origin. */
export function hostPermissionPattern(origin: string) {
  const url = new URL(origin);
  if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
    throw Error("Invalid website origin.");
  return url.protocol + "//" + url.hostname + "/*";
}
