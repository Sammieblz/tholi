import type { PinnedSession } from "./session";
import { supportsLiveUrl } from "../page-model";
import { pauseQueue } from "../navigation-core/queue";
/** Return only to the original opener recorded during an explicit handoff. */
export function returnFromHandoff(
  session: PinnedSession,
  closedTabId: number,
  tab: { id?: number; url?: string },
) {
  const previous = session.handoffReturn,
    w = session.view?.journey?.workflow;
  if (
    !previous ||
    closedTabId !== session.tabId ||
    tab.id !== previous.tabId ||
    !tab.url ||
    !supportsLiveUrl(tab.url) ||
    new URL(tab.url).origin !== previous.origin ||
    !w ||
    ["completed", "canceled"].includes(w.status) ||
    session.view?.status === "stopped"
  )
    return;
  const next = structuredClone(session);
  next.tabId = previous.tabId;
  next.origin = previous.origin;
  next.documentId = undefined;
  next.navigationPending = true;
  next.pendingNavigation = undefined;
  next.handoffReturn = undefined;
  next.view = {
    ...next.view!,
    status: "paused",
    controls: [],
    page: undefined,
    selectedControlId: undefined,
    continuationOrigin: undefined,
    frameAccess: undefined,
    instruction:
      "The authorization tab closed. Resume on the original application to check its current state and continue your task.",
  };
  if (next.view.request) next.view.request = pauseQueue(next.view.request);
  return next;
}
