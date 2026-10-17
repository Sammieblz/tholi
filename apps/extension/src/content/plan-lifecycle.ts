import { fullyUnclipped } from "../../../../packages/browser-adapter/geometry";
import { scrollTarget } from "../../../../packages/browser-adapter/scroll-target";
import { inspectGoal } from "../../../../packages/goal-planner/index";
import { beginJourney } from "../../../../packages/goal-planner/task-journey";
import type {
  NavigationRequest,
  PlanResult,
} from "../../../../packages/navigation-core/contracts";
import { workflowGuides } from "../../../../packages/navigation-core/guides";
import { advanceQueue } from "../../../../packages/navigation-core/queue";
import { canonicalGoal } from "../../../../packages/nlp/canonical";
import {
  GuidanceOverlay,
  guidanceVisible,
} from "../../../../packages/overlay-ui/index";
import {
  PageDiscovery,
  type BoundControl,
} from "../../../../packages/page-discovery/index";
import {
  type GoalPlan,
  type ObservedTransition,
  type PageControl,
  type PageSnapshot,
  type PendingNavigation,
  type RouteStrategy,
  type SiteMemory,
} from "../../../../packages/page-model/index";
import type { SessionView } from "../../../../packages/shared-types/index";

interface Context {
  view: SessionView;
  select: (
    id: string,
    observed?: ObservedTransition,
  ) => { view: SessionView; error?: undefined } | { error: string };
  clearTarget: () => void;
  state: (id: "choosing" | "guiding" | "verified") => void;
  publish: (
    view: SessionView,
    observed?: ObservedTransition,
    navigation?: PendingNavigation,
  ) => void;
  completeQueuedTask: () => void;
  refresh: () => void;
  memory: SiteMemory | undefined;
  workflowWaitTimer: NodeJS.Timeout | undefined;
  planningRevision: string;
  requestReplan: () => void;
  recoveryKey: string;
  recoveryStep: number;
  recoveryTimer: NodeJS.Timeout | undefined;
  discovery: PageDiscovery;
  installPlan: (plan: GoalPlan) => void;
  selected: BoundControl | undefined;
  before: PageSnapshot | undefined;
  selectedAt: number;
  cancelScroll: (() => void) | undefined;
  overlay: GuidanceOverlay;
  showFrameControl: (
    control: PageControl,
    instruction: string,
    review: boolean,
  ) =>
    | { error: string; view?: undefined }
    | { view: SessionView; error?: undefined };
  requestPlanner:
    | ((
        request: NavigationRequest,
        page: PageSnapshot,
        verifiedDestination?: string,
      ) => Promise<PlanResult>)
    | undefined;
  verifiedDestination: string | undefined;
  installRequest: (
    result: PlanResult,
    strategy?: RouteStrategy,
    savedRouteId?: string,
  ) =>
    | { view: SessionView; error?: undefined }
    | { error: string; view?: undefined };
}

export function installPlan(context: Context, plan: GoalPlan) {
  context.view.goalPlan = plan;
  context.view.instruction = plan.reason;
  if (plan.status === "guiding") context.select(plan.steps[0].controlId);
  else {
    context.clearTarget();
    context.state(plan.status === "completed" ? "verified" : "choosing");
    context.publish(context.view);
  }
  if (context.view.request && plan.status === "completed")
    context.completeQueuedTask();
  if (
    context.view.request &&
    (plan.issue === "consequential" || plan.issue === "unknown-effect")
  )
    context.view.request = advanceQueue(context.view.request, "boundary");
}

export function installRequest(
  context: Context,
  result: PlanResult,
  strategy?: RouteStrategy,
  savedRouteId?: string,
) {
  context.refresh();
  if (
    result.request &&
    context.view.request &&
    result.request.id === context.view.request.id &&
    (["completed", "canceled"].includes(context.view.request.status) ||
      result.request.active < context.view.request.active)
  )
    return { view: context.view };
  if (
    context.view.status !== "running" ||
    context.view.page?.revision !== result.revision
  )
    return { error: "Stale scan. Recalculate using the current document." };
  context.clearTarget();
  context.view.request = result.request;
  context.view.clarification = result.clarification;
  context.view.embeddingActivity = result.activity;
  if (result.plan && context.view.liveDiagnostics) {
    context.view.liveDiagnostics.planning = inspectGoal(
      context.view.page,
      result.canonicalGoal || result.plan.goal,
      context.memory,
    ).diagnostics;
    context.view.liveDiagnostics.planning.decision = result.plan.status;
    context.view.liveDiagnostics.planning.source = result.plan.source;
  }
  const task = result.request?.tasks[result.request.active];
  if (task && context.view.journey?.requestTaskId !== task.id) {
    context.view.journey = beginJourney(
      result.canonicalGoal || canonicalGoal(task),
      context.view.page.origin,
      strategy,
    );
    context.view.journey.savedRouteId = savedRouteId;
    context.view.journey.requestTaskId = task.id;
    context.view.journey.canonicalGoal =
      result.canonicalGoal || canonicalGoal(task);
    context.view.journey.goal = task.original;
  }
  if (result.workflow && context.view.journey)
    context.view.journey.workflow = result.workflow;
  if (
    result.workflow?.pendingAction?.acted &&
    !result.workflow.pendingAction.milestone.startsWith("handoff:") &&
    !result.workflow.waitExpired &&
    !context.workflowWaitTimer
  ) {
    context.workflowWaitTimer = setTimeout(
      () => {
        context.workflowWaitTimer = undefined;
        const w = context.view.journey?.workflow;
        if (
          !w ||
          !w.pendingAction?.acted ||
          ["completed", "canceled"].includes(w.status)
        )
          return;
        w.waitExpired = true;
        w.revision++;
        context.view.instruction =
          "The website has not confirmed the result. Keep waiting, retry, or replan; the task remains incomplete.";
        context.publish(context.view);
      },
      Math.max(
        0,
        120000 - (Date.now() - result.workflow.pendingAction.startedAt),
      ),
    );
  }
  if (
    result.plan?.action &&
    ["history-back", "tab-switch", "visual"].includes(result.plan.action.kind)
  ) {
    context.view.goalPlan = result.plan;
    context.view.instruction = result.plan.reason;
    context.publish(context.view);
    return { view: context.view };
  }
  if (result.plan?.budgetPending)
    setTimeout(() => {
      if (
        context.view.request?.id === result.request?.id &&
        context.view.status === "running"
      ) {
        context.planningRevision = "";
        context.requestReplan();
      }
    }, 100);
  if (result.plan) {
    if (
      result.plan.issue === "no-match" &&
      !result.clarification &&
      !["credentials", "two-factor", "authorization"].includes(
        context.view.page.screen?.kind || "",
      )
    ) {
      const key =
        (result.request?.id || "") + ":" + context.view.page.fingerprint;
      if (key !== context.recoveryKey) {
        context.recoveryKey = key;
        context.recoveryStep = 0;
      }
      const stages = ["priority", "retrieval", "structure", "vision"] as const;
      const stage = stages[Math.min(context.recoveryStep, 3)];
      result.plan.recoveryStage = stage;
      if (context.recoveryStep < 3) {
        context.recoveryStep++;
        clearTimeout(context.recoveryTimer);
        context.recoveryTimer = setTimeout(() => {
          if (
            context.view.request?.id !== result.request?.id ||
            context.view.status !== "running"
          )
            return;
          const guide =
            result.workflow &&
            workflowGuides.find((g) => g.id === result.workflow!.guideId);
          const targets =
            guide?.milestones[result.workflow?.activeMilestone || 0]?.targets ||
            [];
          context.discovery.setQuery(
            [
              result.canonicalGoal || result.request?.original || "",
              ...targets,
            ].join(" "),
          );
          context.discovery.invalidate();
          context.refresh();
          context.planningRevision = "";
          context.requestReplan();
        }, 100);
        result.plan.reason =
          "Finding your next step… Your destination is retained.";
      }
    }
    if (result.plan.status === "completed" && context.view.journey)
      context.view.journey.status = "completed";
    context.installPlan(result.plan);
    if (result.workflow?.status === "review" && result.workflow.pendingAction) {
      const target = context.discovery.bindings.get(
        result.workflow.pendingAction.controlId,
      );
      if (
        target?.control.visible &&
        target.control.enabled &&
        !target.control.occluded
      ) {
        context.selected = target;
        context.before = context.view.page;
        context.selectedAt = Date.now();
        context.view.selectedControlId = target.control.id;
        context.view.instruction = result.plan.reason;
        context.cancelScroll?.();
        if (
          guidanceVisible() &&
          (!target.control.inViewport || !fullyUnclipped(target.geometry))
        )
          context.cancelScroll = scrollTarget(
            target.geometry,
            () =>
              context.selected === target &&
              guidanceVisible() &&
              context.view.status === "running" &&
              !target.control.occluded,
          );
        context.overlay.show(target.geometry, context.view.instruction, {
          key:
            (context.view.request?.id || context.view.journey?.id || "") +
            ":" +
            target.control.id +
            ":" +
            context.view.verifiedSteps,
          attention: target.control.risk === "ordinary",
          warning: target.control.risk !== "ordinary",
        });
        context.publish(context.view);
      }
      const external = context.view.page?.controls.find(
        (c) =>
          c.id === result.workflow!.pendingAction!.controlId &&
          c.reference?.frameId,
      );
      if (external)
        context.showFrameControl(external, result.plan.reason, true);
    }
  } else {
    context.view.goalPlan = {
      goal: result.request?.original || "Request",
      source: "semantics",
      status: "unresolved",
      confidence: 0,
      issue: result.status === "clarification" ? "ambiguous" : "no-match",
      steps: [],
      reason: result.reason,
    };
    context.view.instruction = result.reason;
    context.publish(context.view);
  }
  return { view: context.view };
}

export function completeQueuedTask(context: Context) {
  if (!context.view.request || context.view.request.status !== "active") return;
  context.view.request = advanceQueue(context.view.request, "verified");
  context.publish(context.view);
  if (context.view.request.status === "active")
    queueMicrotask(() => context.requestReplan());
}

export function requestReplan(context: Context) {
  const request = context.view.request,
    page = context.view.page;
  if (
    !request ||
    !page ||
    !context.requestPlanner ||
    !["active", "clarification"].includes(request.status) ||
    context.view.status !== "running"
  )
    return;
  // A queued task can change without a new page revision.
  const revision = `${page.revision}:${request.active}:${context.view.verifiedSteps}:${context.view.journey?.totalVerified ?? context.view.journey?.progress.length ?? 0}:${request.tasks[request.active]?.searchPhase || ""}:${context.view.journey?.workflow?.revision || 0}`;
  if (context.planningRevision === revision) return;
  context.planningRevision = revision;
  const id = request.id,
    active = request.active;
  void context
    .requestPlanner(request, page, context.verifiedDestination)
    .then((result) => {
      if (context.planningRevision !== revision) return;
      if (
        context.view.status !== "running" ||
        context.view.request?.id !== id ||
        context.view.request.active !== active ||
        !["active", "clarification"].includes(context.view.request.status)
      )
        return;
      if (context.view.page?.revision !== result.revision) {
        context.planningRevision = "";
        context.requestReplan();
        return;
      }
      const installed = context.installRequest(
        result,
        context.view.journey?.strategy,
      );
      // Installation refreshes the document again. A layout-only revision can
      // invalidate this result without triggering a structural replan. Retry
      // only that rejected result, leaving newer plans and ended tasks alone.
      if (
        "error" in installed &&
        installed.error ===
          "Stale scan. Recalculate using the current document." &&
        context.planningRevision === revision &&
        context.view.status === "running" &&
        context.view.request?.id === id &&
        context.view.request.active === active
      ) {
        context.planningRevision = "";
        context.requestReplan();
      }
    })
    .catch(() => {
      if (context.planningRevision === revision) context.planningRevision = "";
    });
}
