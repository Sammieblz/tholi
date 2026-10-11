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
  } finally {
    await app.close();
  }
});
