import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";

test("widget conversation keeps summary, actions and composer visible while history scrolls", async ({}, info) => {
  const app = await openNavigatorExtension(undefined, [], false);
  try {
    await app.context.route("http://127.0.0.1:5173/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<html><body><button aria-expanded="false" aria-controls="menu">Account menu</button><nav id="menu" hidden><a href="/settings">Account settings</a></nav><main><h1>Workspace</h1></main></body></html>',
      }),
    );
    await app.page.goto("http://127.0.0.1:5173/widget-layout");
    await app.page.bringToFront();
    await app.panel.getByLabel("Navigation goal").fill("Account settings");
    await app.page.bringToFront();
    await app.panel
      .getByRole("button", { name: "Guide me", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect
      .poll(async () => (await app.view())?.selectedControlId)
      .toBeTruthy();
    const requestId = (await app.view()).request.id;
    await app.panel.evaluate(async () => {
      await chrome.storage.session.set({
        tholiConversation: Array.from({ length: 30 }, (_, i) => ({
          id: `history-${i}`,
          role: i % 2 ? "user" : "guide",
          text:
            `Earlier step ${i}. ` +
            "Describe your goal or choose a page control to highlight. ".repeat(
              12,
            ),
          at: Date.now() + i,
        })),
      });
      await chrome.runtime.sendMessage({
        type: "UI_SAVE",
        preferences: {
          surface: "widget",
          mode: "conversation",
          advanced: false,
        },
      });
    });
    await expect
      .poll(() =>
        app.page
          .frames()
          .find((frame) => frame.url().includes("/widget.html?grant="))
          ?.url(),
      )
      .toBeTruthy();
    const widget = app.page
      .frames()
      .find((frame) => frame.url().includes("/widget.html?grant="))!;
    await expect(
      widget.getByLabel("Conversation", { exact: true }),
    ).toContainText("Earlier step 29");
    const metrics = () =>
      widget.evaluate(() => {
        const root = document.querySelector<HTMLElement>(".tholi-app")!,
          body = document.querySelector<HTMLElement>(".tholi-body")!,
          header = document.querySelector<HTMLElement>(".tholi-header")!,
          summary = document.querySelector<HTMLElement>(
            ".tholi-journey-summary",
          )!,
          composer = document.querySelector<HTMLElement>(
            ".tholi-compose-dock",
          )!;
        return {
          documentTop: document.scrollingElement!.scrollTop,
          appTop: root.scrollTop,
          headerTop: header.getBoundingClientRect().top,
          summaryTop: summary.getBoundingClientRect().top,
          composerBottom: composer.getBoundingClientRect().bottom,
          viewport: innerHeight,
          bodyHeight: body.clientHeight,
          bodyScroll: body.scrollHeight,
          nestedHistoryScroll: getComputedStyle(
            document.querySelector(".tholi-messages")!,
          ).overflowY,
        };
      });
    await widget.getByLabel("Navigation goal").focus();
    const measured = await metrics();
    await info.attach("widget-layout", {
      body: JSON.stringify(measured),
      contentType: "application/json",
    });
    expect(measured.documentTop).toBe(0);
    expect(measured.appTop).toBe(0);
    expect(measured.headerTop).toBeGreaterThanOrEqual(0);
    expect(measured.summaryTop).toBeGreaterThanOrEqual(0);
    expect(measured.composerBottom).toBeLessThanOrEqual(measured.viewport);
    expect(measured.bodyHeight).toBeGreaterThan(40);
    expect(measured.nestedHistoryScroll).toBe("visible");
    await widget.evaluate(() => {
      document.querySelector(".tholi-body")!.scrollTop = 0;
    });
    await widget
      .getByRole("button", { name: "Pause navigation", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect.poll(async () => (await app.view()).status).toBe("paused");
    await expect(
      widget.getByRole("button", { name: "Resume navigation", exact: true }),
    ).toBeVisible();
    await expect(
      widget.getByRole("button", { name: "Journey summary and details" }),
    ).toContainText("Paused");
    await expect(widget.getByLabel("Navigation goal")).toBeVisible();
    await expect(
      widget.getByLabel("Conversation", { exact: true }),
    ).toContainText((await app.view()).instruction);
    await expect(
      widget.locator('.tholi-current[data-phase="review"]'),
    ).toHaveCount(0);
    expect((await app.view()).request.id).toBe(requestId);
    await app.page.screenshot({
      path: info.outputPath("widget-history-paused.png"),
      animations: "disabled",
    });
  } finally {
    await app.close();
  }
});

test("widget minimizes, dismisses its launcher and restores the same evolving task and draft", async ({}, info) => {
  const app = await openNavigatorExtension(undefined, [], false);
  try {
    await app.context.route("http://127.0.0.1:5173/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<html><body><button aria-expanded="false" aria-controls="menu" onclick="this.setAttribute(\'aria-expanded\',\'true\');document.getElementById(\'menu\').hidden=false">Account menu</button><nav id="menu" hidden><a href="/settings">Account settings</a></nav><main><h1>Workspace</h1></main></body></html>',
      }),
    );
    await app.page.goto("http://127.0.0.1:5173/widget-continuity");
    await app.page.bringToFront();
    await app.panel.getByLabel("Navigation goal").fill("Account settings");
    await app.page.bringToFront();
    await app.panel
      .getByRole("button", { name: "Guide me", exact: true })
      .evaluate((element) => (element as HTMLButtonElement).click());
    await expect
      .poll(async () => (await app.view())?.selectedControlId)
      .toBeTruthy();
    const original = await app.view();
    await app.panel.evaluate(async () => {
      await chrome.runtime.sendMessage({
        type: "UI_SAVE",
        draft: "My next destination",
        preferences: {
          surface: "widget",
          mode: "conversation",
          advanced: false,
        },
      });
    });
    const widgetFrame = () =>
      app.page
        .frames()
        .find((frame) => frame.url().includes("/widget.html?grant="));
    await expect.poll(() => widgetFrame()?.url()).toBeTruthy();
    await expect(widgetFrame()!.getByLabel("Navigation goal")).toHaveValue(
      "My next destination",
    );
    const cdp = await app.context.newCDPSession(app.page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width: 1400, height: 1000 },
    });
    await cdp.detach();
    await app.page.bringToFront();
    const bounds = (await app.page.locator("#tholi-widget").boundingBox())!;
    await app.page.mouse.click(bounds.x + bounds.width - 22, bounds.y + 14);
    await expect
      .poll(
        async () =>
          (await app.page.locator("#tholi-widget").boundingBox())?.width,
      )
      .toBe(44);
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    await expect
      .poll(
        async () =>
          (
            await app.panel.evaluate(
              async () => await chrome.runtime.sendMessage({ type: "UI_GET" }),
            )
          ).presentation?.visibility,
      )
      .toBe("launcher");
    expect((await app.view()).request.id).toBe(original.request.id);
    expect((await app.view()).status).toBe("running");
    await app.page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await expect
      .poll(async () => (await app.view()).verifiedSteps)
      .toBeGreaterThan(original.verifiedSteps);
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    const launcher = (await app.page.locator("#tholi-widget").boundingBox())!;
    await app.page.mouse.click(launcher.x + 22, launcher.y + 22);
    await expect.poll(() => widgetFrame()?.url()).toBeTruthy();
    await expect
      .poll(
        async () =>
          (await app.page.locator("#tholi-widget").boundingBox())?.width,
      )
      .toBeGreaterThan(44);
    await expect(widgetFrame()!.getByLabel("Navigation goal")).toHaveValue(
      "My next destination",
    );
    expect((await app.view()).request.id).toBe(original.request.id);
    await app.page.screenshot({
      path: info.outputPath("widget-restored-context.png"),
      animations: "disabled",
    });
    await app.panel.evaluate(
      async () => await chrome.runtime.sendMessage({ type: "UI_MINIMIZE" }),
    );
    await expect
      .poll(
        async () =>
          (await app.page.locator("#tholi-widget").boundingBox())?.width,
      )
      .toBe(44);
    await app.page
      .getByRole("link", { name: "Account settings", exact: true })
      .click();
    await app.page.waitForURL("**/settings");
    await expect
      .poll(
        async () =>
          (await app.page.locator("#tholi-widget").boundingBox())?.width,
      )
      .toBe(44);
    expect((await app.view()).request.id).toBe(original.request.id);
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    const nextLauncher = (await app.page
      .locator("#tholi-widget")
      .boundingBox())!;
    await app.page.mouse.dblclick(nextLauncher.x + 22, nextLauncher.y + 22);
    await expect(app.page.locator("#tholi-widget")).toHaveAttribute(
      "data-controls",
      "true",
    );
    expect(widgetFrame()).toBeUndefined();
    await app.page.screenshot({
      path: info.outputPath("launcher-remove-control.png"),
      animations: "disabled",
    });
    // Double-click focuses Remove inside the closed shadow root. Activate it
    // through the real keyboard instead of bypassing the isolated shell.
    await app.page.keyboard.press("Enter");
    await expect(app.page.locator("#tholi-widget")).toHaveCount(0);
    const surface = async () =>
      (
        await app.panel.evaluate(
          async () => await chrome.runtime.sendMessage({ type: "UI_GET" }),
        )
      ).presentation?.visibility;
    await expect.poll(surface).toBe("hidden");
    await app.page.reload();
    await expect.poll(surface).toBe("hidden");
    await expect(app.page.locator("#tholi-widget")).toHaveCount(0);
    expect((await app.view()).request.id).toBe(original.request.id);
    const restored = await app.panel.evaluate(
      async () => await chrome.runtime.sendMessage({ type: "UI_RESTORE" }),
    );
    expect(restored.ok).toBe(true);
    await expect.poll(() => widgetFrame()?.url()).toBeTruthy();
    await expect(widgetFrame()!.getByLabel("Navigation goal")).toHaveValue(
      "My next destination",
    );
    const preferences = await app.panel.evaluate(
      async () =>
        (await chrome.storage.local.get("tholiPreferences")).tholiPreferences,
    );
    const reset = await app.panel.evaluate(
      async () =>
        await chrome.runtime.sendMessage({ type: "UI_RESET_SESSION" }),
    );
    expect(reset.ok).toBe(true);
    await expect.poll(async () => (await app.view())?.request).toBeUndefined();
    await expect(app.page.locator("#tholi-widget")).toHaveCount(0);
    await expect(app.panel.getByLabel("Navigation goal")).toHaveValue("");
    const retained = await app.panel.evaluate(async () => ({
      local: (await chrome.storage.local.get("tholiPreferences"))
        .tholiPreferences,
      session: await chrome.storage.session.get([
        "tholiDraft",
        "tholiConversation",
        "tholiSurfacePresentation",
        "tholiSessionReset",
      ]),
    }));
    expect(retained.local).toEqual(preferences);
    expect(retained.session.tholiSurfacePresentation).toBeUndefined();
    expect(retained.session.tholiConversation || []).toEqual([]);
    expect(retained.session.tholiDraft || "").toBe("");
    expect(retained.session.tholiSessionReset).toBeTruthy();
  } finally {
    await app.close();
  }
});
