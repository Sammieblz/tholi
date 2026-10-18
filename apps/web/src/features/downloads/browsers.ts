import definitions from "../../../../../config/browsers.json";
export type ExtensionTarget = "chromium" | "firefox";
export const browsers = definitions;
export function selectedBrowser(search = location.search) {
  const chosen = new URLSearchParams(search).get("browser");
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
