import { expect, type TestInfo, type Locator } from "@playwright/test";
import type { AcceptanceCase } from "../../packages/acceptance-metrics";
import { openNavigatorExtension } from "./navigator-extension";
import {
  hasFinalStepEvidence,
  hasRecoveredSectionEvidence,
} from "./final-step-evidence";
import { negativeGoals, refusalCases } from "./acceptance-contracts";
export type NavigatorApp = Awaited<ReturnType<typeof openNavigatorExtension>>;
export type GoalContract = { id: string; goal: string; expected: string };
/** Let the test's own reset finish before observing a sticky/reparenting header. */
export async function settlePageTop() {
  window.scrollTo({ top: 0, left: 0, behavior: "instant" });
  await new Promise<void>((resolve) =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
  );
}
export async function attachCase(info: TestInfo, sample: AcceptanceCase) {
  await info.attach("navigator-acceptance-case", {
    body: Buffer.from(JSON.stringify(sample)),
    contentType: "application/json",
  });
}
export function sample(
  id: string,
  suite: AcceptanceCase["suite"],
  supported = true,
): AcceptanceCase {
  return {
    id,
    suite,
    supported,
    completed: false,
    unresolved: false,
    stopped: false,
    targets: [],
    verifications: [],
    falseSuccess: 0,
    automation: 0,
    secretLeaks: 0,
    modelCalls: 0,
  };
}
export async function setGoal(app: NavigatorApp, goal: string) {
  await app.page.bringToFront();
  return app.panel.evaluate(async (goal) => {
    const current = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
    return chrome.runtime.sendMessage({
      type: "SET_GOAL",
      goal,
      revision: current.page.revision,
    });
  }, goal);
}
export async function resetClicks(app: NavigatorApp) {
  await app.page.evaluate(() => {
    const win = window as any;
    if (!win.__navigatorBenchmark) {
      win.__navigatorBenchmark = { clicks: 0 };
      document.addEventListener(
        "click",
        () => win.__navigatorBenchmark.clicks++,
        true,
      );
    }
    win.__navigatorBenchmark.clicks = 0;
  });
}
// Poll worker-owned evidence without serializing hundreds of page controls
// across the browser automation boundary on every sample.
function progress(app: NavigatorApp) {
  return app.panel.evaluate(async () => {
    const { view } = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
    return {
      status: view.status,
      verifiedSteps: view.verifiedSteps,
      request: view.request,
      journey: view.journey,
      goalPlan: view.goalPlan,
      selectedControlId: view.selectedControlId,
      serviceNavigation: view.serviceNavigation,
    };
  });
}
export type AcceptanceElement = Pick<
  Locator,
  "click" | "check" | "isVisible" | "scrollIntoViewIfNeeded" | "boundingBox"
>;
export interface AcceptanceProbe {
  setGoal(goal: string): Promise<any>;
  view(): Promise<any>;
  progress(): Promise<any>;
  selected(): Promise<any>;
  /** Optional provider-arm readiness, without changing the independent oracle. */
  settle?(view: any): Promise<any>;
  resetClicks(): Promise<void>;
  clicks(): Promise<number>;
}
async function recordAutomation(
  probe: AcceptanceProbe,
  result: AcceptanceCase,
) {
  result.automation += await probe.clicks();
  await probe.resetClicks();
}
export async function runGoal(
  app: NavigatorApp,
  contract: GoalContract,
  result: AcceptanceCase,
  oracle: Parameters<typeof runGoalContract>[3],
) {
  return runGoalContract(chromiumProbe(app), contract, result, oracle);
}
export function chromiumProbe(app: NavigatorApp): AcceptanceProbe {
  return {
    setGoal: (goal) => setGoal(app, goal),
    view: app.view,
    progress: () => progress(app),
    selected: () =>
      app.panel.evaluate(async () => {
        const { view } = await chrome.runtime.sendMessage({
          type: "GET_SESSION",
        });
        const target = view.page?.controls.find(
          (c: any) => c.id === view.selectedControlId,
        );
        return {
          status: view.goalPlan?.status,
          signature: target?.signature,
          inViewport: target?.inViewport,
        };
      }),
    resetClicks: () => resetClicks(app),
    clicks: () =>
      app.page.evaluate(
        () => (window as any).__navigatorBenchmark?.clicks || 0,
      ),
  };
}
export async function runNegativeContract(
  probe: AcceptanceProbe,
  id: string,
  result: AcceptanceCase,
  oracle: { act(): Promise<void>; refresh(): Promise<unknown> },
) {
  await probe.resetClicks();
  const reply = await probe.setGoal(negativeGoals[id]);
  expect(reply.error).toBeUndefined();
  let view = reply.view;
  result.automation += await probe.clicks();
  expect(result.automation).toBe(0);
  const refuse = refusalCases.includes(id);
  result.unresolved = view.goalPlan.status === "unresolved";
  if (view.selectedControlId) result.targets.push(!refuse);
  if (refuse) {
    expect(view.selectedControlId).toBeUndefined();
    expect(result.unresolved).toBe(true);
    if (id === "unknown-edit-effect")
      expect(view.goalPlan.issue).toBe("unknown-effect");
    if (id === "implicit-submit")
      expect(view.goalPlan.issue).toBe("consequential");
  } else {
    const before = view.verifiedSteps;
    await oracle.act();
    await oracle.refresh();
    view = await probe.view();
    for (let n = before; n < view.verifiedSteps; n++) {
      result.verifications.push(false);
      result.falseSuccess++;
    }
    if (view.goalPlan?.status === "completed") result.falseSuccess++;
    expect(view.verifiedSteps).toBe(before);
    expect(view.goalPlan?.status).not.toBe("completed");
    if (id === "stale-target") expect(view.selectedControlId).toBeUndefined();
  }
  result.completed = true;
}
export async function runGoalContract(
  probe: AcceptanceProbe,
  contract: GoalContract,
  result: AcceptanceCase,
  oracle: {
    target: AcceptanceElement;
    sectionLink?: AcceptanceElement;
    reveal?: AcceptanceElement;
    revealLabel?: RegExp;
    revealed?: AcceptanceElement;
    selectedLabel: RegExp;
    matchesTarget?: (control: any) => boolean;
    kind: string;
    outcome: () => Promise<boolean>;
    picker?: boolean;
  },
) {
  await probe.resetClicks();
  const reply = await probe.setGoal(contract.goal);
  expect(reply.error).toBeUndefined();
  const acknowledged = reply.view;
  if (probe.settle) reply.view = await probe.settle(reply.view);
  if (
    reply.view.status === "running" &&
    reply.view.goalPlan.status === "unresolved" &&
    reply.view.goalPlan.recoveryStage === "retrieval"
  ) {
    // A changing page may acknowledge the retained request before guidance is
    // ready. Wait for this request, keeping the target and outcome oracles below.
    const requestId = reply.view.request.id;
    await expect
      .poll(
        async () => {
          const current = await probe.progress();
          return (
            current.request?.id === requestId &&
            current.status === "running" &&
            (current.goalPlan?.status === "guiding" ||
              (oracle.kind === "section" &&
                current.goalPlan?.status === "completed"))
          );
        },
        { timeout: 10000 },
      )
      .toBe(true);
    reply.view = await probe.view();
    expect(reply.view.request?.id).toBe(requestId);
  }
  result.modelCalls += Number(reply.view.goalPlan.source === "on-device");
  result.unresolved = reply.view.goalPlan.status === "unresolved";
  result.stopped = reply.view.status === "stopped";
  if (oracle.kind === "section" && reply.view.goalPlan.status === "completed") {
    const actual = await oracle.outcome();
    const correct = hasRecoveredSectionEvidence(
      acknowledged,
      reply.view,
      oracle.selectedLabel,
      actual,
    );
    result.targets.push(correct);
    result.verifications.push(actual);
    if (!actual) result.falseSuccess++;
    await recordAutomation(probe, result);
    result.completed = correct && actual;
    expect(correct).toBe(true);
    expect(actual).toBe(true);
    return;
  }
  expect(reply.view.goalPlan.status).toBe("guiding");
  let view = reply.view;
  let selected = view.page.controls.find(
    (c: any) => c.id === view.selectedControlId,
  );
  if (selected?.kind === "expand" && !oracle.picker) {
    const correct =
      !!oracle.reveal &&
      (oracle.revealLabel || /appearance/i).test(selected.label);
    result.targets.push(correct);
    await recordAutomation(probe, result);
    expect(correct).toBe(true);
    const before = view.verifiedSteps;
    const nextStep = view.page.controls.find(
      (c: any) => c.id === view.goalPlan.steps[1]?.controlId,
    );
    await oracle.reveal!.click();
    await expect
      .poll(async () => (await probe.progress()).verifiedSteps, {
        timeout: 10000,
      })
      .toBeGreaterThanOrEqual(before + 1);
    const actual = await (oracle.revealed || oracle.target).isVisible();
    result.verifications.push(actual);
    if (!actual) result.falseSuccess++;
    await expect
      .poll(
        async () => {
          const next = await probe.progress();
          return (
            !!next.selectedControlId ||
            (next.verifiedSteps === before + 2 &&
              next.goalPlan.status === "completed")
          );
        },
        { timeout: 10000 },
      )
      .toBe(true);
    view = await probe.view();
    if (
      view.verifiedSteps === before + 2 &&
      view.goalPlan.status === "completed"
    ) {
      // The website can reveal and focus its field in one user click. Count both
      // emitted targets and verification claims against independent DOM outcomes.
      const correct =
        oracle.kind === "focus" &&
        nextStep?.kind === "focus" &&
        oracle.selectedLabel.test(nextStep.label);
      result.targets.push(correct);
      const focused = await oracle.outcome();
      result.verifications.push(focused);
      if (!focused) result.falseSuccess++;
      result.completed = correct && focused;
      await probe.resetClicks();
      expect(result.completed).toBe(true);
      return;
    }
    if (probe.settle) view = await probe.settle(view);
    expect(view.verifiedSteps).toBe(before + 1);
    selected = view.page.controls.find(
      (c: any) => c.id === view.selectedControlId,
    );
    await probe.resetClicks();
  }
  const matchesSelection = (control: any) =>
    !!control &&
    control.kind === oracle.kind &&
    oracle.selectedLabel.test(control.label) &&
    (!oracle.matchesTarget || oracle.matchesTarget(control));
  const correct = matchesSelection(selected);
  result.targets.push(correct);
  await recordAutomation(probe, result);
  expect(correct).toBe(true);
  if (oracle.picker && selected.inViewport === false) {
    await oracle.target.scrollIntoViewIfNeeded();
    await expect
      .poll(() => probe.selected())
      .toEqual({
        status: "guiding",
        signature: selected.signature,
        inViewport: true,
      });
    view = await probe.view();
    if (probe.settle) {
      view = await probe.settle(view);
      selected = view.page.controls.find(
        (control: any) => control.id === view.selectedControlId,
      );
      const freshCorrect = matchesSelection(selected);
      result.targets.push(freshCorrect);
      expect(freshCorrect).toBe(true);
    }
  }
  if (oracle.kind === "choice") await oracle.target.check();
  else if (oracle.kind === "section" && selected.role === "heading")
    await oracle.target.scrollIntoViewIfNeeded();
  else if (oracle.kind === "section" && selected.role === "link")
    await oracle.sectionLink!.click();
  else await oracle.target.click();
  try {
    await expect
      .poll(
        async () => {
          const current = await probe.progress();
          if (hasFinalStepEvidence(view, current, oracle.kind, false))
            return true;
          if (!["choice", "section"].includes(oracle.kind)) return false;
          return hasFinalStepEvidence(
            view,
            current,
            oracle.kind,
            await oracle.outcome(),
          );
        },
        { timeout: 10000 },
      )
      .toBe(true);
  } catch (error) {
    const current = await probe.view();
    throw new Error(
      String(error) +
        "\nOutcome diagnostics: " +
        JSON.stringify({
          before: {
            verifiedSteps: view.verifiedSteps,
            requestId: view.request?.id,
            journeyId: view.journey?.id,
          },
          requestId: current.request?.id,
          journeyId: current.journey?.id,
          status: current.status,
          instruction: current.instruction,
          verifiedSteps: current.verifiedSteps,
          plan: current.goalPlan,
          selected: current.page.controls.find(
            (c: any) => c.id === current.selectedControlId,
          ),
          box: await oracle.target.boundingBox(),
          actual: await oracle.outcome(),
        }),
    );
  }
  await expect
    .poll(async () => (await probe.progress()).goalPlan?.status)
    .toBe(oracle.picker ? "awaiting-choice" : "completed");
  const actual = await oracle.outcome();
  result.verifications.push(actual);
  if (!actual) result.falseSuccess++;
  result.completed = actual;
  expect(actual).toBe(true);
}
