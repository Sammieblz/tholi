import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
import { setGoal } from "../support/acceptance-runner";
import { build } from "esbuild";

async function inspectForm(
  app: Awaited<ReturnType<typeof openNavigatorExtension>>,
  task: any,
) {
  // Test-only collector, executed through Playwright. This evaluates live DOM
  // semantics without granting the extension access or claiming coach activation.
  const bundle = await build({
    stdin: {
      contents:
        'import {PageDiscovery} from "./packages/page-discovery"; import {planTask} from "./packages/goal-planner/task-journey"; globalThis.__authProbe = task => {const page = new PageDiscovery().snapshot(); const plan = planTask(page, task); return {plan, target: page.controls.find(c => c.id === plan.steps[0]?.controlId), controls: page.controls.filter(c => c.form || c.kind === "focus").map(c => ({label:c.label,kind:c.kind,form:c.form,context:c.context,structure:c.structure}))};};',
      resolveDir: process.cwd(),
    },
    bundle: true,
    write: false,
    format: "iife",
  });
  await app.page.evaluate(bundle.outputFiles[0].text);
  return app.page.evaluate(
    (task) => (globalThis as any).__authProbe(task),
    task,
  );
}

for (const [goal, entryLabel, workflow] of [
  ["How to log in", "Log in", "login"],
  ["create account", "Create account", "register"],
]) {
  test(`Wikipedia ${goal} retains context after reaching its actual form`, async ({}, info) => {
    const app = await openNavigatorExtension(
      info.project.use.viewport || undefined,
    );
    try {
      await app.page.goto(
        "https://en.wikipedia.org/wiki/Casino_Royale_(novel)",
        { waitUntil: "networkidle" },
      );
      await app.start();
      const initial = await setGoal(app, goal);
      expect(initial.view.goalPlan.status).toBe("guiding");
      expect(initial.view.journey.objective.workflow).toBe(workflow);
      // Independent live website oracle. No Wikipedia selector enters product code.
      const entry = app.page
        .getByRole("link", { name: entryLabel, exact: true })
        .filter({ visible: true })
        .first();
      const selected = initial.view.page.controls.find(
        (c: any) => c.id === initial.view.selectedControlId,
      );
      expect(selected.label).toBe(entryLabel);
      expect(selected.risk).toBe("ordinary");
      const destination = new URL(
        (await entry.getAttribute("href"))!,
        app.page.url(),
      );
      await entry.click();
      const username = app.page.getByRole("textbox", {
        name: "Username",
        exact: true,
      });
      await expect(username).toBeVisible();
      const arrivalURL = new URL(app.page.url());
      if (arrivalURL.origin !== initial.view.journey.origin) {
        await expect
          .poll(async () => (await app.view()).continuationOrigin)
          .toBe(arrivalURL.origin);
        await expect(
          app.panel.getByRole("button", { name: "Continue task here" }),
        ).toBeEnabled();
        const held = await app.view();
        if (arrivalURL.origin !== destination.origin) {
          const state = await app.panel.evaluate(async () =>
            chrome.runtime.sendMessage({ type: "GET_SESSION" }),
          );
          expect(state.pendingNavigation.redirected).toBe(true);
        }
        expect(held.journey).toMatchObject({
          id: initial.view.journey.id,
          goal,
          status: "active",
        });
        expect(held.journey.progress).toHaveLength(0);
        const denied = await app.panel.evaluate(async () =>
          chrome.runtime.sendMessage({ type: "CONTINUE_TASK" }),
        );
        expect(denied.error).toContain("Allow access");
        const observation = await inspectForm(app, held.journey);
        expect(observation.plan.status, JSON.stringify(observation)).toBe(
          "guiding",
        );
        expect(observation.target).toMatchObject({
          label: "Username",
          kind: "focus",
          form: { authentication: workflow },
        });
        await app.page.screenshot({
          path: `output/qa/wikipedia-${workflow}-${info.project.name}.png`,
        });
        return;
      }
      await expect
        .poll(async () => {
          const v = await app.view();
          return v.page?.controls.find((c: any) => c.id === v.selectedControlId)
            ?.label;
        })
        .toBe("Username");
      const arrival = await app.view();
      expect(arrival.journey).toMatchObject({
        id: initial.view.journey.id,
        goal,
        status: "active",
      });
      expect(arrival.journey.progress).toHaveLength(1);
      expect(arrival.goalPlan.status).toBe("guiding");
      // Focus only; no credentials entered, no account created, no form submitted.
      await username.focus();
      await expect
        .poll(async () => (await app.view()).journey?.progress.length)
        .toBe(2);
      expect((await app.view()).journey.status).toBe("active");
      await app.page.screenshot({
        path: `output/qa/wikipedia-${workflow}-${info.project.name}.png`,
      });
    } catch (error) {
      const v = await app.view();
      console.log(
        JSON.stringify({
          status: v?.status,
          instruction: v?.instruction,
          plan: v?.goalPlan,
          journey: v?.journey,
          controls: v?.page?.controls
            .filter((c: any) => c.form || c.kind === "focus")
            .map((c: any) => ({
              label: c.label,
              kind: c.kind,
              visible: c.visible,
              form: c.form,
              context: c.context,
            })),
        }),
      );
      throw error;
    } finally {
      await app.close();
    }
  });
}
