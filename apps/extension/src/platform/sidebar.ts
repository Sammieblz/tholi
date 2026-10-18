import { api, browserTarget, chromiumApi } from "./api";
export function hasNativeSidebar() {
  return browserTarget() === "firefox"
    ? !!api.sidebarAction?.open
    : !!chromiumApi()?.sidePanel?.open;
}
export function openNativeSidebar(windowId = 0) {
  // The caller must invoke this before its first await in a genuine user action.
  if (browserTarget() === "firefox") {
    if (!api.sidebarAction?.open)
      return Promise.reject(
        Error(
          "Click Tholi in the browser toolbar to dock. Your widget and draft are retained.",
        ),
      );
    return api.sidebarAction.open().catch(async (error) => {
      if (!windowId || !(await api.sidebarAction.isOpen({ windowId })))
        throw error;
    });
  }
  const panel = chromiumApi()?.sidePanel;
  return panel?.open
    ? panel.open({ windowId })
    : Promise.reject(Error("Use the floating widget in this browser."));
}
export async function closeNativeSidebar(windowId: number) {
  if (browserTarget() === "firefox") {
    await api.sidebarAction.close();
    return true;
  }
  const panel = chromiumApi()?.sidePanel as
    | (typeof chrome.sidePanel & {
        close?: (options: { windowId: number }) => Promise<void>;
      })
    | undefined;
  if (!panel?.close) return false;
  await panel.close({ windowId });
  return true;
}
export function nativePanelEvents() {
  return browserTarget() === "chromium" ? chromiumApi()?.sidePanel : undefined;
}

export async function configureNativeSidebar() {
  if (browserTarget() === "chromium")
    await chromiumApi()
      ?.sidePanel?.setPanelBehavior({ openPanelOnActionClick: false })
      .catch(() => {});
}
