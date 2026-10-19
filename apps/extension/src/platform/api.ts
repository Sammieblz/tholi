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
type WebExtensionApi = Omit<typeof browser, "runtime" | "tabs" | "storage"> & {
  runtime: Omit<typeof browser.runtime, "sendMessage" | "onMessage"> & {
    sendMessage<T = any>(message: unknown): Promise<T>;
    onMessage: MessageEvent;
  };
  tabs: Omit<typeof browser.tabs, "sendMessage"> & {
    sendMessage<T = any>(
      tabId: number,
      message: unknown,
      options?: browser.Tabs.SendMessageOptionsType,
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
