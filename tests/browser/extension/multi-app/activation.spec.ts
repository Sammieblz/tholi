import { test, expect } from "../../../support/browser-test";
import { openNavigatorExtension } from "../../../support/navigator-extension";

test("broad website access stays idle until activation and denied setup never starts scanning", async ({}, info) => {
  const app = await openNavigatorExtension();
  try {
    await app.worker.evaluate(() => {
      (globalThis as any).__websiteStartMessages = 0;
      chrome.runtime.onMessage.addListener((message: any) => {
        if (message.type === "START")
          (globalThis as any).__websiteStartMessages++;
      });
    });
    await app.panel.evaluate(() => {
      (globalThis as any).__requestedWebsiteOrigins = [];
      chrome.permissions.request = ((
        permissions: any,
        callback?: (granted: boolean) => void,
      ) => {
        (globalThis as any).__requestedWebsiteOrigins.push(permissions.origins);
        callback?.(false);
        return Promise.resolve(false);
      }) as typeof chrome.permissions.request;
    });
    const sites = [
      "github.com",
      "dash.cloudflare.com",
      "team.atlassian.net",
      "www.youtube.com",
      "www.netflix.com",
      "www.amazon.com",
      "unlisted.example",
    ];
    await app.context.route("https://**/*", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<h1>Workspace</h1><button>Settings</button><input type="search" aria-label="Search">',
      }),
    );
    for (const host of sites) {
      await app.page.goto("https://" + host + "/workspace");
      await app.page.bringToFront();
      const context = await app.panel.evaluate(async () => {
        const current = await chrome.runtime.sendMessage({
          type: "GET_CONTEXT",
        });
        const tabs = await chrome.tabs.query({
          active: true,
          lastFocusedWindow: true,
        });
        return { current, urlExposed: !!tabs[0]?.url };
      });
      expect(context.urlExposed).toBe(true);
      expect(context.current.origin).toBe("https://" + host);
      expect(context.current.siteAccessRequired).toBe(false);
      expect(context.current.allWebsiteAccess).toBe(true);
      expect(context.current.routes.map((r: any) => r.id)).toContain(
        "navigator.live",
      );
      await app.panel.getByLabel("Navigation goal").fill("Open Settings");
      await expect(
        app.panel.getByRole("button", {
          name: "Guide me",
          exact: true,
        }),
      ).toBeEnabled();
      expect(
        await app.page.locator("#internet-navigator-overlay").count(),
      ).toBe(0);
    }
    // Synthetic withholding exercises deterministic recovery UI. Firefox's
    // native conformance case separately proves actual grant revocation.
    await app.worker.evaluate(() => {
      chrome.permissions.contains = ((
        _permissions: any,
        callback?: (granted: boolean) => void,
      ) => {
        callback?.(false);
        return Promise.resolve(false);
      }) as typeof chrome.permissions.contains;
    });
    await app.panel.evaluate(() => {
      chrome.permissions.contains = ((
        _permissions: any,
        callback?: (granted: boolean) => void,
      ) => {
        callback?.(false);
        return Promise.resolve(false);
      }) as typeof chrome.permissions.contains;
    });
    const enable = app.panel.getByRole("button", {
      name: "Enable website access",
      exact: true,
    });
    await expect(enable).toBeVisible();
    const layouts = [];
    for (const theme of ["light", "dark"] as const)
      for (const width of [320, 380, 720, 1280]) {
        await app.panel.setViewportSize({ width, height: 1000 });
        await enable.scrollIntoViewIfNeeded();
        const layout = await enable.evaluate((button, theme) => {
          // Atomic CSS-only fixture measurement. Restore the owned root before
          // its automatic appearance reader runs; this does not test detection.
          const root = document.documentElement;
          const previous = root.getAttribute("data-tholi-theme");
          try {
            root.setAttribute("data-tholi-theme", theme);
            const section = button.closest(".tholi-website-access")!;
            const bounds = button.getBoundingClientRect();
            return {
              theme: root.getAttribute("data-tholi-theme"),
              viewport: innerWidth,
              overflow: root.scrollWidth > innerWidth,
              sectionOverflow: section.scrollWidth > section.clientWidth + 1,
              buttonWidth: bounds.width,
              buttonHeight: bounds.height,
              left: bounds.left,
              right: bounds.right,
            };
          } finally {
            if (previous === null) root.removeAttribute("data-tholi-theme");
            else root.setAttribute("data-tholi-theme", previous);
          }
        }, theme);
        expect(layout.theme).toBe(theme);
        expect(layout.viewport).toBe(width);
        expect(layout.overflow).toBe(false);
        expect(layout.sectionOverflow).toBe(false);
        expect(layout.buttonWidth).toBeGreaterThanOrEqual(44);
        expect(layout.buttonHeight).toBeGreaterThanOrEqual(44);
        expect(layout.left).toBeGreaterThanOrEqual(0);
        expect(layout.right).toBeLessThanOrEqual(width);
        layouts.push(layout);
      }
    await info.attach("website-access-layout", {
      body: Buffer.from(
        JSON.stringify({ themeSource: "owned panel CSS fixture", layouts }),
      ),
      contentType: "application/json",
    });
    await app.panel.setViewportSize({ width: 380, height: 1000 });
    await app.panel
      .getByRole("button", { name: "Guide me", exact: true })
      .click();
    const notice = app.panel.getByRole("alert");
    await expect(notice).toContainText("Website access is unavailable");
    expect(
      await app.panel.evaluate(
        () => (globalThis as any).__requestedWebsiteOrigins,
      ),
    ).toEqual([]);
    expect(await app.view()).toBeUndefined();
    await enable.focus();
    await expect(enable).toBeFocused();
    await enable.press("Enter");
    await expect(notice).toContainText("Website access was not enabled");
    await expect(enable).toBeFocused();
    expect(
      await app.panel.evaluate(
        () => (globalThis as any).__requestedWebsiteOrigins,
      ),
    ).toEqual([["http://*/*", "https://*/*"]]);
    expect(await app.view()).toBeUndefined();
    expect(
      await app.worker.evaluate(
        () => (globalThis as any).__websiteStartMessages,
      ),
    ).toBe(0);
    expect(await app.page.locator("#internet-navigator-overlay").count()).toBe(
      0,
    );
  } finally {
    await app.close();
  }
});
