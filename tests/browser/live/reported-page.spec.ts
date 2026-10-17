import { test, expect } from "../../support/browser-test";
import { writeFile, mkdir } from "node:fs/promises";
import { openNavigatorExtension } from "../../support/navigator-extension";
import { aligned } from "../../support/overlay-inspection";

test("reported DreamWorks references and privacy requests", async ({}, info) => {
  // Preserve the reported reproduction dimensions; project ownership selects
  // each width once instead of nesting a second viewport matrix.
  const width = info.project.name.endsWith("narrow") ? 720 : 1420;
  test.setTimeout(180000);
  const app = await openNavigatorExtension({ width, height: 920 });
  try {
    await app.page.goto("https://en.wikipedia.org/wiki/DreamWorks_Pictures", {
      waitUntil: "networkidle",
    });
    await app.page.evaluate(() =>
      scrollTo(0, document.documentElement.scrollHeight),
    );
    // Different font/viewport settings can expose this TOC entry. Recreate
    // the reported clipped-sidebar condition on the actual live fragment.
    await app.page
      .getByRole("link", {
        name: "7 References",
        exact: true,
        includeHidden: true,
      })
      .first()
      .evaluate((element) => {
        const link = element as HTMLElement;
        const parent = link.parentElement!;
        parent.style.height = "12px";
        parent.style.overflow = "hidden";
        link.style.display = "block";
        link.style.transform = "translateY(80px)";
      });
    await app.start();
    const submit = async (goal: string) => {
      const response = await app.panel.evaluate(async (goal) => {
        const p = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
        return chrome.runtime.sendMessage({
          type: "SET_GOAL",
          goal,
          revision: p.page.revision,
        });
      }, goal);
      expect(response.error).toBeUndefined();
      expect(response.view.request.original).toBe(goal);
      expect(response.view.embeddingActivity.llmCalls).toBe(0);
      return response.view;
    };
    const cdp = await app.context.newCDPSession(app.page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const v = await submit("Help me find references");
    const target = v.page.controls.find(
      (c: any) => c.id === v.selectedControlId,
    );
    expect(target).toMatchObject({
      role: "heading",
      kind: "section",
      label: "References",
      enabled: true,
    });
    expect(v.goalPlan.status).toBe("guiding");
    expect(v.page.partial).toBe(true);
    const references = app.page.getByRole("heading", {
      name: "References",
      exact: true,
    });
    // Navigator now scrolls freshly bound destinations automatically.
    await expect(references).toBeInViewport();
    await expect
      .poll(async () => (await app.view()).goalPlan.status)
      .toBe("completed");
    await expect(references).toBeInViewport();
    await app.page.evaluate(() =>
      scrollTo(0, document.documentElement.scrollHeight),
    );
    const p = await submit("Could you show me the privacy policy?");
    const privacy = p.page.controls.find(
      (c: any) => c.id === p.selectedControlId,
    );
    expect(privacy).toMatchObject({
      role: "link",
      kind: "navigation",
      enabled: true,
      visible: true,
    });
    expect(privacy.label).toMatch(/^Privacy policy$/i);
    expect(
      privacy.structure.regions.some((r: any) => r.role === "contentinfo"),
    ).toBe(true);
    const actual = app.page
      .locator("footer,[role=contentinfo]")
      .getByRole("link", { name: privacy.label, exact: true })
      .first();
    await expect(actual).toBeInViewport();
    const destination = new URL(
      (await actual.getAttribute("href"))!,
      app.page.url(),
    );
    expect(privacy.destination).toMatchObject({
      origin: destination.origin,
      path: destination.pathname,
    });
    await aligned(cdp, () => actual.boundingBox());
    // Existing knowledge/embeddings cannot substitute for a removed section.
    await references.evaluate((e) => e.remove());
    const absent = await submit("Help me find references");
    expect(absent.selectedControlId).toBeUndefined();
    expect(absent.goalPlan.status).toBe("unresolved");
    expect(absent.goalPlan.steps).toEqual([]);
    expect(absent.request.tasks[0].status).not.toBe("completed");
    await mkdir("output/nlp", { recursive: true });
    await writeFile(
      "output/nlp/dreamworks-after-" + width + ".json",
      JSON.stringify(
        {
          width,
          reference: target,
          privacy,
          absent: absent.goalPlan,
          activity: p.embeddingActivity,
        },
        null,
        2,
      ),
    );
  } finally {
    await app.close();
  }
});
