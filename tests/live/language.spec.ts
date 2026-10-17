import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";

// Read only the selected control's evidence during readiness polls.
function selectedTarget(
  app: Awaited<ReturnType<typeof openNavigatorExtension>>,
) {
  return app.panel.evaluate(async () => {
    const { view } = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
    const target = view.page?.controls.find(
      (control: any) => control.id === view.selectedControlId,
    );
    return {
      status: view.goalPlan?.status,
      signature: target?.signature,
      inViewport: target?.inViewport,
      targetLanguage: target?.targetLanguage,
    };
  });
}

test("one Spanish destination survives the language picker and destination-origin permission boundary", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.page.goto("https://en.wikipedia.org/wiki/Casino_Royale_(novel)", {
      waitUntil: "networkidle",
    });
    await app.start();
    const reply = await app.panel.evaluate(async () => {
      const current = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
      return chrome.runtime.sendMessage({
        type: "SET_GOAL",
        goal: "Change language to Spanish",
        revision: current.page.revision,
      });
    });
    expect(reply.error).toBeUndefined();
    const id = reply.view.journey.id;
    const opener = app.page.locator("#p-lang-btn").filter({ visible: true });
    const openerLabel = await opener.innerText();
    expect(reply.view.goalPlan.steps[0].label).toMatch(/languages/i);
    const selected = reply.view.page.controls.find(
      (control: any) => control.id === reply.view.selectedControlId,
    );
    await opener.scrollIntoViewIfNeeded();
    await expect
      .poll(() => selectedTarget(app))
      .toMatchObject({
        status: "guiding",
        signature: selected.signature,
        inViewport: true,
      });
    await opener.click();
    await expect
      .poll(async () => (await selectedTarget(app)).targetLanguage)
      .toBe("es");
    const intermediate = await app.view();
    expect(intermediate.goalPlan.goal).toBe("Change language to Spanish");
    expect(intermediate.journey.id).toBe(id);
    expect(intermediate.goalPlan.status).toBe("guiding");
    const spanish = app.page
      .locator('a[hreflang="es"]')
      .filter({ visible: true })
      .first();
    const href = await spanish.getAttribute("href");
    expect(new URL(href!, app.page.url()).hostname).toBe("es.wikipedia.org");
    await spanish.click();
    await app.page.waitForURL((url) => url.hostname === "es.wikipedia.org", {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(() => app.page.evaluate(() => document.documentElement.lang))
      .toBe("es");
    await expect
      .poll(async () => (await app.view()).continuationOrigin)
      .toBe("https://es.wikipedia.org");
    const handoff = await app.view();
    expect(handoff.journey.id).toBe(id);
    expect(handoff.journey.status).toBe("active");
    expect(handoff.goalPlan.status).not.toBe("completed");
    expect(handoff.verifiedSteps).toBe(1);
    await app.page.bringToFront();
    await expect(
      app.panel.getByRole("button", { name: "Continue task here" }),
    ).toBeEnabled();
    // Production optional host access is not expanded by the harness. The actual
    // Spanish document is independently verified; Chrome permission UI remains
    // a native handoff check, and Navigator cannot claim completion before it.
    const denied = await app.panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: "CONTINUE_TASK" }),
    );
    expect(denied.error).toContain("Allow access");
    expect(openerLabel).toMatch(/languages/i);
  } finally {
    await app.close();
  }
});

// This URL reproduces the reported bug. No fixture URL or selector enters product code.
test("change language highlights the live language selector, not the tools menu", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.page.goto("https://en.wikipedia.org/wiki/Casino_Royale_(novel)", {
      waitUntil: "networkidle",
    });
    await app.start();
    const reply = await app.panel.evaluate(async () => {
      const context = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
      return chrome.runtime.sendMessage({
        type: "SET_GOAL",
        goal: "Change language",
        revision: context.page.revision,
      });
    });
    expect(reply.error).toBeUndefined();
    expect(reply.view.goalPlan.status).toBe("guiding");
    expect(reply.view.goalPlan.steps).toHaveLength(1);
    const selected = reply.view.page.controls.find(
      (c: any) => c.id === reply.view.selectedControlId,
    );
    expect(selected.label).toMatch(/\blanguages\b/i);
    expect(selected.visible).toBe(true);
    expect(selected.kind).toBe("expand");
    expect(selected.description).toMatch(/another language/i);
    const language = app.page
      .getByRole("button", { name: selected.label, exact: true })
      .filter({ visible: true });
    // Fundraising banners can put the target below the viewport. Follow the
    // scroll instruction, then wait for fresh guidance before interacting.
    await language.scrollIntoViewIfNeeded();
    await expect
      .poll(() => selectedTarget(app))
      .toMatchObject({
        status: "guiding",
        signature: selected.signature,
        inViewport: true,
      });
    const bounds = await language.boundingBox();
    expect(bounds).not.toBeNull();
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      1,
    );
    await app.page.screenshot({
      path: `output/qa/language-highlight-${info.project.name}.png`,
    });
    await language.click();
    await expect
      .poll(async () => (await selectedTarget(app)).status)
      .toBe("awaiting-choice");
    expect((await app.view()).verifiedSteps).toBe(1);
    // Opening a picker is a verified intermediate step, not a completed language change.
    expect((await app.view()).goalPlan.reason).toContain("Choose an option");
    await app.panel.screenshot({
      path: `output/qa/language-panel-${info.project.name}.png`,
    });
    const next = await app.panel.evaluate(async () => {
      const context = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
      return chrome.runtime.sendMessage({
        type: "SET_GOAL",
        goal: "Français",
        revision: context.page.revision,
      });
    });
    expect(next.view.goalPlan.status).toBe("guiding");
    expect(next.view.goalPlan.steps).toHaveLength(1);
    const choice = next.view.page.controls.find(
      (c: any) => c.id === next.view.selectedControlId,
    );
    expect(choice.label).toBe("Français");
    expect(choice.kind).toBe("navigation");
    const french = app.page
      .getByRole("link", { name: "Français", exact: true })
      .filter({ visible: true })
      .first();
    const destination = await french.getAttribute("href");
    expect(new URL(destination!, app.page.url()).hostname).toBe(
      "fr.wikipedia.org",
    );
    await french.click();
    await app.page.waitForURL((url) => url.hostname === "fr.wikipedia.org", {
      waitUntil: "domcontentloaded",
    });
    await expect
      .poll(() => app.page.evaluate(() => document.documentElement.lang))
      .toBe("fr");
    await expect
      .poll(async () => (await app.view()).status, { timeout: 10000 })
      .toBe("stopped");
    expect((await app.view()).instruction).toContain("another website");
    expect((await app.view()).verifiedSteps).toBe(1);
    expect((await app.view()).goalPlan?.status).not.toBe("completed");
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    // The independently checked destination is not reported as a verified goal:
    // this new origin needs an explicit toolbar invocation and fresh Start.
  } finally {
    await app.close();
  }
});
