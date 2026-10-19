import { api } from "../../platform/api";
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
    session?: {
      tabId: number;
      sessionId?: string;
      documentId?: string;
      view?: SessionView;
    };
  }>();
  useEffect(() => {
    let current = true;
    let reading = false;
    const refreshAppearance = createAppearanceReader(() => current);
    const refresh = () => {
      refreshAppearance();
      if (reading) return;
      reading = true;
      api.runtime
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
    const port = api.runtime.connect({
      name: widget ? "tholi-widget" : "tholi-panel",
    });
    port?.onMessage.addListener(refresh);
    // Firefox embeds expose the content-script API subset; the worker port
    // remains the single snapshot subscription on both surfaces.
    api.tabs?.onActivated.addListener(refresh);
    const interval = setInterval(refresh, 1000);
    return () => {
      current = false;
      clearInterval(interval);
      api.tabs?.onActivated.removeListener(refresh);
      port?.disconnect();
    };
  }, []);
  return { view, setView, context, setContext };
}
