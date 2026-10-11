import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
import { setGoal } from "../support/acceptance-runner";
import { inspectOverlay, aligned } from "../support/overlay-inspection";
test("passive overlay follows geometry, all four edges, browser zoom and reduced motion", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.context.route("http://localhost:5173/geometry", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<html><body style="margin:0;height:3200px"><button id="move" style="position:fixed;left:120px;top:140px;width:140px;height:40px">Help</button><script>window.clicks=0;document.querySelector("button").onclick=()=>window.clicks++</script></body></html>',
      }),
    );
    await app.page.goto("http://localhost:5173/geometry");
    await app.start();
    await setGoal(app, "Help");
    const cdp = await app.context.newCDPSession(app.page);
    await cdp.send("DOM.enable");
    await cdp.send("CSS.enable");
    const button = app.page.getByRole("button", { name: "Help", exact: true });
    await aligned(cdp, () => button.boundingBox());
    const overlay = await inspectOverlay(cdp),
      r = (await button.boundingBox())!;
    expect(overlay?.pointerEvents).toBe("none");
    expect(overlay?.ariaHidden).toBe("true");
    expect(await app.page.evaluate(() => (window as any).clicks)).toBe(0);
    expect(
      overlay!.tip!.bottom <= r.y ||
        overlay!.tip!.top >= r.y + r.height ||
        overlay!.tip!.right <= r.x ||
        overlay!.tip!.left >= r.x + r.width,
    ).toBe(true);
    await button.evaluate((e) => {
      e.style.transition = "transform .6s linear";
      e.style.transform = "translate(180px, 110px)";
    });
    await expect
      .poll(async () => (await button.boundingBox())?.x)
      .toBeCloseTo(300, 0);
    await aligned(cdp, () => button.boundingBox());
    await button.evaluate((e) => {
      e.style.transition = "none";
      e.style.transform = "none";
    });
    const edges = [
      ["down", { top: 1500, left: 120 }],
      ["up", { top: -150, left: 120 }],
      ["right", { top: 140, left: 1800 }],
      ["left", { top: 140, left: -300 }],
    ] as const;
    for (const [direction, pos] of edges) {
      await button.evaluate((e, pos) => {
        e.style.top = pos.top + "px";
        e.style.left = pos.left + "px";
      }, pos);
      await expect
        .poll(async () => (await inspectOverlay(cdp))?.arrow)
        .toContain("Scroll " + direction);
      expect(
        await app.page.evaluate(() => ({ x: scrollX, y: scrollY })),
      ).toEqual({ x: 0, y: 0 });
    }
    await button.evaluate((e) => {
      e.style.position = "absolute";
      e.style.left = "120px";
      e.style.top = "1500px";
    });
    await app.page.evaluate(() => scrollTo(0, 1400));
    await aligned(cdp, () => button.boundingBox());
    await app.page.setViewportSize({ width: 600, height: 700 });
    await aligned(cdp, () => button.boundingBox());
    for (const factor of [0.8, 1.25, 2, 1]) {
      await app.page.bringToFront();
      await app.panel.evaluate(async (factor) => {
        const s = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
        await chrome.tabs.setZoom(s.tabId, factor);
      }, factor);
      await aligned(cdp, () => button.boundingBox());
    }
    await app.page.emulateMedia({ reducedMotion: "reduce" });
    await aligned(cdp, () => button.boundingBox());
    await app.page.keyboard.press("Tab");
    await expect(button).toBeFocused();
    await app.page.keyboard.press("Enter");
    expect(await app.page.evaluate(() => (window as any).clicks)).toBe(1);
    expect((await app.view()).verifiedSteps).toBe(0);
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    await setGoal(app, "Help");
    await app.page.evaluate(() => scrollTo(0, 0));
    await button.evaluate((e) => {
      e.style.top = "650px";
    });
    await aligned(cdp, () => button.boundingBox());
    const bottom = await inspectOverlay(cdp);
    expect(bottom!.tip!.bottom).toBeLessThanOrEqual(688);
    await app.page.screenshot({
      path: `output/qa/overlay-geometry-${info.project.name}.png`,
    });
    await app.stop();
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    await cdp.detach();
  } finally {
    await app.close();
  }
});
