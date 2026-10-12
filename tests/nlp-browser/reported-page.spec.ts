import { test, expect } from "@playwright/test";
import { writeFile, mkdir } from "node:fs/promises";
import { openNavigatorExtension } from "../support/navigator-extension";
import { inspectOverlay, aligned } from "../support/overlay-inspection";

for (const width of [1420, 720]) {
  test(
    "reported DreamWorks references and privacy requests at width " + width,
    async () => {
      test.setTimeout(180000);
      const app = await openNavigatorExtension({ width, height: 920 });
      try {
        await app.page.goto(
          "https://en.wikipedia.org/wiki/DreamWorks_Pictures",
          { waitUntil: "networkidle" },
        );
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
        await expect
          .poll(async () => (await inspectOverlay(cdp))?.arrow)
          .toContain("Scroll up");
        expect((await inspectOverlay(cdp))?.halo).toBeUndefined();
        const references = app.page.getByRole("heading", {
          name: "References",
          exact: true,
        });
        await references.scrollIntoViewIfNeeded();
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
    },
  );
}

test("missing sections and clipped fragment links are rejected on a generic website", async () => {
  const app = await openNavigatorExtension();
  try {
    await app.context.route("http://localhost:5173/reported-fixture", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<html><body><h1>Catalogue</h1><nav style="position:fixed;top:40px;left:20px;height:45px;width:160px;overflow:auto"><div style="height:600px"></div><a href="#references">References</a></nav><main><h2>History</h2><div style="height:1400px"></div></main><div role="contentinfo"><span id="references"></span><a href="/privacy">Privacy policy</a></div></body></html>',
      }),
    );
    await app.page.goto("http://localhost:5173/reported-fixture");
    await app.page.evaluate(() =>
      scrollTo(0, document.documentElement.scrollHeight),
    );
    await app.start();
    const submit = (goal: string) =>
      app.panel.evaluate(async (goal) => {
        const p = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
        return chrome.runtime.sendMessage({
          type: "SET_GOAL",
          goal,
          revision: p.page.revision,
        });
      }, goal);
    const missing = await submit("Help me find references");
    expect(missing.error).toBeUndefined();
    expect(missing.view.selectedControlId).toBeUndefined();
    expect(missing.view.goalPlan.status).toBe("unresolved");
    expect(missing.view.goalPlan.steps).toEqual([]);
    const r = await submit("Please show me the privacy policy");
    expect(r.error).toBeUndefined();
    expect(
      r.view.page.controls.find((c: any) => c.id === r.view.selectedControlId)
        ?.label,
    ).toBe("Privacy policy");
  } finally {
    await app.close();
  }
});
