import { test, expect } from "../../../support/browser-test";
import { openNavigatorExtension } from "../../../support/navigator-extension";
import { setGoal } from "../../../support/acceptance-runner";
import { openNavigationServiceFixture } from "../../../support/navigation-service-fixture";

test("connected processing announces pending, explicit recovery and Local privacy choices without claiming arrival", async ({}, info) => {
  const fixture = await openNavigationServiceFixture(
    info.project.use.viewport || undefined,
  );
  const { app, decisions, consentWrites } = fixture;
  try {
    const initial = await setGoal(app, "Find the amber compass");
    expect(initial.error).toBeUndefined();
    await expect.poll(() => decisions.length).toBe(1);
    const processing = app.panel.getByRole("status", {
      name: "Processing",
      exact: true,
    });
    await expect(processing).toHaveCount(1);
    await expect(processing).toHaveAttribute("aria-live", "polite");
    await expect(processing).toHaveAttribute("aria-atomic", "true");
    await expect(processing).toContainText(
      "Connected guidance is checking this page",
    );
    const original = await processing.elementHandle();
    await expect(
      app.panel.getByRole("button", { name: "Pause navigation", exact: true }),
    ).toBeEnabled();
    await expect(
      app.panel.getByRole("button", { name: "Stop", exact: true }),
    ).toBeEnabled();
    await app.panel.screenshot({
      path: info.outputPath("processing-pending-sidebar.png"),
    });
    decisions[0].release({ error: "UNAVAILABLE", status: 503 });
    await expect(processing).toContainText("Connected service is unavailable");
    expect((await app.view()).verifiedSteps).toBe(0);
    expect((await app.view()).request.status).toBe("active");
    expect(decisions).toHaveLength(1);
    await expect(app.panel.locator("body")).not.toContainText(
      "PRIVATE_SERVICE_BODY_SENTINEL",
    );
    // Keyboard interaction begins after the held HTTP response settles. The
    // separate headless panel tab is not native-sidebar focus evidence.
    await app.panel.evaluate(() =>
      (globalThis as any).__tholiSidebarTab.hold(),
    );
    await app.panel.bringToFront();
    const retry = app.panel.getByRole("button", {
      name: "Try again",
      exact: true,
    });
    await retry.focus();
    await app.panel.keyboard.press("Enter");
    await expect.poll(() => decisions.length).toBe(2);
    expect(decisions[1].input.requestId).not.toBe(decisions[0].input.requestId);
    expect(decisions[1].input.observation.context.goal).toBe(
      initial.view.request.original,
    );
    await expect(
      app.panel.getByLabel("Navigation goal", { exact: true }),
    ).toBeFocused();
    await expect(processing).toContainText(
      "Connected guidance is checking this page",
    );
    decisions[1].release({
      decision: {
        kind: "unsupported",
        reason: "No supported route is available in this fixture.",
      },
    });
    await expect(processing).toContainText(
      "Connected guidance cannot guide this page",
    );
    await expect(retry).toHaveCount(0);
    await expect(
      app.panel.getByRole("status", { name: "Navigation status", exact: true }),
    ).not.toContainText("Arrived");
    const conversation = app.panel.getByRole("button", {
      name: "Conversation",
      exact: true,
    });
    await conversation.focus();
    await app.panel.keyboard.press("Enter");
    await expect(processing).toBeVisible();
    expect(
      await processing.evaluate(
        (element, prior) => element === prior,
        original,
      ),
    ).toBe(true);
    const settings = app.panel.getByRole("button", {
      name: "Tholi settings",
      exact: true,
    });
    await settings.focus();
    await app.panel.keyboard.press("Enter");
    const local = app.panel.getByRole("radio", { name: "Local", exact: true });
    await expect(local).toBeVisible();
    await expect(
      app.panel.getByRole("radio", {
        name: "Connected development service",
        exact: true,
      }),
    ).toBeChecked();
    await local.focus();
    await app.panel.keyboard.press("Space");
    await expect(local).toBeChecked();
    await expect
      .poll(() =>
        consentWrites.some(
          (consent) =>
            consent.purpose === "cloud_inference" && !consent.granted,
        ),
      )
      .toBe(true);
    await expect(
      app.panel.getByRole("checkbox", {
        name: "Allow temporary masked images",
        exact: true,
      }),
    ).not.toBeChecked();
    await expect(
      app.panel.getByRole("checkbox", {
        name: "Allow temporary masked images",
        exact: true,
      }),
    ).toBeDisabled();
    await app.panel.keyboard.press("Escape");
    await expect(settings).toBeFocused();
    await setGoal(app, "Turn Dark on");
    await expect
      .poll(async () => (await app.view()).selectedControlId)
      .toBeTruthy();
    expect(decisions).toHaveLength(2);
    expect((await app.view()).verifiedSteps).toBe(0);
    await expect(processing).toBeHidden();
    expect(fixture.failures).toEqual([]);
  } finally {
    await fixture.close();
  }
});

for (const allowance of ["RATE_LIMITED", "QUOTA_EXCEEDED"] as const)
  test(`connected ${allowance} presentation preserves the destination and uses no client balance or automatic retry`, async ({}, info) => {
    const fixture = await openNavigationServiceFixture(
      info.project.use.viewport || undefined,
    );
    const { app, decisions } = fixture;
    try {
      await app.panel.setViewportSize({ width: 300, height: 800 });
      await app.panel.emulateMedia({ reducedMotion: "reduce" });
      if (allowance === "QUOTA_EXCEEDED")
        await app.page.evaluate(() => {
          document.body.style.background = "#111";
          document.body.style.color = "#fff";
        });
      await setGoal(app, "Find the amber compass");
      await expect.poll(() => decisions.length).toBe(1);
      await expect(app.panel.locator("html")).toHaveAttribute(
        "data-tholi-theme",
        allowance === "QUOTA_EXCEEDED" ? "light" : "dark",
      );
      decisions[0].release({ error: allowance, status: 429 });
      const processing = app.panel.getByRole("status", {
        name: "Processing",
        exact: true,
      });
      await expect(processing).toContainText(
        allowance === "RATE_LIMITED"
          ? "Connected service is busy"
          : "Connected service limit reached",
      );
      await expect(
        app.panel.getByRole("button", { name: "Try again", exact: true }),
      ).toHaveCount(allowance === "RATE_LIMITED" ? 1 : 0);
      await expect(processing).not.toContainText(
        /PRIVATE_SERVICE|checkout|\$|\d+\s+(?:credits|requests)\s+(?:left|remaining)/i,
      );
      const view = await app.view();
      expect(view.request.original).toBe("Find the amber compass");
      expect(view.request.status).toBe("active");
      expect(view.verifiedSteps).toBe(0);
      expect(view.goalPlan.status).not.toBe("completed");
      expect(decisions).toHaveLength(1);
      expect(
        await app.panel.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      expect(
        await processing.evaluate(
          (element) =>
            element
              .getAnimations({ subtree: true })
              .filter((animation) => animation.playState === "running").length,
        ),
      ).toBe(0);
      await app.panel.screenshot({
        path: info.outputPath(
          `processing-${allowance.toLowerCase()}-narrow.png`,
        ),
        animations: "disabled",
      });
      expect(fixture.failures).toEqual([]);
    } finally {
      await fixture.close();
    }
  });

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
    await app.panel.getByLabel("Navigation goal").fill("Show search");
    await app.page.bringToFront();
    await app.panel
      .getByRole("button", { name: "Guide me", exact: true })
      .press("Enter");
    await expect.poll(async () => (await app.view())?.status).toBe("running");
    // A native sidebar shares the website's active tab. Our separate test tab
    // needs real foreground focus while retaining that already observed context.
    await app.page.bringToFront();
    await app.panel.evaluate(() =>
      (globalThis as any).__tholiSidebarTab.hold(),
    );
    await app.panel.bringToFront();
    const status = app.panel.getByRole("status", { name: "Navigation status" });
    await expect(app.panel.getByLabel("Navigation goal")).toBeFocused();
    await expect(status).toContainText("Your next step.");
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
    await expect(status).toContainText("Arrived.");
    await expect(status).toContainText("1 verified control interactions");
    await setGoal(app, "Show languages");
    await app.page
      .getByRole("button", { name: "Languages", exact: true })
      .click();
    await expect(status).toContainText("Checking the website.");
    await expect(status).toContainText("One quick question.");
    await setGoal(app, "Missing feature");
    await expect(status).toContainText("Finding a way forward.");
    expect((await app.view()).request.status).not.toBe("completed");
    await setGoal(app, "Delete account");
    await expect(status).toContainText("Review this step.");
    await expect(status).toContainText("consequential");
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    await app.panel
      .getByRole("button", { name: "Pause navigation", exact: true })
      .focus();
    await app.panel.bringToFront();
    await app.panel.keyboard.press("Enter");
    await expect(status).toContainText("Paused.");
    await expect(
      app.panel.getByRole("button", { name: "Resume navigation", exact: true }),
    ).toBeFocused();
    await app.panel.bringToFront();
    await app.panel.keyboard.press("Enter");
    await expect(app.panel.getByLabel("Navigation goal")).toBeFocused();
    await app.panel.getByRole("button", { name: "Stop", exact: true }).focus();
    await app.panel.keyboard.press("Enter");
    await expect(status).toContainText("Stopped.");
    await expect(app.panel.getByLabel("Navigation goal")).toBeFocused();
    await app.panel.setViewportSize({ width: 300, height: 800 });
    const width = await app.panel.evaluate(() => ({
      scroll: document.documentElement.scrollWidth,
      client: document.documentElement.clientWidth,
    }));
    expect(width.scroll).toBeLessThanOrEqual(width.client);
    await app.panel.screenshot({
      path: `output/qa/accessible-panel-${info.project.name}.png`,
    });
    // Slow replies must not accumulate or overwrite newer panel state.
    await app.panel.evaluate(() => {
      const win = window as any;
      win.__polling = {
        GET_CONTEXT: { calls: 0, active: 0, max: 0 },
        GET_TASKS: { calls: 0, active: 0, max: 0 },
      };
      win.__slowReads = true;
      win.__restorePolling = () => {
        win.__slowReads = false;
      };
    });
    await expect
      .poll(
        () =>
          app.panel.evaluate(() => {
            const polling = (window as any).__polling;
            return (
              polling.GET_CONTEXT.calls >= 2 && polling.GET_TASKS.calls >= 2
            );
          }),
        { timeout: 9000 },
      )
      .toBe(true);
    const pending = await app.panel.evaluate(() => {
      const win = window as any;
      win.__restorePolling();
      return Object.values(win.__polling).map((c: any) => c.max);
    });
    expect(pending).toEqual([1, 1]);
    await expect(status).toContainText("Stopped.");
  } finally {
    await app.close();
  }
});
