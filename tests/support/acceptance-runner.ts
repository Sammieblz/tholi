import { expect, type TestInfo, type Locator } from "@playwright/test";
import type { AcceptanceCase } from "../../packages/acceptance-metrics";
import { openNavigatorExtension } from "./navigator-extension";
import { hasFinalStepEvidence } from "./final-step-evidence";
export type NavigatorApp = Awaited<ReturnType<typeof openNavigatorExtension>>;
export type GoalContract = { id: string; goal: string; expected: string };
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
    let reply;
    // Responsive reflow may legitimately invalidate a scan between these two
    // messages. Repeat only the explicitly rejected request with fresh evidence;
    // preserve all other errors and the caller's target/outcome assertions.
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
      reply = await chrome.runtime.sendMessage({
        type: "SET_GOAL",
        goal,
        revision: current.page.revision,
      });
      if (
        reply.error !==
        "The page changed before this request. Use the current scan."
      )
        return reply;
    }
    return reply;
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
async function noAutomation(app: NavigatorApp, result: AcceptanceCase) {
  result.automation += await app.page.evaluate(
    () => (window as any).__navigatorBenchmark?.clicks || 0,
  );
  await resetClicks(app);
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
    };
  });
}
export async function runGoal(
  app: NavigatorApp,
  contract: GoalContract,
  result: AcceptanceCase,
  oracle: {
    target: Locator;
    sectionLink?: Locator;
    reveal?: Locator;
    revealLabel?: RegExp;
    revealed?: Locator;
    selectedLabel: RegExp;
    kind: string;
    outcome: () => Promise<boolean>;
    picker?: boolean;
  },
) {
  await resetClicks(app);
  const reply = await setGoal(app, contract.goal);
  expect(reply.error).toBeUndefined();
  result.modelCalls += Number(reply.view.goalPlan.source === "on-device");
  result.unresolved = reply.view.goalPlan.status === "unresolved";
  result.stopped = reply.view.status === "stopped";
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
    await noAutomation(app, result);
    expect(correct).toBe(true);
    const before = view.verifiedSteps;
    const nextStep = view.page.controls.find(
      (c: any) => c.id === view.goalPlan.steps[1]?.controlId,
    );
    await oracle.reveal!.click();
    await expect
      .poll(async () => (await progress(app)).verifiedSteps, { timeout: 10000 })
      .toBeGreaterThanOrEqual(before + 1);
    const actual = await (oracle.revealed || oracle.target).isVisible();
    result.verifications.push(actual);
    if (!actual) result.falseSuccess++;
    await expect
      .poll(
        async () => {
          const next = await progress(app);
          return (
            !!next.selectedControlId ||
            (next.verifiedSteps === before + 2 &&
              next.goalPlan.status === "completed")
          );
        },
        { timeout: 10000 },
      )
      .toBe(true);
    view = await app.view();
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
      await resetClicks(app);
      expect(result.completed).toBe(true);
      return;
    }
    expect(view.verifiedSteps).toBe(before + 1);
    selected = view.page.controls.find(
      (c: any) => c.id === view.selectedControlId,
    );
    await resetClicks(app);
  }
  const correct =
    !!selected &&
    selected.kind === oracle.kind &&
    oracle.selectedLabel.test(selected.label);
  result.targets.push(correct);
  await noAutomation(app, result);
  expect(correct).toBe(true);
  if (oracle.picker && selected.inViewport === false) {
    await oracle.target.scrollIntoViewIfNeeded();
    await expect
      .poll(() =>
        app.panel.evaluate(async () => {
          const { view } = await chrome.runtime.sendMessage({
            type: "GET_SESSION",
          });
          const target = view.page?.controls.find(
            (control: any) => control.id === view.selectedControlId,
          );
          return {
            status: view.goalPlan?.status,
            signature: target?.signature,
            inViewport: target?.inViewport,
          };
        }),
      )
      .toEqual({
        status: "guiding",
        signature: selected.signature,
        inViewport: true,
      });
    view = await app.view();
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
          const current = await progress(app);
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
    const current = await app.view();
    throw new Error(
      String(error) +
        "\nOutcome diagnostics: " +
        JSON.stringify({
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
    .poll(async () => (await progress(app)).goalPlan?.status)
    .toBe(oracle.picker ? "awaiting-choice" : "completed");
  const actual = await oracle.outcome();
  result.verifications.push(actual);
  if (!actual) result.falseSuccess++;
  result.completed = actual;
  expect(actual).toBe(true);
}
