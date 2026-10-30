/** Production host prefixes prevent a sibling domain from shadowing credentials. */
export function identityCookieNames(secure: boolean) {
  const prefix = secure ? "__Host-" : "";
  return {
    access: prefix + "tholi_session",
    refresh: prefix + "tholi_refresh",
    flow: prefix + "tholi_flow",
  };
}
