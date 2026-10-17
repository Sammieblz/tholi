// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { SessionView } from "../../../packages/shared-types/index";
import type { WorkflowContext } from "../../../packages/navigation-core/workflow-contracts";
import { workflowGuides } from "../../../packages/navigation-core/guides";
import { beginJourney } from "../../../packages/goal-planner/task-journey";
import {
  currentAttentionWorkflow,
  workflowInputPending,
  workflowRequiresAttention,
} from "../../../apps/extension/src/ui/features/journey/workflow-presentation";
import { WorkflowPanel } from "../../../apps/extension/src/ui/features/journey/WorkflowPanel";

(
  globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }
).IS_REACT_ACT_ENVIRONMENT = true;
const guide = workflowGuides.find((g) =>
  g.milestones.some((m) => m.kind === "input"),
)!;
const activeMilestone = guide.milestones.findIndex((m) => m.kind === "input");
const milestone = guide.milestones[activeMilestone];
function fixture(): SessionView {
  const taskId = crypto.randomUUID();
  const original = "Deploy my website";
  const workflow: WorkflowContext = {
    id: crypto.randomUUID(),
    requestTaskId: taskId,
    guideId: guide.id,
    guideVersion: guide.version,
    original,
    objective: original,
    outcome: "result",
    revision: 1,
    entities: [],
    exclusions: [],
    activeMilestone,
    verified: [],
    status: "waiting",
    reason: "Enter the required details.",
    pendingAction: {
      milestone: milestone.id,
      signature: "field-signature",
      controlId: "field",
      label: "Project name",
      beforeRevision: 1,
      beforeFingerprint: "screen",
      acted: false,
      startedAt: Date.now(),
    },
  };
  return {
    status: "running",
    instruction: workflow.reason,
    verifiedSteps: 0,
    confidence: 1,
    routeId: "navigator.live",
    routeVersion: "1",
    history: [],
    journey: {
      ...beginJourney(original, "https://example.com"),
      workflow,
      requestTaskId: taskId,
    },
    request: {
      id: crypto.randomUUID(),
      original,
      active: 0,
      status: "active",
      createdAt: Date.now(),
      tasks: [
        {
          id: taskId,
          original,
          operation: "navigate",
          target: "deployment",
          qualifiers: [],
          exclusions: [],
          scope: "any",
          status: "active",
        },
      ],
    },
  };
}
let root: Root | undefined;
afterEach(async () => {
  if (root) await act(async () => root!.unmount());
  root = undefined;
  document.body.innerHTML = "";
});
async function render(view: SessionView, pending = false, draft = "") {
  if (!root) {
    document.body.innerHTML = '<div id="mount"></div>';
    root = createRoot(document.getElementById("mount")!);
  }
  const workflow = currentAttentionWorkflow(view, pending, draft);
  await act(async () =>
    root!.render(
      workflow
        ? createElement(WorkflowPanel, {
            workflow,
            compact: true,
            disabled: false,
            onMessage: vi.fn(),
          })
        : null,
    ),
  );
}
describe("task details follow only the current unfinished input", () => {
  it("shows a live input handoff then removes it after Stop and restores it only on resume", async () => {
    const view = fixture();
    await render(view);
    expect(document.querySelector("button")?.textContent).toBeTruthy();
    expect(document.body.textContent).toContain(
      "Continue after entering details",
    );
    await render({ ...view, status: "stopped" });
    expect(document.body.textContent).toBe("");
    await render({ ...view, status: "paused" });
    expect(document.body.textContent).toBe("");
    await render(view);
    expect(document.body.textContent).toContain(
      "Continue after entering details",
    );
  });
  it("removes an old input prompt after arrival even if its workflow snapshot still says waiting", async () => {
    const view = fixture();
    await render(view);
    await render({
      ...view,
      journey: { ...view.journey!, status: "completed" },
    });
    expect(document.body.textContent).toBe("");
    expect(
      currentAttentionWorkflow({ ...view, status: "completed" }),
    ).toBeUndefined();
    expect(
      currentAttentionWorkflow({
        ...view,
        request: { ...view.request!, status: "completed" },
      }),
    ).toBeUndefined();
  });
  it("hides old details during destination editing, planning, and task replacement", async () => {
    const view = fixture();
    await render(view, false, view.request!.original);
    expect(document.body.textContent).toContain(
      "Continue after entering details",
    );
    await render(view, false, "Find my account settings instead");
    expect(document.body.textContent).toBe("");
    await render(view, true);
    expect(document.body.textContent).toBe("");
    const replaced = {
      ...view,
      request: {
        ...view.request!,
        tasks: [{ ...view.request!.tasks[0], id: crypto.randomUUID() }],
      },
    };
    await render(replaced);
    expect(document.body.textContent).toBe("");
  });
  it("does not prompt from an unbound, replaced, verified, canceled, or outdated milestone", () => {
    const w = fixture().journey!.workflow!;
    expect(workflowInputPending(w)).toBe(true);
    for (const changed of [
      { ...w, pendingAction: undefined },
      {
        ...w,
        pendingAction: { ...w.pendingAction!, milestone: "an-earlier-step" },
      },
      { ...w, guideVersion: "old-version" },
      { ...w, status: "canceled" as const },
      { ...w, status: "completed" as const },
      {
        ...w,
        verified: [
          {
            milestone: milestone.id,
            revision: 1,
            evidence: {
              kind: "state" as const,
              subject: "field",
              text: "Handoff observed",
              revision: 1,
            },
          },
        ],
      },
    ]) {
      expect(workflowInputPending(changed)).toBe(false);
      expect(workflowRequiresAttention(changed)).toBe(false);
    }
  });
  it("retains a necessary manual handoff after field focus, which does not verify input", async () => {
    const view = fixture();
    view.journey!.workflow!.pendingAction!.acted = true;
    await render(view);
    expect(document.body.textContent).toContain(
      "Continue after entering details",
    );
    expect(view.journey!.workflow!.verified).toHaveLength(0);
  });
  it("keeps a necessary recovery notice without reviving the old input form", async () => {
    const view = fixture();
    view.journey!.workflow = {
      ...view.journey!.workflow!,
      status: "verifying",
      waitExpired: true,
    };
    await render(view);
    expect(document.body.textContent).toContain(
      "The result is still unverified",
    );
    expect(document.body.textContent).not.toContain("Task details");
    expect(document.body.textContent).not.toContain(
      "Continue after entering details",
    );
  });
});
