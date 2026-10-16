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
  if (
    !hasActiveSession(view) ||
    ["idle", "arrived", "paused", "initializing", "planning"].includes(
      presentation.phase,
    )
  )
    return;
  return view;
}
