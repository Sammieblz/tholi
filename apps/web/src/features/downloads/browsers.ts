import definitions from "../../../../../config/browsers.json" with { type: "json" };
export type ExtensionTarget = "chromium" | "firefox";
export const browsers = definitions;
export const stores = {
  chromium: {
    id: "chrome",
    name: "Chrome",
    listing: "Chrome Web Store",
    url: "https://chromewebstore.google.com/detail/tholi/pliafmeneaalhbecphnodbifdfcajngk",
  },
  firefox: {
    id: "firefox",
    name: "Firefox",
    listing: "Firefox Add-ons",
    url: "https://addons.mozilla.org/en-US/firefox/addon/tholi/",
  },
} as const;

export function desktopStore(
  userAgent = typeof navigator === "undefined" ? "" : navigator.userAgent,
) {
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(userAgent)) return undefined;
  if (/Firefox\//.test(userAgent)) return stores.firefox;
  if (/Chrome\//.test(userAgent) && !/Edg\//.test(userAgent))
    return stores.chromium;
  return undefined;
}
export function selectedBrowser(
  search = location.search,
  hash = location.hash,
) {
  const chosen =
    new URLSearchParams(search).get("browser") ||
    /^#installation-([\w-]+)$/.exec(hash)?.[1];
  return (
    browsers.find((b) => b.id === chosen) ||
    browsers.find(
      (b) =>
        b.id ===
        (/Firefox\//.test(navigator.userAgent)
          ? "firefox"
          : /Edg\//.test(navigator.userAgent)
            ? "edge"
            : "chromium"),
    )!
  );
}
