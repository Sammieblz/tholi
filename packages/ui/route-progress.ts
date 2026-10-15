import type { SessionView } from "../shared-types";
import type { GuidancePresentation } from "./presentation";

/** Presentation evidence, not a second planner. Unknown screens stay open-ended. */
export interface RouteProgress {
  journeyId: string;
  verified: number;
  recentLabels: string[];
  next: {
    id: string;
    label: string;
    evidence: "live" | "observed" | "predicted" | "documented";
  }[];
  complete: boolean;
  arrived: boolean;
}

export function presentRouteProgress(
  view: SessionView | undefined,
  presentation: GuidancePresentation,
): RouteProgress | undefined {
  if (
    !view ||
    ["idle", "initializing", "planning"].includes(presentation.phase)
  )
    return;
  const journey = view.journey;
  const verified = journey
    ? Math.max(journey.totalVerified ?? 0, journey.progress.length)
    : view.verifiedSteps;
  const arrived = presentation.phase === "arrived";
  const plan = view.goalPlan;
  const next: RouteProgress["next"] = [];
  // A stale prediction or a search still in recovery is not an actionable step.
  if (!arrived && plan?.status === "guiding" && !plan.recoveryStage) {
    for (const step of plan.steps)
      next.push({ id: step.controlId, label: step.label, evidence: "live" });
    for (const [index, prediction] of (
      plan.route?.predictions || []
    ).entries()) {
      // The forecast normally starts after the first live step. Some plans also
      // expose that same step in their live chain. Merge only that overlap.
      if (
        index < plan.steps.length - 1 &&
        prediction.label.toLowerCase() ===
          plan.steps[index + 1]?.label.toLowerCase()
      )
        continue;
      next.push({ id: `forecast:${index}:${prediction.label}`, ...prediction });
    }
  }
  return {
    journeyId: journey?.id || view.request?.id || view.routeId,
    verified,
    recentLabels: journey?.progress.map((step) => step.label) || [],
    next,
    complete:
      arrived ||
      !!(
        plan?.route?.complete &&
        plan.route.available !== false &&
        next.length &&
        next.length >= plan.route.clicks
      ),
    arrived,
  };
}

export interface RouteNode {
  id: string;
  label: string;
  state: "verified" | "current" | "upcoming" | "more" | "destination";
  number?: number;
  detail?: string;
}

/** A bounded window keeps long journeys readable even at widget widths. */
export function routeProgressNodes(progress: RouteProgress): RouteNode[] {
  const nodes: RouteNode[] = [];
  if (progress.verified > 1)
    nodes.push({
      id: "earlier",
      label: `${progress.verified - 1} earlier verified steps`,
      state: "verified",
      detail: `+${progress.verified - 1}`,
    });
  if (progress.verified > 0) {
    const number = progress.verified;
    nodes.push({
      id: `verified:${number}`,
      label: progress.recentLabels.at(-1) || `Verified step ${number}`,
      state: "verified",
      number,
    });
  }
  if (!progress.arrived) {
    progress.next.slice(0, 3).forEach((step, index) =>
      nodes.push({
        id: `step:${progress.verified + index + 1}`,
        label: step.label,
        state: index === 0 ? "current" : "upcoming",
        number: progress.verified + index + 1,
        detail:
          step.evidence === "live"
            ? "Live control"
            : `${step.evidence[0].toUpperCase()}${step.evidence.slice(1)} step, checked again on arrival`,
      }),
    );
    if (progress.next.length > 3 || !progress.complete)
      nodes.push({
        id: "more",
        label:
          progress.next.length > 3
            ? `${progress.next.length - 3} more known steps${progress.complete ? "" : ", further steps may appear"}`
            : "Further steps may appear",
        state: "more",
      });
  }
  nodes.push({
    id: "destination",
    label: progress.arrived
      ? "Destination verified"
      : "Destination, awaiting verification",
    state: "destination",
  });
  return nodes;
}
