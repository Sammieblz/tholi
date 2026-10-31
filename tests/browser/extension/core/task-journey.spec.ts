import { test, expect } from "../../../support/browser-test";
import { openNavigatorExtension } from "../../../support/navigator-extension";
import {
  navigationServiceFixture,
  navigationServicePageHtml,
} from "../../../support/navigation-service-fixture";
type App = Awaited<ReturnType<typeof openNavigatorExtension>>;

async function serviceJourney(viewport?: { width: number; height: number }) {
  const service = await navigationServiceFixture("extension-chromium");
  let app: App | undefined;
  const close = async () => {
    try {
      await app?.close();
    } finally {
      await service.close();
    }
  };
  try {
    app = await openNavigatorExtension(viewport);
    // Only the trusted worker receives synthetic fixture credentials. Native
    // permission and real sign-in prompts remain separate evidence.
    await app.worker.evaluate(async (settings) => {
      await chrome.storage.local.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      });
      await chrome.storage.local.set({ "service-auth": settings });
    }, service.settings);
    await app.context.route(
      "http://localhost:5173/service-journey/**",
      (route) =>
        route.fulfill({
          contentType: "text/html; charset=utf-8",
          body: navigationServicePageHtml,
        }),
    );
    await app.page.goto("http://localhost:5173/service-journey/start");
    await app.start();
    return { ...service, app, close };
  } catch (error) {
    await close();
    throw error;
  }
}
async function setGoal(app: App, goal: string) {
  const reply = await app.panel.evaluate(async (goal) => {
    const r = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
    return chrome.runtime.sendMessage({
      type: "SET_GOAL",
      goal,
      revision: r.page.revision,
    });
  }, goal);
  expect(reply.error).toBeUndefined();
  return reply.view;
}
async function next(app: App, label: string) {
  try {
    await expect
      .poll(async () => {
        const v = await app.view();
        return v.page?.controls.find((c: any) => c.id === v.selectedControlId)
          ?.label;
      })
      .toBe(label);
  } catch (error) {
    const view = await app.view();
    throw new Error(
      String(error) +
        "\n" +
        JSON.stringify({
          status: view.status,
          goalPlan: view.goalPlan,
          journey: view.journey,
          controls: view.page?.controls.map((c: any) => ({
            id: c.id,
            label: c.label,
            kind: c.kind,
            context: c.context,
            checked: c.checked,
            visible: c.visible,
            expanded: c.expanded,
            revealIds: c.revealIds,
          })),
        }),
    );
  }
}
test("retains one destination through modal, full document navigation and preference selection", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.context.route("http://localhost:5173/journey/**", (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: r.request().url().endsWith("/settings")
          ? `<html lang="en"><main><h1>Preferences</h1><fieldset><legend>Language</legend><label><input type="radio" name="lang" checked>English</label><label><input id="spanish" type="radio" name="lang">Spanish</label></fieldset></main><script>document.getElementById('spanish').addEventListener('change', () => document.documentElement.lang='es')</script></html>`
          : `<html lang="en"><button aria-controls="language-dialog" aria-expanded="false">Languages</button><div role="dialog" aria-label="Languages" id="language-dialog" hidden></div><script>document.querySelector('button').addEventListener('click', function() { this.setAttribute('aria-expanded','true'); const menu=document.getElementById('language-dialog'); menu.hidden=false; menu.innerHTML='<a href="/journey/settings">Language preferences</a>'; });</script></html>`,
      }),
    );
    await app.page.goto("http://localhost:5173/journey/start");
    await app.start();
    const initial = await setGoal(app, "Change language to Spanish"),
      id = initial.journey.id;
    expect(initial.goalPlan.route).toMatchObject({
      complete: false,
      clicks: 2,
    });
    await app.page
      .getByRole("button", { name: "Languages", exact: true })
      .click();
    await next(app, "Language preferences");
    expect((await app.view()).journey).toMatchObject({ id, status: "active" });
    await app.page.getByRole("link", { name: "Language preferences" }).click();
    await next(app, "Language: Spanish");
    const intermediate = await app.view();
    expect(intermediate.journey).toMatchObject({
      id,
      status: "active",
      objective: { value: "Spanish" },
    });
    expect(intermediate.goalPlan.status).toBe("guiding");
    await app.page.getByRole("radio", { name: "Spanish" }).check();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
    const final = await app.view();
    expect(final.journey.id).toBe(id);
    expect(final.journey.progress).toHaveLength(3);
    expect(final.verifiedSteps).toBe(3);
    await expect
      .poll(async () =>
        app.panel.evaluate(
          async () =>
            (await chrome.runtime.sendMessage({ type: "GET_TASKS" })).tasks[0]
              ?.estimate?.clicks,
        ),
      )
      .toBe(0);
    expect(await app.page.evaluate(() => document.documentElement.lang)).toBe(
      "es",
    );
    await app.openDetails();
    await expect(app.panel.locator(".tholi-route-context")).toContainText(
      "3 verified steps",
    );
    await app.panel.screenshot({
      path: `output/qa/task-journey-${info.project.name}.png`,
      fullPage: true,
    });
  } finally {
    await app.close();
  }
});
test("a wrong native selection cannot complete the destination", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.context.route("http://localhost:5173/selection", (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<html lang="en"><label>Language<select><option>English</option><option>French</option><option>Spanish</option></select></label></html>',
      }),
    );
    await app.page.goto("http://localhost:5173/selection");
    await app.start();
    await setGoal(app, "Change language to Spanish");
    await next(app, "Language");
    await app.page
      .getByRole("combobox", { name: "Language" })
      .selectOption({ label: "French" });
    await expect.poll(async () => (await app.view()).status).toBe("waiting");
    expect((await app.view()).goalPlan.status).not.toBe("completed");
    await app.page
      .getByRole("combobox", { name: "Language" })
      .selectOption({ label: "Spanish" });
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
    expect(
      await app.page
        .getByRole("combobox")
        .evaluate((e: HTMLSelectElement) => e.selectedOptions[0].label),
    ).toBe("Spanish");
  } finally {
    await app.close();
  }
});
test("saved routes persist across browser restart and rebind after a website change", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  const original =
    '<html lang="en"><label>Color<select><option>Red</option><option>Blue</option></select></label></html>';
  try {
    await app.context.route("http://localhost:5173/saved", (r) =>
      r.fulfill({ contentType: "text/html; charset=utf-8", body: original }),
    );
    await app.page.goto("http://localhost:5173/saved");
    await app.start();
    const first = await setGoal(app, "Set color to Blue"),
      oldId = first.selectedControlId;
    await app.page.getByRole("combobox").selectOption({ label: "Blue" });
    await expect
      .poll(async () => (await app.view()).journey?.status)
      .toBe("completed");
    await expect
      .poll(async () =>
        app.panel.evaluate(
          async () =>
            (await chrome.runtime.sendMessage({ type: "GET_TASKS" })).tasks
              .length,
        ),
      )
      .toBe(1);
    await app.restart();
    await app.context.route("http://localhost:5173/saved", (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<html lang="en"><main><h1>Preferences</h1><fieldset><legend>Color</legend><label><input type="radio" name="c" checked>Red</label><label><input type="radio" name="c">Blue</label></fieldset></main></html>',
      }),
    );
    await app.page.goto("http://localhost:5173/saved");
    await app.start();
    await app.openDetails();
    const savedRoutes = app.panel.getByRole("button", {
      name: /^Saved routes/,
    });
    await expect(savedRoutes).toBeVisible();
    if ((await savedRoutes.getAttribute("aria-expanded")) !== "true")
      await savedRoutes.click();
    await app.page.bringToFront();
    await expect(
      app.panel.getByRole("button", {
        name: /^Set color to Blue\s+Reached before$/,
      }),
    ).toBeEnabled();
    await app.panel
      .getByRole("button", { name: /^Set color to Blue\s+Reached before$/ })
      .evaluate((e) => (e as HTMLButtonElement).click());
    // The UI submits asynchronously through a freshly restarted inference
    // worker. Wait for that submission before checking its selected target.
    await expect
      .poll(async () => (await app.view()).journey?.goal, { timeout: 15000 })
      .toBe("Set color to Blue");
    await next(app, "Color: Blue");
    expect((await app.view()).selectedControlId).not.toBe(oldId);
    expect((await app.view()).goalPlan.status).toBe("guiding");
    await app.page.getByRole("radio", { name: "Blue" }).check();
    await expect
      .poll(async () => (await app.view()).journey?.status)
      .toBe("completed");
    await app.panel
      .getByRole("button", { name: "Forget route: Set color to Blue" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    const deletion = app.panel.getByRole("alertdialog", {
      name: "Forget route?",
    });
    await expect(deletion).toBeVisible();
    expect(
      await app.panel.evaluate(
        async () =>
          (await chrome.runtime.sendMessage({ type: "GET_TASKS" })).tasks
            .length,
      ),
    ).toBe(1);
    await deletion
      .getByRole("button", { name: "Forget route", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect
      .poll(async () =>
        app.panel.evaluate(
          async () =>
            (await chrome.runtime.sendMessage({ type: "GET_TASKS" })).tasks
              .length,
        ),
      )
      .toBe(0);
  } finally {
    await app.close();
  }
});
test("retains the objective while a stale control is replaced and recalculates", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.context.route("http://localhost:5173/reroute", (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<html lang="en"><button aria-controls="menu" aria-expanded="false">Languages</button><div id="menu" hidden><a href="/es" hreflang="es">Español</a></div></html>',
      }),
    );
    await app.page.goto("http://localhost:5173/reroute");
    await app.start();
    const initial = await setGoal(app, "Change language to Spanish");
    await app.page.locator("button").evaluate((e) => {
      const replacement = e.cloneNode(true) as HTMLElement;
      replacement.textContent = "Choose languages";
      e.replaceWith(replacement);
    });
    await next(app, "Choose languages");
    const fresh = await app.view();
    expect(fresh.journey.id).toBe(initial.journey.id);
    expect(fresh.selectedControlId).not.toBe(initial.selectedControlId);
    expect(fresh.journey.progress).toHaveLength(0);
    expect(fresh.journey.objective.value).toBe("Spanish");
  } finally {
    await app.close();
  }
});
test("cross-origin destination requires continuation and then verifies the retained task", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.context.route("http://localhost:5173/handoff", (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<html lang="en"><div id="picker" role="dialog" aria-label="Languages"><a href="http://127.0.0.1:5173/spanish" hreflang="es">Español</a></div><script>document.querySelector("a").addEventListener("click", () => document.getElementById("picker").remove())</script></html>',
      }),
    );
    await app.context.route("http://127.0.0.1:5173/spanish", async (r) => {
      await new Promise((resolve) => setTimeout(resolve, 350));
      return r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<html lang="es"><h1>Destino español</h1></html>',
      });
    });
    await app.page.goto("http://localhost:5173/handoff");
    await app.start();
    const initial = await setGoal(app, "Change language to Spanish");
    await app.page.getByRole("link", { name: "Español" }).click();
    await expect
      .poll(async () => (await app.view()).continuationOrigin)
      .toBe("http://127.0.0.1:5173");
    expect((await app.view()).goalPlan.status).not.toBe("completed");
    await app.page.bringToFront();
    await expect(
      app.panel.getByRole("button", { name: "Continue task here" }),
    ).toBeEnabled();
    await app.panel
      .getByRole("button", { name: "Continue task here" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect
      .poll(async () => (await app.view()).journey?.status)
      .toBe("completed");
    const final = await app.view();
    expect(final.journey.id).toBe(initial.journey.id);
    expect(final.verifiedSteps).toBe(1);
    expect(final.page.language).toBe("es");
    // A redirected URL is not the clicked destination, even on an allowed host.
    await app.stop();
    await app.context.route("http://127.0.0.1:5173/spanish", (r) =>
      r.fulfill({ status: 302, headers: { location: "/wrong" } }),
    );
    await app.context.route("http://127.0.0.1:5173/wrong", (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: '<html lang="en"><h1>A different destination</h1></html>',
      }),
    );
    await app.page.goto("http://localhost:5173/handoff");
    await app.start();
    await setGoal(app, "Change language to Spanish");
    await app.page.getByRole("link", { name: "Español" }).click();
    await expect.poll(async () => (await app.view()).status).toBe("stopped");
    expect((await app.view()).continuationOrigin).toBeUndefined();
    expect((await app.view()).journey.status).toBe("active");
  } finally {
    await app.close();
  }
});
test("a linked popup retains task context through explicit tab continuation", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.context.route("http://localhost:5173/popup/**", (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: r.request().url().endsWith("/es")
          ? '<html lang="es"><h1>Destino</h1></html>'
          : '<html lang="en"><a target="_blank" href="/popup/es" hreflang="es">Español</a></html>',
      }),
    );
    await app.page.goto("http://localhost:5173/popup/start");
    await app.start();
    const initial = await setGoal(app, "Change language to Spanish");
    const popupPromise = app.context.waitForEvent("page");
    await app.page.getByRole("link", { name: "Español" }).click();
    const popup = await popupPromise;
    await popup.waitForLoadState("domcontentloaded");
    await popup.bringToFront();
    await expect
      .poll(async () => (await app.view()).continuationOrigin)
      .toBe("http://localhost:5173");
    await expect(
      app.panel.getByRole("button", { name: "Continue task here" }),
    ).toBeEnabled();
    await app.panel
      .getByRole("button", { name: "Continue task here" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect
      .poll(async () => (await app.view()).journey?.status)
      .toBe("completed");
    expect((await app.view()).journey.id).toBe(initial.journey.id);
    expect(await popup.evaluate(() => document.documentElement.lang)).toBe(
      "es",
    );
  } finally {
    await app.close();
  }
});
test("model follow-ups receive the original destination and verified progress after a dynamic menu", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.panel.addInitScript(() => {
      (globalThis as any).__taskInputs = [];
      Object.defineProperty(globalThis, "LanguageModel", {
        configurable: true,
        value: {
          availability: async () => "available",
          create: async () => ({
            destroy() {},
            clone: async () => ({
              destroy() {},
              prompt: async (raw: string) => {
                const input = JSON.parse(raw);
                (globalThis as any).__taskInputs.push(input);
                const control =
                  input.controls.find(
                    (c: any) => c.targetLanguage === "es" && c.visible,
                  ) || input.controls.find((c: any) => c.label === "Languages");
                return JSON.stringify({
                  controlIds: control ? [control.id] : [],
                  confidence: 0.9,
                  intent: {
                    target: control?.label || "Languages",
                    context: "",
                    scope: "any",
                    operation:
                      control?.kind === "navigation" ? "navigate" : "reveal",
                  },
                });
              },
            }),
          }),
        },
      });
    });
    await app.panel.reload();
    await app.context.route("http://localhost:5173/model-task/**", (r) =>
      r.fulfill({
        contentType: "text/html; charset=utf-8",
        body: r.request().url().endsWith("/es")
          ? '<html lang="es"><h1>Destino</h1></html>'
          : `<html lang="en"><button aria-controls="menu" aria-expanded="false">Languages</button><div id="menu" hidden></div><script>document.querySelector('button').addEventListener('click', function() { this.setAttribute('aria-expanded','true'); const menu=document.getElementById('menu'); menu.hidden=false; menu.innerHTML='<a href="/model-task/es" hreflang="es">Español</a>'; });</script></html>`,
      }),
    );
    await app.page.goto("http://localhost:5173/model-task/start");
    await app.start();
    await app.panel
      .getByText("Local site memory and AI", { exact: true })
      .evaluate((e) => (e as HTMLElement).click());
    await app.panel
      .getByRole("button", { name: "Enable on-device AI" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect(app.panel.getByLabel("Use on-device AI")).toBeChecked();
    const initial = await setGoal(app, "Change language to Spanish");
    await app.page
      .getByRole("button", { name: "Languages", exact: true })
      .click();
    await next(app, "Español");
    await expect
      .poll(async () =>
        app.panel.evaluate(() =>
          (globalThis as any).__taskInputs.some(
            (input: any) => input.task?.verifiedProgress.length === 1,
          ),
        ),
      )
      .toBe(true);
    const inputs = await app.panel.evaluate(
      () => (globalThis as any).__taskInputs,
    );
    const followup = inputs.find(
      (input: any) => input.task?.verifiedProgress.length === 1,
    );
    expect(followup).toMatchObject({
      goal: "Change language to Spanish",
      task: {
        id: initial.journey.id,
        verifiedProgress: [{ label: "Languages", kind: "expand" }],
      },
    });
    expect(followup.task).not.toHaveProperty("destination");
    expect(Object.keys(followup.task.verifiedProgress[0]).sort()).toEqual([
      "kind",
      "label",
    ]);
    await app.page.getByRole("link", { name: "Español" }).click();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
  } finally {
    await app.close();
  }
});

for (const arrival of [false, true])
  test(`an authenticated service proposal verifies a user step${arrival ? " and its independently observed destination" : " without inventing whole-task arrival"}`, async ({}, info) => {
    const fixture = await serviceJourney(
      info.project.use.viewport || undefined,
    );
    const { app, decisions, failures } = fixture;
    try {
      const initial = await setGoal(
        app,
        arrival ? "Turn Dark on" : "Find the amber compass",
      );
      if (arrival) {
        expect(initial.request.tasks[initial.request.active]).toMatchObject({
          target: "Dark",
          desiredValue: "on",
        });
        expect(initial.journey.objective).toMatchObject({
          purpose: "Dark",
          value: "on",
        });
      }
      if (!arrival) expect(initial.selectedControlId).toBeUndefined();
      await expect.poll(() => decisions.length).toBe(1);
      expect(JSON.stringify(decisions[0].input)).not.toContain("SENTINEL");
      expect(decisions[0].input.observation.native).toMatchObject({
        kind: "browser",
        documentId: expect.any(String),
      });
      decisions[0].release();
      await expect
        .poll(async () => (await app.view()).serviceNavigation?.state)
        .toBe("guiding");
      await next(app, "Dark");
      await expect(
        app.page.locator("#internet-navigator-overlay"),
      ).toBeVisible();
      const proposed = await app.view();
      expect(proposed.journey.id).toBe(initial.journey.id);
      expect(proposed.request.id).toBe(initial.request.id);
      expect(proposed.verifiedSteps).toBe(0);
      expect(proposed.journey.progress).toHaveLength(0);
      expect(decisions).toHaveLength(1);
      await expect(
        app.page.getByRole("checkbox", { name: "Dark", exact: true }),
      ).not.toBeChecked();
      await app.page
        .getByRole("checkbox", { name: "Dark", exact: true })
        .check();
      await expect.poll(async () => (await app.view()).verifiedSteps).toBe(1);
      if (arrival)
        await expect
          .poll(async () => (await app.view()).goalPlan?.status)
          .toBe("completed");
      const completed = await app.view();
      expect(completed.journey.id).toBe(initial.journey.id);
      expect(completed.verifiedSteps).toBe(1);
      expect(completed.request.status).toBe(arrival ? "completed" : "active");
      expect(completed.journey.status).toBe(arrival ? "completed" : "active");
      if (!arrival) expect(completed.goalPlan?.status).not.toBe("completed");
      expect(completed.liveDiagnostics.events).toContainEqual(
        expect.objectContaining({
          outcome: "verified",
          evidence: "checked-change",
        }),
      );
      // An unfinished destination may request a new proposal only after this
      // independently verified step; that is distinct from retrying inference.
      expect(decisions.length).toBeLessThanOrEqual(arrival ? 1 : 2);
      expect(failures).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

for (const interruption of [
  "Stop",
  "Pause",
  "replacement",
  "mutation",
] as const)
  test(`a delayed authenticated service proposal cannot undo ${interruption}`, async ({}, info) => {
    const fixture = await serviceJourney(
      info.project.use.viewport || undefined,
    );
    const { app, decisions, failures } = fixture;
    try {
      const initial = await setGoal(app, "Find the amber compass");
      await expect.poll(() => decisions.length).toBe(1);
      let replacement: any;
      let freshIndex = 1;
      if (interruption === "Stop") await app.stop();
      else if (interruption === "Pause")
        await app.panel.evaluate(() =>
          chrome.runtime.sendMessage({ type: "PAUSE" }),
        );
      else if (interruption === "replacement") {
        replacement = await setGoal(app, "Find the silver orchard");
        await expect.poll(() => decisions.length).toBe(2);
        expect(decisions[1].input.observation.stamp.requestId).toBe(
          replacement.request.id,
        );
        expect(replacement.request.id).not.toBe(initial.request.id);
      } else {
        await app.page
          .getByRole("checkbox", { name: "Dark", exact: true })
          .evaluate((element) => {
            const replacement = element.cloneNode() as HTMLInputElement;
            replacement.setAttribute("aria-label", "Unrelated replacement");
            element.replaceWith(replacement);
          });
        await expect
          .poll(async () => (await app.view()).page?.revision)
          .not.toBe(initial.page.revision);
      }
      // A new-context request stays held while the actual HTTP connection for
      // the obsolete generation is cancelled and its server work finishes.
      await expect.poll(() => decisions[0].disconnected).toBe(true);
      decisions[0].release();
      await expect.poll(() => decisions[0].finished).toBe(true);
      expect(decisions[0].sent).toBe(false);
      const after = await app.view();
      expect(after.verifiedSteps).toBe(0);
      expect(after.selectedControlId).toBeUndefined();
      await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
        0,
      );
      if (interruption === "replacement") {
        expect(after.request.id).toBe(replacement.request.id);
        expect(after.request.original).toBe("Find the silver orchard");
        expect(after.journey.id).toBe(replacement.journey.id);
      } else {
        expect(after.status).toBe(
          interruption === "Stop"
            ? "stopped"
            : interruption === "Pause"
              ? "paused"
              : "running",
        );
        if (interruption !== "mutation")
          expect(after.serviceNavigation).toBeUndefined();
      }
      if (interruption === "mutation") {
        const previousTarget = decisions[0].input.observation.controls.find(
          (control) => control.kind === "toggle",
        )!;
        expect(
          after.page.controls.some(
            (control: any) => control.id === previousTarget.reference.controlId,
          ),
        ).toBe(false);
        expect(after.request.original).toBe(initial.request.original);
        // Mutation invalidates the obsolete proposal; it does not promise an
        // automatic retry. Request fresh recovery through the normal user path.
        replacement = await setGoal(app, initial.request.original);
        expect(replacement.request.original).toBe(initial.request.original);
        const freshAttempt = () =>
          decisions.findIndex(
            (decision) =>
              decision.input.observation.stamp.contextGeneration >
                decisions[0].input.observation.stamp.contextGeneration &&
              decision.input.observation.stamp.scanGeneration >
                decisions[0].input.observation.stamp.scanGeneration &&
              decision.input.observation.stamp.requestId ===
                replacement.request.id,
          );
        await expect.poll(freshAttempt).toBeGreaterThan(0);
        freshIndex = freshAttempt();
        expect(decisions[freshIndex].input.requestId).not.toBe(
          decisions[0].input.requestId,
        );
        expect(decisions[freshIndex].input.observation.context.goal).toBe(
          initial.request.original,
        );
        expect(
          decisions[freshIndex].input.observation.controls.some(
            (control) =>
              control.reference.controlId ===
              previousTarget.reference.controlId,
          ),
        ).toBe(false);
        for (const prior of decisions.slice(0, freshIndex)) {
          await expect.poll(() => prior.disconnected).toBe(true);
          expect(prior.sent).toBe(false);
        }
      }
      if (interruption === "replacement" || interruption === "mutation") {
        const currentDecision = decisions[freshIndex];
        expect(currentDecision.sent).toBe(false);
        expect(currentDecision.finished).toBe(false);
        expect(currentDecision.input.observation.native.documentId).toBe(
          decisions[0].input.observation.native.documentId,
        );
        const freshTarget = currentDecision.input.observation.controls.find(
          (control) => control.kind === "toggle",
        )!;
        currentDecision.release();
        await expect
          .poll(async () => (await app.view()).selectedControlId)
          .toBe(freshTarget.reference.controlId);
        await expect(
          app.page.locator("#internet-navigator-overlay"),
        ).toBeVisible();
        // An ordinary passive observation must retain a valid current proposal.
        const refreshed = await app.panel.evaluate(() =>
          chrome.runtime.sendMessage({ type: "GET_PAGE" }),
        );
        expect(refreshed.error).toBeUndefined();
        const fresh = await app.view();
        expect(fresh.selectedControlId).toBe(freshTarget.reference.controlId);
        expect(fresh.request.id).toBe(
          currentDecision.input.observation.stamp.requestId,
        );
        expect(
          fresh.page.controls.find(
            (control: any) => control.id === fresh.selectedControlId,
          )?.label,
        ).toBe(interruption === "mutation" ? "Unrelated replacement" : "Dark");
        expect(fresh.verifiedSteps).toBe(0);
      }
      if (interruption === "mutation")
        expect(decisions.length).toBeLessThanOrEqual(3);
      else
        expect(decisions).toHaveLength(interruption === "replacement" ? 2 : 1);
      expect(failures).toEqual([]);
    } finally {
      await fixture.close();
    }
  });
