import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
test("independent live Wikipedia oracle checks full English language and appearance requests", async () => {
  test.setTimeout(120000);
  const app = await openNavigatorExtension();
  try {
    await app.page.goto("https://en.wikipedia.org/wiki/Casino_Royale_(novel)", {
      waitUntil: "networkidle",
    });
    await app.start();
    const submit = async (goal: string) => {
      const r = await app.panel.evaluate(async (goal) => {
        const p = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
        return chrome.runtime.sendMessage({
          type: "SET_GOAL",
          goal,
          revision: p.page.revision,
        });
      }, goal);
      expect(r.error).toBeUndefined();
      return r.view;
    };
    const language = app.page
      .getByRole("button", { name: /\d+ languages/ })
      .filter({ visible: true })
      .first();
    expect(await language.count()).toBe(1);
    const v = await submit(
      "Could you show me how to change the language of this page, please?",
    );
    expect(
      v.page.controls.find((c: any) => c.id === v.selectedControlId)?.label,
    ).toMatch(/languages/i);
    expect(
      v.page.controls.find((c: any) => c.id === v.selectedControlId)?.label,
    ).not.toMatch(/Tools/);
    await language.click();
    await expect.poll(async () => (await app.view()).status).toBe("running");
    await submit("I want to change language to Spanish.");
    const spanish = app.page
      .locator('a[hreflang="es"]')
      .filter({ visible: true })
      .first();
    await expect(spanish).toBeVisible();
    const selected = await app.view();
    const target = selected.page.controls.find(
      (c: any) => c.id === selected.selectedControlId,
    );
    expect(target.targetLanguage?.split("-")[0]).toBe("es");
    expect(target.destination.origin).toBe("https://es.wikipedia.org");
    // Arrival has its own host-permission handoff tests. This independent oracle
    // checks the actual language link without granting or claiming completion.
    expect(selected.request.tasks[0].status).toBe("active");
  } finally {
    await app.close();
  }
});
