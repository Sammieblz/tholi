import { test, expect } from "../../../support/browser-test";
import { openNavigatorExtension } from "../../../support/navigator-extension";

test("new sites expose navigation before a host grant and denial never starts scanning", async () => {
  const app = await openNavigatorExtension();
  try {
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
      expect(context.current.siteAccessRequired).toBe(true);
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
    await app.panel.evaluate(() => {
      (globalThis as any).__requestedOrigins = [];
      chrome.permissions.request = ((
        permissions: any,
        callback?: (granted: boolean) => void,
      ) => {
        (globalThis as any).__requestedOrigins = permissions.origins;
        callback?.(false);
        return Promise.resolve(false);
      }) as typeof chrome.permissions.request;
    });
    await app.panel
      .getByRole("button", { name: "Guide me", exact: true })
      .click();
    const notice = app.panel.getByRole("alert");
    await expect(notice).toBeVisible();
    await expect(async () => {
      if (!(await notice.innerText()).includes("access was declined")) {
        // The loop can outrun the sidebar's context refresh. Stale intent must
        // request no grant and start no session; retry only that rejected action.
        await expect(notice).toContainText("expected task destination");
        expect(
          await app.panel.evaluate(
            () => (globalThis as any).__requestedOrigins,
          ),
        ).toEqual([]);
        expect(await app.view()).toBeUndefined();
        await app.panel
          .getByRole("button", { name: "Guide me", exact: true })
          .click();
      }
      await expect(notice).toContainText("access was declined", {
        timeout: 500,
      });
    }).toPass({ timeout: 5000 });
    expect(
      await app.panel.evaluate(() => (globalThis as any).__requestedOrigins),
    ).toEqual(["https://unlisted.example/*"]);
    expect(await app.view()).toBeUndefined();
    expect(await app.page.locator("#internet-navigator-overlay").count()).toBe(
      0,
    );
  } finally {
    await app.close();
  }
});
