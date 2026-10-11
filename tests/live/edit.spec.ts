import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
import { setGoal } from "../support/acceptance-runner";
import { aligned } from "../support/overlay-inspection";

test("an unqualified edit goal highlights the article toolbar rather than section edit links", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.page.goto("https://en.wikipedia.org/wiki/Casino_Royale_(novel)", {
      waitUntil: "networkidle",
    });
    await app.start();
    const cdp = await app.context.newCDPSession(app.page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    for (const goal of ["Edit", "How do I edit this page?"]) {
      const reply = await setGoal(app, goal);
      expect(reply.view.goalPlan.status).toBe("guiding");
      const selected = reply.view.page.controls.find(
        (c: any) => c.id === reply.view.selectedControlId,
      );
      expect(selected).toMatchObject({
        label: "Edit",
        kind: "navigation",
        risk: "ordinary",
      });
      expect(selected.scope).not.toBe("section");
      expect(reply.view.instruction).toContain("link to open its destination");
      expect(reply.view.instruction).not.toContain("menu");
      // Independent website oracle; no Wiki selector enters product code.
      const edit = app.page.locator("#ca-edit a");
      await expect(edit).toBeVisible();
      const expectedUrl = new URL(
        (await edit.getAttribute("href"))!,
        app.page.url(),
      );
      expect(expectedUrl.searchParams.get("action")).toBe("edit");
      expect(expectedUrl.searchParams.has("section")).toBe(false);
      const overlay = app.page.locator("#internet-navigator-overlay");
      await expect(overlay).toHaveCount(1);
      await edit.scrollIntoViewIfNeeded();
      await aligned(cdp, () => edit.boundingBox());
      expect(selected.description).toMatch(/edit this page/i);
    }
    // Section-specific goal uses the independently located section editor,
    // rather than the general article toolbar.
    const sectionEdit = app.page
      .locator(".mw-heading")
      .filter({ has: app.page.locator("#Plot") })
      .locator(".mw-editsection a")
      .first();
    await expect(sectionEdit).toHaveCount(1);
    await sectionEdit.scrollIntoViewIfNeeded();
    let lastRevision = -1;
    await expect
      .poll(async () => {
        const revision = await app.panel.evaluate(
          async () =>
            (await chrome.runtime.sendMessage({ type: "GET_PAGE" })).page
              .revision,
        );
        const stable = revision === lastRevision;
        lastRevision = revision;
        return stable;
      })
      .toBe(true);
    const sectionReply = await setGoal(app, "Edit Plot");
    expect(sectionReply.view.goalPlan.status).toBe("guiding");
    const sectionSelected = sectionReply.view.page.controls.find(
      (c: any) => c.id === sectionReply.view.selectedControlId,
    );
    expect(sectionSelected).toMatchObject({
      kind: "navigation",
      risk: "ordinary",
      scope: "section",
    });
    const sectionUrl = new URL(
      (await sectionEdit.getAttribute("href"))!,
      app.page.url(),
    );
    expect(sectionUrl.searchParams.has("section")).toBe(true);
    await aligned(cdp, () => sectionEdit.boundingBox());
    await app.page.screenshot({
      path: `output/qa/edit-highlight-${info.project.name}.png`,
    });
    await cdp.detach();
  } finally {
    await app.close();
  }
});
