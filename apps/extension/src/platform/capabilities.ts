import { api, browserTarget, chromiumApi } from "./api";
import { protectLocalSettings } from "./private-settings";
/** Missing safety/inference capabilities are unsupported, never weaker fallbacks. */
export async function requireNavigationCapabilities() {
  if (
    !api.scripting?.executeScript ||
    !api.webNavigation?.getFrame ||
    !api.storage?.session
  )
    throw Error(
      "This browser lacks the native document and session APIs Tholi requires.",
    );
  if (browserTarget() === "chromium") {
    const native = chromiumApi();
    if (!native?.offscreen?.createDocument || !native.runtime?.getContexts)
      throw Error(
        "This Chromium browser cannot host Tholi’s bundled local engine.",
      );
  } else if (typeof Worker === "undefined")
    throw Error(
      "This Firefox browser cannot host Tholi’s bundled local engine.",
    );
  await protectLocalSettings();
}
