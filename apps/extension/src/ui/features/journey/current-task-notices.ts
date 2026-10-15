import type { SessionView } from "../../../../../../packages/shared-types";
import type { GuidancePresentation } from "../../../../../../packages/ui/presentation";

/** Retained plans are knowledge, not current instructions after a task ends. */
export function currentTaskNotices(
  view: SessionView | undefined,
  presentation: GuidancePresentation,
) {
  if (
    !view ||
    !["running", "waiting", "rerouting", "boundary"].includes(view.status) ||
    ["idle", "arrived", "paused", "initializing", "planning"].includes(
      presentation.phase,
    ) ||
    ["completed", "canceled", "paused"].includes(view.request?.status || "")
  )
    return;
  return view;
}
