import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
type App = Awaited<ReturnType<typeof openNavigatorExtension>>;
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
    await expect(
      app.panel.getByRole("region", { name: "Task journey" }),
    ).toContainText("3 verified steps");
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
    const savedRoutes = app.panel
      .locator("summary")
      .filter({ hasText: /^Saved routes$/ });
    await expect(savedRoutes).toBeVisible();
    if (
      !(await savedRoutes.evaluate((e) =>
        e.parentElement?.hasAttribute("open"),
      ))
    )
      await savedRoutes.click();
    await app.page.bringToFront();
    await expect(
      app.panel.getByRole("button", {
        name: "Set color to Blue · Reached before",
      }),
    ).toBeEnabled();
    await app.panel
      .getByRole("button", { name: "Set color to Blue · Reached before" })
      .evaluate((e) => (e as HTMLButtonElement).click());
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
        destination: { value: "Spanish", language: "es" },
        verifiedProgress: [{ label: "Languages", kind: "expand" }],
      },
    });
    await app.page.getByRole("link", { name: "Español" }).click();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
  } finally {
    await app.close();
  }
});
