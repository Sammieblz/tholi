import { useEffect, useState } from "react";
import type { RoutePreview } from "../../../../../packages/route-registry";
import type { SessionView } from "../../../../../packages/shared-types";
import { createAppearanceReader } from "../theme/read-appearance";

export function useSessionSnapshot(widget: boolean) {
  const [view, setView] = useState<SessionView>();
  const [context, setContext] = useState<{
    tabId?: number;
    origin?: string;
    siteAccessRequired?: boolean;
    canContinueTask?: boolean;
    routes: RoutePreview[];
    reason?: string;
    sessionRoute?: RoutePreview;
    session?: { tabId: number; view?: SessionView };
  }>();
  useEffect(() => {
    let current = true;
    let reading = false;
    const refreshAppearance = createAppearanceReader(() => current);
    const refresh = () => {
      refreshAppearance();
      if (reading) return;
      reading = true;
      chrome.runtime
        .sendMessage({ type: "GET_CONTEXT" })
        .then((r) => {
          if (current && r?.routes) {
            setContext(r);
            setView(r.session?.view);
          }
        })
        .catch(() => {})
        .finally(() => {
          reading = false;
        });
    };
    refresh();
    const port = chrome.runtime.connect({
      name: widget ? "tholi-widget" : "tholi-panel",
    });
    port?.onMessage.addListener(refresh);
    chrome.tabs.onActivated.addListener(refresh);
    const interval = setInterval(refresh, 1000);
    return () => {
      current = false;
      clearInterval(interval);
      chrome.tabs.onActivated.removeListener(refresh);
      port?.disconnect();
    };
  }, []);
  return { view, setView, context, setContext };
}
