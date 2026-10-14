import { test, expect } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";

test("widget history and focus cannot scroll its header or current guidance away", async ({}, info) => {
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
          current = document.querySelector<HTMLElement>(".tholi-current")!;
        return {
          documentTop: document.scrollingElement!.scrollTop,
          appTop: root.scrollTop,
          headerTop: header.getBoundingClientRect().top,
          currentTop: current.getBoundingClientRect().top,
          currentBottom: current.getBoundingClientRect().bottom,
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
    expect(measured.currentTop).toBeGreaterThanOrEqual(0);
    expect(measured.currentBottom).toBeLessThanOrEqual(measured.viewport);
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
    await expect(widget.getByLabel("Current guidance")).toContainText("Paused");
    await expect
      .poll(() =>
        widget.evaluate(
          () =>
            document
              .querySelector(".tholi-instruction")!
              .getBoundingClientRect().bottom -
            document
              .querySelector(".tholi-step-content")!
              .getBoundingClientRect().bottom,
        ),
      )
      .toBeLessThanOrEqual(1);
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
