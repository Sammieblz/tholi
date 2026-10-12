import type { NavigationRequest } from "./contracts";
import type { TaskJourney } from "../page-model";
export function continuesDestination(
  journey?: TaskJourney,
  request?: NavigationRequest,
) {
  return !!(
    journey?.objective.value ||
    journey?.objective.workflow ||
    (request &&
      ["active", "paused"].includes(request.status) &&
      (request.tasks.length > 1 ||
        ["navigate", "search"].includes(
          request.tasks[request.active]?.operation,
        )))
  );
}
export function advanceQueue(
  request: NavigationRequest,
  outcome: "verified" | "skipped" | "boundary" | "wrong",
) {
  const next = structuredClone(request),
    task = next.tasks[next.active];
  if (
    !task ||
    next.status === "canceled" ||
    next.status === "paused" ||
    (outcome === "verified" &&
      (next.status !== "active" || task.status === "blocked")) ||
    outcome === "wrong"
  )
    return next;
  if (outcome === "boundary") {
    task.status = "blocked";
    next.status = "blocked";
    return next;
  }
  task.status = outcome === "verified" ? "completed" : "skipped";
  next.active++;
  if (next.active === next.tasks.length) next.status = "completed";
  else {
    next.tasks[next.active].status = "active";
    next.status = "active";
  }
  return next;
}
export const pauseQueue = (request: NavigationRequest): NavigationRequest =>
  ["completed", "canceled"].includes(request.status)
    ? request
    : {
        ...request,
        resumeStatus:
          request.status === "blocked"
            ? "blocked"
            : request.status === "clarification"
              ? "clarification"
              : request.resumeStatus || "active",
        status: "paused",
      };
export const resumeQueue = (request: NavigationRequest): NavigationRequest =>
  request.status === "paused"
    ? {
        ...request,
        status: request.resumeStatus || "active",
        resumeStatus: undefined,
      }
    : request;
export const stopQueue = (request: NavigationRequest): NavigationRequest => ({
  ...request,
  status: "canceled",
});
export function matchesStamp(
  result: { requestId: string; documentId: string; revision: number },
  stamp: { requestId: string; documentId: string; revision: number },
) {
  return (
    result.requestId === stamp.requestId &&
    result.documentId === stamp.documentId &&
    result.revision === stamp.revision
  );
}
