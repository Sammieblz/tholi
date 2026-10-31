import browser from "webextension-polyfill";
type MessageListener = (
  message: any,
  sender: browser.Runtime.MessageSender,
  respond: (value: any) => void,
) => boolean | void | Promise<unknown>;
type MessageEvent = {
  addListener(listener: MessageListener): void;
  removeListener(listener: MessageListener): void;
  hasListener(listener: MessageListener): boolean;
};
type Area = Omit<browser.Storage.StorageArea, "get"> & {
  get(
    keys?: string | string[] | Record<string, unknown> | null,
  ): Promise<Record<string, any>>;
};
type WebExtensionApi = Omit<
  typeof browser,
  "runtime" | "tabs" | "storage" | "windows"
> & {
  windows: typeof browser.windows & {
    // Chrome exposes this event; Firefox also rechecks content resize/viewport
    // evidence rather than pretending an unavailable native event exists.
    onBoundsChanged?: {
      addListener(listener: (window: browser.Windows.Window) => void): void;
    };
  };
  runtime: Omit<typeof browser.runtime, "sendMessage" | "onMessage"> & {
    sendMessage<T = any>(message: unknown): Promise<T>;
    onMessage: MessageEvent;
  };
  tabs: Omit<typeof browser.tabs, "sendMessage"> & {
    sendMessage<T = any>(
      tabId: number,
      message: unknown,
      options?: browser.Tabs.SendMessageOptionsType & { documentId?: string },
    ): Promise<T>;
  };
  storage: Omit<typeof browser.storage, "local" | "session" | "sync"> & {
    local: Area;
    session: Area;
    sync: Area;
  };
};
// Legacy wire payloads are validated by their existing Zod owners, not by a
// browser vendor's transport declarations. Preserve that validation boundary.
export const api = browser as WebExtensionApi;
export type { Runtime, Tabs, Storage } from "webextension-polyfill";
declare const __THOLI_BROWSER_TARGET__: "chromium" | "firefox";
export function browserTarget(): "chromium" | "firefox" {
  return typeof __THOLI_BROWSER_TARGET__ !== "undefined"
    ? __THOLI_BROWSER_TARGET__
    : api.runtime.getURL("").startsWith("moz-extension:")
      ? "firefox"
      : "chromium";
}
/** Chrome-only APIs stay in platform adapters, never in the shared engine. */
export function chromiumApi() {
  return globalThis.chrome;
}
/** Native shadow access is used only for complete pixel masking, never discovery. */
export function privacyShadowRoot(element: HTMLElement): ShadowRoot | null {
  let root: ShadowRoot | null | undefined;
  if (browserTarget() === "chromium") {
    const getRoot = chromiumApi()?.dom?.openOrClosedShadowRoot;
    if (typeof getRoot !== "function")
      throw Error("Native shadow privacy access is unavailable.");
    root = getRoot(element);
  } else {
    const host = element as HTMLElement & {
      readonly openOrClosedShadowRoot?: ShadowRoot | null;
    };
    if (!("openOrClosedShadowRoot" in host))
      throw Error("Native shadow privacy access is unavailable.");
    root = host.openOrClosedShadowRoot;
  }
  if (root !== null && !(root instanceof ShadowRoot))
    throw Error("Native shadow privacy evidence is unavailable.");
  return root;
}
