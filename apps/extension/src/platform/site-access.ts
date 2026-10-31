import { api, browserTarget, chromiumApi } from "./api";
import backendDataPermissions from "../../../../config/backend-data-permissions.json";
import type { Manifest } from "webextension-polyfill";
import { hostPermissionPattern } from "./host-permissions";
export { hostPermissionPattern } from "./host-permissions";
const backendData =
  backendDataPermissions as Manifest.OptionalDataCollectionPermission[];
/** Read the active tab at the click, rather than a previously polled panel state. */
export function requestCurrentSiteAccess(
  expectedOrigin?: string,
  expectedTabId?: number,
) {
  if (browserTarget() === "firefox") {
    let origin: string;
    try {
      const url = new URL(expectedOrigin || "");
      if (!["http:", "https:"].includes(url.protocol)) throw Error();
      origin = url.origin;
    } catch {
      return Promise.reject(
        Error("Refresh Tholi on the website before granting access."),
      );
    }
    // No awaited query before the privileged call. The visible origin is the authorization intent.
    const grant = requestOriginAccess(origin);
    return grant.then(async (granted) => {
      if (!granted)
        throw Error(
          "Website access was declined. Grant access to this website to start discovery.",
        );
      const [tab] = await api.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (
        tab?.id === undefined ||
        (expectedTabId !== undefined && tab.id !== expectedTabId) ||
        !tab.url ||
        new URL(tab.url).origin !== origin
      )
        throw Error(
          "The active website changed. Refresh Tholi before continuing.",
        );
      return { tabId: tab.id, origin };
    });
  }
  const chrome = chromiumApi();
  return new Promise<{ tabId: number; origin: string }>((resolve, reject) => {
    // Keep the permission call inside the Chrome API callback from the user
    // gesture; do not await a network request or a planner before requesting it.
    chrome.tabs.query({ active: true, lastFocusedWindow: true }, (tabs) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      const tab = tabs[0];
      let url: URL;
      try {
        url = new URL(tab?.url || "");
        if (
          tab?.id === undefined ||
          !["http:", "https:"].includes(url.protocol)
        )
          throw new Error("Open an HTTP or HTTPS website tab first.");
        if (expectedTabId !== undefined && tab.id !== expectedTabId)
          throw Error(
            "The active website changed. Refresh Tholi before continuing.",
          );
        if (expectedOrigin && expectedOrigin !== url.origin)
          throw new Error(
            "Return to the expected task destination before continuing.",
          );
      } catch (error) {
        reject(
          error instanceof Error
            ? error
            : new Error("The current tab is unavailable."),
        );
        return;
      }
      chrome.permissions
        .request({
          origins: [url.protocol + "//" + url.hostname + "/*"],
        })
        .then((granted) => {
          if (!granted) {
            reject(
              new Error(
                "Website access was declined. Grant access to this website to start discovery.",
              ),
            );
            return;
          }
          void api.tabs
            .query({ active: true, lastFocusedWindow: true })
            .then(([current]) => {
              if (
                current?.id !== tab.id ||
                !current.url ||
                new URL(current.url).origin !== url.origin
              ) {
                reject(
                  Error(
                    "The active website changed. Refresh Tholi before continuing.",
                  ),
                );
                return;
              }
              resolve({ tabId: tab.id!, origin: url.origin });
            }, reject);
        }, reject);
    });
  });
}

/** Permission UI must run in a privileged surface, never an embedded Firefox frame. */
export function requestOriginAccess(origin: string) {
  if (!api.permissions?.request)
    return Promise.reject(
      Error(
        "Open Tholi from the browser toolbar to allow embedded website access. Your task is retained.",
      ),
    );
  return api.permissions.request({ origins: [hostPermissionPattern(origin)] });
}

/** Request optional backend transmission consent in the Save connection gesture. */
export function requestBackendAccess(origin: string) {
  return api.permissions.request({
    origins: [hostPermissionPattern(origin)],
    ...(browserTarget() === "firefox"
      ? { data_collection: [...backendData] }
      : {}),
  });
}

/** Recheck host access and Firefox transmission consent for saved connections. */
export async function hasBackendAccess(origin: string) {
  try {
    return await api.permissions.contains({
      origins: [hostPermissionPattern(origin)],
      ...(browserTarget() === "firefox"
        ? { data_collection: [...backendData] }
        : {}),
    });
  } catch {
    return false;
  }
}
