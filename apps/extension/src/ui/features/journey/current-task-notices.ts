import type { SessionView } from "../../../../../../packages/shared-types";
import type { GuidancePresentation } from "../../../../../../packages/ui/presentation";
import type { ProcessingPresentation } from "../../../../../../packages/ui/guidance/types";
import type { ServiceErrorCode } from "../../../../../../packages/navigation-core/contracts-service";

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

const replacedProcessingRequest = {
  title: "Connected request needs a fresh check",
  detail: "Try again to check the current page, or choose Local.",
  recovery: "retry",
} as const;

const processingErrors: Record<
  ServiceErrorCode,
  Omit<ProcessingPresentation, "state">
> = {
  INVALID_REQUEST: {
    title: "Connected request could not be used",
    detail:
      "Try a shorter, clearer destination. Local guidance remains available.",
    recovery: "settings",
  },
  COMPATIBILITY_MISMATCH: {
    title: "Connected service needs an update",
    detail: "Update Tholi and the service, or choose Local.",
    recovery: "settings",
  },
  UNAUTHENTICATED: {
    title: "Connected service sign-in required",
    detail:
      "Review the connected account, or choose Local without a Tholi account.",
    recovery: "settings",
  },
  FORBIDDEN: {
    title: "Connected guidance is not authorized",
    detail: "Review permission to share page context, or choose Local.",
    recovery: "settings",
  },
  NOT_FOUND: {
    title: "Connected guidance is unavailable here",
    detail: "Review the connected service, or choose Local.",
    recovery: "settings",
  },
  CONFLICT: replacedProcessingRequest,
  IDEMPOTENCY_CONFLICT: replacedProcessingRequest,
  PAYLOAD_TOO_LARGE: {
    title: "This page exceeds the connected service limit",
    detail: "Try a simpler page, or choose Local.",
    recovery: "settings",
  },
  UNSUPPORTED_MEDIA_TYPE: {
    title: "Connected request format is not supported",
    detail: "Update Tholi and the connected service, or choose Local.",
    recovery: "settings",
  },
  RATE_LIMITED: {
    title: "Connected service is busy",
    detail: "Wait before trying again, or choose Local.",
    recovery: "retry",
  },
  QUOTA_EXCEEDED: {
    title: "Connected service limit reached",
    detail:
      "This request reached a service limit. Choose Local or review the service. Credit balances are not available yet.",
    recovery: "settings",
  },
  DEADLINE_EXCEEDED: {
    title: "Connected request timed out",
    detail: "Try again when you are ready, or choose Local.",
    recovery: "retry",
  },
  CANCELLED: {
    title: "Connected request stopped",
    detail: "Local guidance remains available. This task is still unverified.",
  },
  UNAVAILABLE: {
    title: "Connected service is unavailable",
    detail: "Check your connection before trying again, or choose Local.",
    recovery: "retry",
  },
  INTERNAL_ERROR: {
    title: "Connected request could not finish",
    detail: "Try again when you are ready, or choose Local.",
    recovery: "retry",
  },
};

/** Service metadata describes this request, never the saved mode or arrival. */
export function currentProcessing(
  view: SessionView | undefined,
  presentation: GuidancePresentation,
): ProcessingPresentation | undefined {
  const service = view?.serviceNavigation;
  if (
    !view ||
    !service ||
    view.status !== "running" ||
    view.request?.status !== "active" ||
    view.request.id !== service.requestId ||
    view.frameAccess?.length ||
    !["guiding", "recovering"].includes(presentation.phase)
  )
    return;
  const operator = service.profile === "operator-evaluation";
  const source = operator ? "Operator evaluation" : "Connected guidance";
  switch (service.state) {
    case "pending":
      return {
        state: "pending",
        title: `${source} is checking this page`,
        detail: operator
          ? `Temporary ${service.evaluation!.provider === "vertex" ? "Vertex" : "fake-provider"} evaluation with ${service.evaluation!.arm === "multimodal" ? "structured context and a fresh masked image" : "structured context only"}. Pause and Stop remain available.`
          : "This request uses the development service. Pause and Stop remain available.",
      };
    case "guiding":
      return view.selectedControlId
        ? {
            state: "guiding",
            title: `${source} is ready`,
            detail: `${operator ? "Temporary operator evaluation" : "Development service"} proposal. Tholi still checks the result of each step.`,
          }
        : undefined;
    case "clarify":
      return {
        state: "clarify",
        title: `${source} needs a clearer destination`,
        detail:
          "Describe what you want to find or change using the destination field.",
      };
    case "unsupported":
      return {
        state: "unsupported",
        title: `${source} cannot guide this page`,
        detail:
          "Try a different destination or choose Local. This task has not been completed.",
        recovery: "settings",
      };
    case "observation":
      return {
        state: "observation",
        title: `${source} needs more page evidence`,
        detail:
          "This trial allows no further observation request. The destination remains unverified.",
        recovery: "settings",
      };
    case "error": {
      const error = {
        state: "error",
        ...(processingErrors[service.code || "INTERNAL_ERROR"] ||
          processingErrors.INTERNAL_ERROR),
      };
      return {
        ...error,
        state: "error",
        ...(operator ? { title: `Operator evaluation: ${error.title}` } : {}),
      };
    }
  }
}
