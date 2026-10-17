import type { SessionView } from "../../../../../../packages/shared-types";
import type { GuidancePresentation } from "../../../../../../packages/ui/presentation";

function hasActiveSession(view: SessionView | undefined): view is SessionView {
  return (
    !!view &&
    ["running", "waiting", "rerouting", "boundary"].includes(view.status) &&
    !["completed", "canceled", "paused"].includes(view.request?.status || "")
  );
}

/** Frame access belongs to current page discovery, even before a destination. */
export function currentFrameAccess(view: SessionView | undefined): string[] {
  return hasActiveSession(view) ? view.frameAccess || [] : [];
}

/** Retained plans are knowledge, not current instructions after a task ends. */
export function currentTaskNotices(
  view: SessionView | undefined,
  presentation: GuidancePresentation,
) {
  // The worker pauses at an expected origin handoff without pausing the task.
  // Its explicit continuation action must remain reachable during that hold.
  const pendingContinuation =
    view?.status === "paused" &&
    !!view.continuationOrigin &&
    view.request?.status === "active";
  if (
    (!hasActiveSession(view) && !pendingContinuation) ||
    ["idle", "arrived", "initializing", "planning"].includes(
      presentation.phase,
    ) ||
    (presentation.phase === "paused" && !pendingContinuation)
  )
    return;
  return view;
}
