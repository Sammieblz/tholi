import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";
import { setGoal } from "../support/acceptance-runner";
test("panel exposes distinct status announcements, stable polling and usable keyboard controls", async ({}, info) => {
  const app = await openNavigatorExtension(
    info.project.use.viewport || undefined,
  );
  try {
    await app.context.route("http://localhost:5173/accessibility", (r) =>
      r.fulfill({
        contentType: "text/html",
        body: '<html><body><input type="search" aria-label="Search catalogue"><button aria-expanded="false" aria-controls="languages">Languages</button><div id="languages" hidden><button>French</button></div><button>Delete account</button><script>document.querySelector("button").onclick=e=>{const button=e.currentTarget;setTimeout(()=>{button.setAttribute("aria-expanded","true");document.querySelector("#languages").hidden=false},1200)}</script></body></html>',
      }),
    );
    await app.page.goto("http://localhost:5173/accessibility");
    await app.page.bringToFront();
    await expect(
      app.panel.getByRole("combobox", { name: "Choose a task" }),
    ).toBeEnabled();
    await app.panel
      .getByRole("combobox", { name: "Choose a task" })
      .selectOption("navigator.live");
    await app.page.bringToFront();
    await app.panel
      .getByRole("button", { name: "Start navigation", exact: true })
      .press("Enter");
    await expect.poll(async () => (await app.view())?.status).toBe("running");
    const status = app.panel.getByRole("status", { name: "Navigation status" });
    await expect(app.panel.getByLabel("Navigation goal")).toBeFocused();
    await app.panel.getByLabel("Navigation goal").fill("Show search");
    await app.page.bringToFront();
    await app.panel.getByLabel("Navigation goal").press("Enter");
    await expect(status).toContainText("Guiding.");
    const text = await status.textContent();
    // Polling/geometry-only updates must not rewrite the live announcement.
    await app.panel.evaluate(() => {
      (window as any).__announcements = 0;
      new MutationObserver(() => {
        (window as any).__announcements++;
      }).observe(document.querySelector('[aria-label="Navigation status"]')!, {
        childList: true,
        subtree: true,
        characterData: true,
      });
    });
    await app.page.evaluate(() => {
      window.dispatchEvent(new Event("resize"));
    });
    await expect
      .poll(async () => (await app.view()).selectedControlId)
      .toBeTruthy();
    await app.panel.waitForTimeout(1100);
    expect(await status.textContent()).toBe(text);
    expect(
      await app.panel.evaluate(() => (window as any).__announcements),
    ).toBe(0);
    await app.page.getByRole("searchbox").click();
    await expect(status).toContainText("Goal verified.");
    await expect(status).toContainText("1 verified control interactions");
    await setGoal(app, "Show languages");
    await app.page
      .getByRole("button", { name: "Languages", exact: true })
      .click();
    await expect(status).toContainText("Waiting for the website.");
    await expect(status).toContainText("Choose an option.");
    await setGoal(app, "Missing feature");
    await expect(status).toContainText("No clear route found.");
    await setGoal(app, "Delete account");
    await expect(status).toContainText("Review required.");
    await expect(status).toContainText("consequential");
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    await app.panel
      .getByRole("button", { name: "Pause navigation", exact: true })
      .focus();
    await app.page.bringToFront();
    await app.panel.keyboard.press("Enter");
    await expect(status).toContainText("paused.");
    await expect(
      app.panel.getByRole("button", { name: "Resume navigation", exact: true }),
    ).toBeFocused();
    await app.page.bringToFront();
    await app.panel.keyboard.press("Enter");
    await expect(app.panel.getByLabel("Navigation goal")).toBeFocused();
    await app.panel.getByRole("button", { name: "Stop", exact: true }).focus();
    await app.panel.keyboard.press("Enter");
    await expect(status).toContainText("stopped.");
    await expect(
      app.panel.getByRole("button", { name: "Start navigation", exact: true }),
    ).toBeFocused();
    await app.panel.setViewportSize({ width: 300, height: 800 });
    const width = await app.panel.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client);
    await app.panel.screenshot({
      path: `output/qa/accessible-panel-${info.project.name}.png`,
    });
  } finally {
    await app.close();
  }
});
