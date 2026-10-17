import type { SessionView } from "../../../../../../packages/shared-types";
import type { WorkflowContext } from "../../../../../../packages/navigation-core/workflow-contracts";
import { workflowGuides } from "../../../../../../packages/navigation-core/guides";
import { sanitizeGoal } from "../../../../../../packages/privacy-redaction";

const terminal = (workflow: WorkflowContext) =>
  ["completed", "canceled", "paused"].includes(workflow.status);
const milestoneFor = (workflow: WorkflowContext) =>
  workflowGuides.find(
    (guide) =>
      guide.id === workflow.guideId && guide.version === workflow.guideVersion,
  )?.milestones[workflow.activeMilestone];

/** A retained journey is useful history, not necessarily a current input prompt. */
export function currentAttentionWorkflow(
  view?: SessionView,
  pending = false,
  draft = "",
) {
  const workflow = view?.journey?.workflow;
  const request = view?.request;
  const task = request?.tasks[request.active];
  if (
    pending ||
    !view ||
    !workflow ||
    terminal(workflow) ||
    !["running", "waiting", "rerouting", "boundary"].includes(view.status) ||
    view.goalPlan?.status === "completed" ||
    view.journey?.status === "completed" ||
    !request ||
    ["completed", "canceled", "paused"].includes(request.status) ||
    !task ||
    !["active", "blocked"].includes(task.status) ||
    task.id !== workflow.requestTaskId ||
    (view.journey?.requestTaskId && view.journey.requestTaskId !== task.id)
  )
    return;
  const normalize = (text: string) =>
    sanitizeGoal(text).toLowerCase().replace(/\s+/g, " ").trim();
  if (draft.trim() && normalize(draft) !== normalize(request.original)) return;
  return workflow;
}

export function workflowInputPending(workflow: WorkflowContext) {
  const milestone = milestoneFor(workflow);
  return (
    !terminal(workflow) &&
    ["active", "waiting"].includes(workflow.status) &&
    milestone?.kind === "input" &&
    workflow.pendingAction?.milestone === milestone.id &&
    !workflow.verified.some((step) => step.milestone === milestone.id)
  );
}

export function workflowRequiresAttention(workflow: WorkflowContext) {
  if (terminal(workflow)) return false;
  const milestone = milestoneFor(workflow);
  if (!milestone) return false;
  if (workflow.waitExpired || ["review", "failed"].includes(workflow.status))
    return true;
  if (milestone.kind === "input") return workflowInputPending(workflow);
  return (
    workflow.status === "active" &&
    !!milestone.entity &&
    !workflow.entities.some(
      (entity) => entity.type === milestone.entity && entity.value.trim(),
    )
  );
}
