import { api, browserTarget } from "./api";
import backendDataPermissions from "../../../../config/backend-data-permissions.json";
import type { Manifest } from "webextension-polyfill";
import {
  hostPermissionPattern,
  websiteHostPermissions,
} from "./host-permissions";
export { hostPermissionPattern } from "./host-permissions";
const backendData =
  backendDataPermissions as Manifest.OptionalDataCollectionPermission[];

/** A task never requests permissions. Recheck the live tab across the grant await. */
export async function requireCurrentSiteAccess(
  expectedOrigin?: string,
  expectedTabId?: number,
) {
  // Embedded Firefox interfaces expose runtime messaging, not privileged tab
  // or permission APIs. Reuse the background's live context and host check.
  const embedded = !api.tabs?.query || !api.permissions?.contains;
  const readEmbedded = async () => {
    const context = await api.runtime.sendMessage({ type: "GET_CONTEXT" });
    if (
      !Number.isSafeInteger(context?.tabId) ||
      context.tabId < 0 ||
      typeof context?.origin !== "string"
    )
      throw Error("Open an HTTP or HTTPS website tab first.");
    hostPermissionPattern(context.origin);
    if (context.siteAccessRequired !== false)
      throw Error(
        "Website access is unavailable. Open Tholi from the browser toolbar to enable website access. Your task is retained.",
      );
    return { tabId: context.tabId as number, origin: context.origin as string };
  };
  const current = async () => {
    let target: { tabId: number; origin: string };
    if (embedded) target = await readEmbedded();
    else {
      const [tab] = await api.tabs.query({
        active: true,
        lastFocusedWindow: true,
      });
      if (tab?.id === undefined || !tab.url)
        throw Error("Open an HTTP or HTTPS website tab first.");
      const url = new URL(tab.url);
      if (!["http:", "https:"].includes(url.protocol))
        throw Error("Open an HTTP or HTTPS website tab first.");
      target = { tabId: tab.id, origin: url.origin };
    }
    if (
      (expectedTabId !== undefined && target.tabId !== expectedTabId) ||
      (expectedOrigin !== undefined && target.origin !== expectedOrigin)
    )
      throw Error(
        "The active website changed. Refresh Tholi before continuing.",
      );
    return target;
  };
  const target = await current();
  if (
    !embedded &&
    !(await api.permissions.contains({
      origins: [hostPermissionPattern(target.origin)],
    }))
  )
    throw Error(
      "Website access is unavailable. Enable website access in Tholi or review your browser's extension settings.",
    );
  const checked = await current();
  if (checked.tabId !== target.tabId || checked.origin !== target.origin)
    throw Error("The active website changed. Refresh Tholi before continuing.");
  return target;
}

/** Invoke directly from an explicit setup/recovery click, before any await. */
export function requestWebsiteAccess() {
  if (!api.permissions?.request)
    return Promise.reject(
      Error(
        "Open Tholi from the browser toolbar to enable website access. Your task is retained.",
      ),
    );
  return api.permissions.request({ origins: [...websiteHostPermissions] });
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

/** Native capability only; callers also enforce explicit processing choices. */
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
