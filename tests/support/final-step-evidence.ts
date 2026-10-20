import type { SessionView } from "../../packages/shared-types";

type FinalStepView = Pick<
  SessionView,
  "status" | "verifiedSteps" | "request" | "journey" | "goalPlan"
>;

/** A verified outcome may arrive before the control's interaction receipt. */
export function hasFinalStepEvidence(
  before: FinalStepView,
  current: FinalStepView | undefined,
  kind: string,
  actual: boolean,
) {
  if (
    !current ||
    !before.request?.id ||
    current.request?.id !== before.request.id ||
    !before.journey?.id ||
    current.journey?.id !== before.journey.id
  )
    return false;
  const increment = current.verifiedSteps - before.verifiedSteps;
  if (increment === 1) return true;
  // Do not invent a step when fresh state independently establishes the goal.
  // Focus and menu opening still require their original interaction receipt.
  return (
    increment === 0 &&
    ["choice", "section"].includes(kind) &&
    actual &&
    before.goalPlan?.status === "guiding" &&
    current.status === "running" &&
    current.request.status === "completed" &&
    current.journey.status === "completed" &&
    current.goalPlan?.status === "completed" &&
    current.goalPlan.source === "semantics"
  );
}

/** Recovery may reveal and verify a section between automation samples. */
export function hasRecoveredSectionEvidence(
  before: FinalStepView,
  current: FinalStepView | undefined,
  label: RegExp,
  actual: boolean,
) {
  const receipt = current?.journey?.progress.at(-1);
  return (
    actual &&
    before.goalPlan?.status === "unresolved" &&
    before.goalPlan.recoveryStage === "retrieval" &&
    current?.status === "running" &&
    current.goalPlan?.status === "completed" &&
    current.request?.status === "completed" &&
    current.journey?.status === "completed" &&
    current.verifiedSteps === before.verifiedSteps + 1 &&
    current.journey.progress.length ===
      (before.journey?.progress.length || 0) + 1 &&
    hasFinalStepEvidence(before, current, "section", actual) &&
    receipt?.kind === "section" &&
    !!receipt.signature &&
    label.test(receipt.label)
  );
}
