import {
  advanceJourney,
  contextualTask,
  objectiveReached,
} from "../../../../packages/goal-planner/task-journey";
import { recordWorkflowAction } from "../../../../packages/navigation-core/workflows";
import { type BoundControl } from "../../../../packages/page-discovery/index";
import {
  type ObservedTransition,
  type PageSnapshot,
  type PendingNavigation,
} from "../../../../packages/page-model/index";
import type { SessionView } from "../../../../packages/shared-types/index";

interface Context {
  selected: BoundControl | undefined;
  before: PageSnapshot | undefined;
  selectedAt: number;
  view: SessionView;
  inputHandoff: BoundControl | undefined;
  clearTarget: () => void;
  publish: (
    view: SessionView,
    observed?: ObservedTransition,
    navigation?: PendingNavigation,
  ) => void;
  planningRevision: string;
  requestReplan: () => void;
  verifiedDestination: string | undefined;
  state: (id: "choosing" | "guiding" | "verified") => void;
  select: (
    id: string,
    observed?: ObservedTransition,
  ) => { view: SessionView; error?: undefined } | { error: string };
  replan: () => void;
  completeQueuedTask: () => void;
}

export function verified(context: Context, page: PageSnapshot) {
  context.view.serviceNavigation = undefined;
  const selected = context.selected!,
    before = context.before!;
  const evidence =
    before.stateKey !== page.stateKey
      ? {
          from: before.stateKey,
          to: page.stateKey,
          signature: selected.control.signature,
          label: selected.control.label,
          durationMs: Math.min(300000, Date.now() - context.selectedAt),
        }
      : undefined;
  const plan = context.view.goalPlan;
  const requestTask = context.view.request?.tasks[context.view.request.active];
  if (context.view.journey?.workflow) {
    const focused = selected.control.kind === "focus";
    if (focused) context.inputHandoff = selected;
    context.view.journey.workflow = recordWorkflowAction(
      context.view.journey.workflow,
      selected.control,
      true,
      page,
    );
    if (!focused) {
      context.view.verifiedSteps++;
      context.view.journey = advanceJourney(
        context.view.journey,
        page,
        selected.control,
        before.stateKey,
        Date.now() - context.selectedAt,
        Date.now(),
        before.origin,
      );
    }
    context.clearTarget();
    context.view.instruction = focused
      ? "Enter the requested details on the website, then continue guidance. Input contents have not been verified."
      : "The interface transition was verified. Finding the next milestone…";
    context.publish(context.view, focused ? undefined : evidence);
    context.planningRevision = "";
    context.requestReplan();
    return;
  }
  if (requestTask?.operation === "search") {
    context.view.verifiedSteps++;
    if (selected.control.kind === "focus") requestTask.searchPhase = "results";
    if (selected.control.kind === "navigation")
      context.verifiedDestination = selected.control.label;
    context.clearTarget();
    context.view.goalPlan = {
      ...plan!,
      status: "awaiting-choice",
      steps: [],
      reason: `Enter “${requestTask.desiredValue?.slice(0, 160)}” in the website search and select a matching result.`,
    };
    context.view.instruction = context.view.goalPlan.reason;
    context.publish(context.view, evidence);
    context.requestReplan();
    return;
  }
  if (context.view.journey) {
    context.view.journey = advanceJourney(
      context.view.journey,
      page,
      selected.control,
      before.stateKey,
      Date.now() - context.selectedAt,
    );
  }
  context.view.verifiedSteps++;
  context.clearTarget();
  const destinationReached =
    !!context.view.journey?.objective.value &&
    objectiveReached(context.view.journey, page);
  if (plan?.exploration && !destinationReached) {
    context.view.goalPlan = {
      ...plan,
      status: "unresolved",
      exploration: false,
      steps: [],
      reason:
        "The control result was verified. Checking the retained destination…",
    };
    context.view.instruction = context.view.goalPlan.reason;
    context.publish(context.view, evidence);
    context.planningRevision = "";
    context.requestReplan();
    return;
  }
  context.state("verified");
  context.view.instruction =
    "Control interaction verified. Choose another control or goal.";
  if (plan?.status === "guiding") {
    const remaining = destinationReached ? [] : plan.steps.slice(1);
    if (
      remaining.length &&
      remaining.every((step) =>
        page.controls.some(
          (c) =>
            c.id === step.controlId &&
            c.label === step.label &&
            c.signature ===
              before.controls.find((old) => old.id === c.id)?.signature &&
            c.enabled &&
            c.risk === "ordinary",
        ),
      ) &&
      page.controls.some((c) => c.id === remaining[0].controlId && c.visible)
    ) {
      // Rebind a known next step from this fresh scan before publishing the
      // verification. A menu reveal need not wait for another model query.
      context.planningRevision = "";
      context.view.goalPlan = { ...plan, steps: remaining };
      context.select(remaining[0].controlId, evidence);
      return;
    }
    if (
      (!destinationReached && contextualTask(context.view.journey)) ||
      remaining.length ||
      (!destinationReached && plan.source === "memory")
    ) {
      context.publish(context.view, evidence);
      context.replan();
      return;
    }
    if (!destinationReached && selected.control.kind === "expand") {
      if (
        requestTask &&
        requestTask.operation === "navigate" &&
        !requestTask.desiredValue
      ) {
        context.view.goalPlan = {
          ...plan,
          status: "completed",
          steps: [],
          reason:
            "The requested menu opened and its declared state change was verified.",
        };
        if (context.view.journey) context.view.journey.status = "completed";
        context.completeQueuedTask();
        context.publish(context.view, evidence);
        return;
      }
      context.view.goalPlan = {
        ...plan,
        status: "awaiting-choice",
        steps: [],
        reason:
          "Menu opened. Choose an option on the website, or describe the option you want.",
      };
      context.view.instruction = context.view.goalPlan.reason;
      if (context.view.liveDiagnostics?.planning)
        context.view.liveDiagnostics.planning.decision = "awaiting-choice";
      context.publish(context.view, evidence);
      return;
    }
    context.view.goalPlan = {
      ...plan,
      status: "completed",
      exploration: false,
      steps: [],
      reason: "The final step's expected result was observed.",
    };
    if (context.view.journey) context.view.journey.status = "completed";
    context.completeQueuedTask();
    context.view.instruction =
      "Goal reached. The expected control result was verified.";
    if (context.view.liveDiagnostics?.planning)
      context.view.liveDiagnostics.planning.decision = "completed";
  }
  context.publish(context.view, evidence);
}
