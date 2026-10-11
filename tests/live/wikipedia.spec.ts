import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
// URLs are test inputs only; the navigator has no article allowlist or Wikipedia selectors.
for (const article of [
  "Ada_Lovelace",
  "List_of_James_Bond_novels_and_short_stories",
]) {
  test("generic goals on live Wikipedia: " + article, async ({}, info) => {
    const app = await openNavigatorExtension(
      info.project.use.viewport || undefined,
    );
    const goal = async (text: string) => {
      await app.page.bringToFront();
      return app.panel.evaluate(async (goal) => {
        const context = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
        return chrome.runtime.sendMessage({
          type: "SET_GOAL",
          goal,
          revision: context.page.revision,
        });
      }, text);
    };
    try {
      await app.page.goto("https://en.wikipedia.org/wiki/" + article, {
        waitUntil: "networkidle",
      });
      await app.start();
      expect((await app.view()).routeId).toBe("navigator.live");
      const plan = await goal("make text larger");
      expect(plan.error).toBeUndefined();
      expect(plan.view.goalPlan.status).toBe("guiding");
      if (plan.view.goalPlan.steps.length > 1) {
        // The discovered ID is resolved in the isolated script; fixture/live test selectors
        // below perform only the user's action and never influence product discovery.
        await app.page
          .getByRole("button", { name: /Appearance/ })
          .first()
          .click();
      }
      await app.page.getByLabel("Large", { exact: true }).check();
      await expect
        .poll(async () => (await app.view()).goalPlan?.status)
        .toBe("completed");
      const references = await goal("find references");
      expect(references.view.goalPlan.status).toBe("guiding");
      const chosen = references.view.page.controls.find(
        (c: any) => c.id === references.view.selectedControlId,
      );
      if (chosen.role === "heading")
        await app.page.locator("#References").scrollIntoViewIfNeeded();
      else await app.page.locator('a[href="#References"]').first().click();
      await expect
        .poll(async () => (await app.view()).goalPlan?.status)
        .toBe("completed");
      await app.panel.screenshot({
        path: `output/qa/live-generic-${article}-${info.project.name}.png`,
      });
      const stored = await app.panel.evaluate(async () =>
        chrome.runtime.sendMessage({ type: "GET_MEMORY" }),
      );
      expect(stored.memory.pages.length).toBe(1);
    } finally {
      await app.close();
    }
  });
}
