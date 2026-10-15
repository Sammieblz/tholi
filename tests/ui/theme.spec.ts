import { expect, test } from "@playwright/test";
import { openNavigatorExtension } from "../support/navigator-extension";

test("page contrast follows visible surfaces, changes, documents and tabs across sidebar and widget", async ({}, info) => {
  test.setTimeout(75000);
  const app = await openNavigatorExtension(undefined, [], false);
  const url = "http://127.0.0.1:5173/theme-fixture";
  try {
    // The OS theme deliberately disagrees with the website.
    await app.panel.emulateMedia({ colorScheme: "dark" });
    await app.page.emulateMedia({ colorScheme: "dark" });
    await app.context.route("http://127.0.0.1:5173/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: `<html><head><style>
        html,body { margin:0; min-height:100%; } body { background:#fafafa; color:#151515; }
        html[data-theme=dark] body {background:#151515;color:#fafafa}
        header {background:#111;color:white;padding:12px} main {min-height:140vh;padding:32px}
        .flood {position:fixed;inset:0;background:rgba(0,0,0,.95)}
        </style></head><body><header>Small dark navigation</header><main><h1>Workspace</h1>
        <button onclick="document.documentElement.dataset.theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'">Change website theme</button>
        <button aria-expanded="false" aria-controls="menu" onclick="this.setAttribute('aria-expanded','true');document.querySelector('nav').hidden=false">Account menu</button>
        <nav hidden id="menu"><a href="/settings">Account settings</a></nav></main></body></html>`,
      }),
    );
    await app.page.goto(url);
    await app.page.bringToFront();
    const theme = () =>
      app.panel.locator("html").getAttribute("data-tholi-theme");
    await expect.poll(theme).toBe("dark");
    await expect
      .poll(() =>
        app.panel
          .locator("body")
          .evaluate((e) => getComputedStyle(e).backgroundColor),
      )
      .toBe("rgb(17, 27, 23)");

    await app.page
      .getByRole("button", { name: "Change website theme" })
      .click();
    await expect.poll(theme).toBe("light");
    await expect
      .poll(() =>
        app.panel
          .locator("body")
          .evaluate((e) => getComputedStyle(e).backgroundColor),
      )
      .toBe("rgb(250, 247, 240)");
    await app.panel.screenshot({
      path: info.outputPath("light-on-dark-sidebar.png"),
    });

    await app.panel.getByLabel("Navigation goal").fill("Account settings");
    await app.page.bringToFront();
    await app.panel
      .getByRole("button", { name: "Guide me", exact: true })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect
      .poll(async () => (await app.view())?.selectedControlId)
      .toBeTruthy();
    const request = (await app.view()).request.id;
    await app.panel.evaluate(async () =>
      chrome.runtime.sendMessage({
        type: "UI_SAVE",
        preferences: { mode: "guide", surface: "widget", advanced: false },
      }),
    );
    await expect
      .poll(() =>
        app.page
          .frames()
          .find((f) => f.url().includes("/widget.html?grant="))
          ?.url(),
      )
      .toBeTruthy();
    const widget = app.page
      .frames()
      .find((f) => f.url().includes("/widget.html?grant="))!;
    await expect(widget.locator("html")).toHaveAttribute(
      "data-tholi-theme",
      "light",
    );
    await expect(app.page.locator("#tholi-widget")).toHaveAttribute(
      "data-tholi-theme",
      "light",
    );
    await expect(
      app.page.locator("#internet-navigator-overlay"),
    ).toHaveAttribute("data-tholi-theme", "light");
    // Bright Tholi surfaces cannot change their own detector's decision.
    await expect.poll(theme).toBe("light");
    await app.page
      .getByRole("button", { name: "Change website theme" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect(widget.locator("html")).toHaveAttribute(
      "data-tholi-theme",
      "dark",
    );
    await expect(app.page.locator("#tholi-widget")).toHaveAttribute(
      "data-tholi-theme",
      "dark",
    );
    await expect(
      app.page.locator("#internet-navigator-overlay"),
    ).toHaveAttribute("data-tholi-theme", "dark");
    await expect
      .poll(() =>
        widget
          .getByRole("button", { name: "Pause navigation", exact: true })
          .evaluate((e) => getComputedStyle(e).backgroundColor),
      )
      .toBe("rgb(28, 44, 37)");
    expect((await app.view()).request.id).toBe(request);
    await app.page.screenshot({
      path: info.outputPath("dark-on-light-widget.png"),
    });

    // A painted application surface wins over the body's light background.
    await app.page.evaluate(() => {
      const surface = document.createElement("div");
      surface.className = "flood";
      document.body.append(surface);
    });
    await expect.poll(theme).toBe("light");
    await app.page.evaluate(() => document.querySelector(".flood")?.remove());
    await expect.poll(theme).toBe("dark");
    // Modern CSS colors and CSSOM changes, without a style-attribute mutation.
    await app.page.evaluate(() =>
      document.styleSheets[0].insertRule(
        "body { background: oklch(15% 0 0) }",
        document.styleSheets[0].cssRules.length,
      ),
    );
    await expect.poll(theme, { timeout: 6000 }).toBe("light");

    const other = await app.context.newPage();
    await other.goto("http://127.0.0.1:5173/other-document");
    await other.bringToFront();
    await expect.poll(theme).toBe("dark");
    await expect(widget.locator("html")).toHaveAttribute(
      "data-tholi-theme",
      "light",
    );
    await app.page.bringToFront();
    await expect.poll(theme).toBe("light");
    await app.page.reload();
    await expect.poll(theme).toBe("dark");
    // No DOM access on a restricted page: clear the old website override.
    await other.goto("about:blank");
    await other.bringToFront();
    await expect.poll(theme).toBeNull();
  } finally {
    await app.close();
  }
});
