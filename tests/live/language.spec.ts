import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";

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
      .poll(async () => (await app.view()).goalPlan?.status)
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
