import { test, expect } from "../../../support/browser-test";
import { openNavigatorExtension } from "../../../support/navigator-extension";

async function goal(
  app: Awaited<ReturnType<typeof openNavigatorExtension>>,
  text: string,
) {
  await app.page.bringToFront();
  await app.panel.getByRole("textbox", { name: "Navigation goal" }).fill(text);
  await app.page.bringToFront();
  await expect(
    app.panel.getByRole("button", { name: "Guide me", exact: true }),
  ).toBeEnabled();
  await app.panel
    .getByRole("button", { name: "Guide me", exact: true })
    .evaluate((e) => (e as HTMLButtonElement).click());
  await expect
    .poll(async () => (await app.view()).goalPlan)
    .toMatchObject({
      goal: text,
      status: "guiding",
    });
}
test("heading hierarchy resolves repeated section controls and refreshes local site context", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.context.route("http://localhost:5173/context/**", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<main aria-label="Research"><h1>Paper</h1><section><h2>Methods</h2><section><h3 id="section-name">Participants</h3><nav aria-label="Actions"><a href="/context/edit">Edit</a></nav></section></section><section><h2>Findings</h2><nav aria-label="Actions"><a href="/context/findings/edit">Edit</a></nav></section></main>',
      }),
    );
    await app.page.goto("http://localhost:5173/context/paper");
    await app.start();
    await goal(app, "Edit Methods Participants");
    let view = await app.view();
    expect(
      view.page.controls.find((c: any) => c.id === view.selectedControlId)
        ?.destination.path,
    ).toBe("/context/edit");
    await app.page
      .locator("#section-name")
      .evaluate((e) => (e.textContent = "Recruitment"));
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("unresolved");
    await goal(app, "Edit Methods Recruitment");
    view = await app.view();
    expect(
      view.page.controls
        .find((c: any) => c.id === view.selectedControlId)
        ?.structure.headings.map((h: any) => h.label),
    ).toEqual(["Paper", "Methods", "Recruitment"]);
    expect(view.goalPlan.status).toBe("guiding");
  } finally {
    await app.close();
  }
});
test("structured model intent survives a rerendered owned menu while invalid AI falls back to live matching", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    // Adapter contract test with a deterministic fake. This does not measure
    // Gemini Nano's ability to interpret the goals.
    await app.panel.addInitScript(() => {
      (globalThis as any).__modelInputs = [];
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
                (globalThis as any).__modelInputs.push(input);
                if (input.goal === "Read in French")
                  return JSON.stringify({
                    controlIds: [
                      input.controls.find(
                        (c: any) => c.label === "Translations",
                      ).id,
                      input.controls.find((c: any) => c.label === "French").id,
                    ],
                    confidence: 0.9,
                    intent: {
                      target: "French",
                      context: "",
                      scope: "any",
                      operation: "navigate",
                    },
                  });
                return JSON.stringify({
                  controlIds: ["w0000000000000000-999"],
                  confidence: 1,
                  intent: {
                    target: "Edit",
                    context: "",
                    scope: "page",
                    operation: "navigate",
                  },
                });
              },
            }),
          }),
        },
      });
    });
    await app.panel.reload();
    await app.context.route("http://localhost:5173/intent/**", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: r.request().url().endsWith("/french")
          ? "<h1>French destination</h1>"
          : `<nav aria-label="Article"><a href="/intent/edit">Edit</a></nav><button aria-controls="translations" aria-expanded="false">Translations</button><div id="translations" hidden><a href="/intent/french">French</a></div><script>
          document.querySelector('button').addEventListener('click', function() {
            this.setAttribute('aria-expanded','true');
            const panel = document.getElementById('translations');
            panel.hidden = false;
            const link = document.createElement('a');
            link.href = '/intent/french'; link.textContent = 'French';
            panel.replaceChildren(link);
          });
          </script>`,
      }),
    );
    await app.page.goto("http://localhost:5173/intent/start");
    await app.start();
    await app.panel
      .getByText("Local site memory and AI", { exact: true })
      .evaluate((e) => (e as HTMLElement).click());
    await app.panel
      .getByRole("button", { name: "Enable on-device AI" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect(app.panel.getByLabel("Use on-device AI")).toBeChecked();
    await goal(app, "Edit");
    expect((await app.view()).goalPlan).toMatchObject({
      status: "guiding",
      source: "semantics",
    });
    await goal(app, "Read in French");
    const before = await app.view();
    expect(before.goalPlan).toMatchObject({
      status: "guiding",
      source: "on-device",
      interpretation: { target: "French" },
    });
    expect(before.goalPlan.steps.map((s: any) => s.label)).toEqual([
      "Translations",
      "French",
    ]);
    const originalFrench = before.goalPlan.steps[1].controlId;
    await app.page
      .getByRole("button", { name: "Translations", exact: true })
      .click();
    await expect
      .poll(async () => (await app.view()).goalPlan?.steps[0]?.label)
      .toBe("French");
    const fresh = await app.view();
    expect(fresh.selectedControlId).not.toBe(originalFrench);
    await app.page.getByRole("link", { name: "French", exact: true }).click();
    await expect
      .poll(async () => (await app.view()).goalPlan?.status)
      .toBe("completed");
    expect(new URL(app.page.url()).pathname).toBe("/intent/french");
    const inputs = await app.panel.evaluate(
      () => (globalThis as any).__modelInputs,
    );
    expect(
      inputs
        .find(
          (input: any) =>
            input.goal === "Read in French" &&
            input.controls.some((c: any) => c.label === "French" && !c.visible),
        )
        .controls.find((c: any) => c.label === "French"),
    ).toMatchObject({
      visible: false,
      revealIds: [before.goalPlan.steps[0].controlId],
    });
  } finally {
    await app.close();
  }
});
