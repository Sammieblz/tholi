import { test, expect } from "../../support/browser-test";
import { openNavigatorExtension } from "../../support/navigator-extension";
import { setGoal } from "../../support/acceptance-runner";
import { inspectOverlay, aligned } from "../../support/overlay-inspection";

test("live Wikipedia geometry stays aligned through scroll, resize and browser zoom", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.page.goto("https://en.wikipedia.org/wiki/Casino_Royale_(novel)", {
      waitUntil: "domcontentloaded",
    });
    await app.start();
    const cdp = await app.context.newCDPSession(app.page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const guide = async () => {
      await setGoal(app, "Show languages");
      const view = await app.view();
      const control = view.page.controls.find(
        (c: any) => c.id === view.selectedControlId,
      );
      expect(control.label).toMatch(/languages/i);
      const button = app.page
        .getByRole("button", { name: control.label, exact: true })
        .filter({ visible: true });
      // Browser scroll anchoring can move the article after responsive reflow.
      // This is a user/test scroll; Navigator must never scroll it itself.
      await button.scrollIntoViewIfNeeded();
      await aligned(cdp, () => button.boundingBox());
      return button;
    };
    let button = await guide();
    const checkScrolledTarget = async () => {
      const r = await button.boundingBox();
      expect(r).not.toBeNull();
      const viewport = await app.page.evaluate(() => ({
        w: innerWidth,
        h: innerHeight,
      }));
      const direction =
        r!.y >= viewport.h
          ? "↓ Scroll down"
          : r!.y + r!.height <= 0
            ? "↑ Scroll up"
            : r!.x >= viewport.w
              ? "→ Scroll right"
              : r!.x + r!.width <= 0
                ? "← Scroll left"
                : undefined;
      if (direction) {
        await expect
          .poll(async () => (await inspectOverlay(cdp))?.arrow)
          .toBe(direction);
        expect((await inspectOverlay(cdp))?.halo).toBeUndefined();
      } else await aligned(cdp, () => button.boundingBox());
    };
    await app.page.evaluate(() => scrollTo(0, 100));
    await checkScrolledTarget();
    await app.page.evaluate(() => scrollTo(0, 0));
    // Live fundraising banners can place the article below the fold. At the
    // document top, an offscreen target requires a direction cue rather than a halo.
    await checkScrolledTarget();
    await app.page.setViewportSize({ width: 600, height: 900 });
    button = await guide();
    for (const factor of [0.8, 1.25, 2, 1]) {
      await app.page.bringToFront();
      await app.panel.evaluate(async (factor) => {
        const s = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
        await chrome.tabs.setZoom(s.tabId, factor);
      }, factor);
      button = await guide();
      const overlay = await inspectOverlay(cdp),
        r = (await button.boundingBox())!;
      expect(overlay!.tip!.left).toBeGreaterThanOrEqual(11);
      const viewport = await app.page.evaluate(() => ({
        w: innerWidth,
        h: innerHeight,
      }));
      expect(overlay!.tip!.right).toBeLessThanOrEqual(viewport.w - 11);
      expect(overlay!.tip!.bottom).toBeLessThanOrEqual(viewport.h - 11);
      expect(
        overlay!.tip!.bottom <= r.y ||
          overlay!.tip!.top >= r.y + r.height ||
          overlay!.tip!.right <= r.x ||
          overlay!.tip!.left >= r.x + r.width,
      ).toBe(true);
    }
    await app.page.emulateMedia({ reducedMotion: "reduce" });
    await aligned(cdp, () => button.boundingBox());
    await app.page.screenshot({
      path: `output/qa/wikipedia-geometry-${info.project.name}.png`,
    });
    expect((await app.view()).verifiedSteps).toBe(0);
    await app.stop();
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    await cdp.detach();
  } finally {
    await app.close();
  }
});
