const accountPaths = new Set(["/signin", "/signup", "/account", "/welcome"]);
export const accountAliases = Object.freeze({ "/welcome": "/account" });

/** Account bookmarks share one canonical client route, including static aliases. */
export function accountPath(path: string) {
  const canonical = path.replace(/\/+$/, "").replace(/\.html$/, "");
  return accountPaths.has(canonical) ? canonical : undefined;
}
