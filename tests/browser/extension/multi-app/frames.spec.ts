import { embeddedControlsHtml } from "../../../fixtures/multi-app/frame-html";
import { test, expect } from "../../../support/browser-test";
import { openNavigatorExtension } from "../../../support/navigator-extension";
test("authorized frame controls bind to their own document and hide behind parent dialogs", async () => {
  const app = await openNavigatorExtension();
  try {
    await app.context.route("**/frame-host", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<main aria-label="Workspace"><h1>Workspace</h1><iframe title="Embedded application" src="http://localhost:5173/embedded-controls" style="width:650px;height:300px;border:0"></iframe></main>',
      }),
    );
    await app.context.route("**/embedded-controls", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: embeddedControlsHtml,
      }),
    );
    await app.page.goto("http://127.0.0.1:5173/frame-host");
    await app.start();
    await expect
      .poll(async () =>
        ((await app.view())?.controls || []).some(
          (c: any) => c.label === "Embedded search" && c.reference?.frameId > 0,
        ),
      )
      .toBe(true);
    const page = await app.panel.evaluate(
      async () => await chrome.runtime.sendMessage({ type: "GET_PAGE" }),
    );
    expect(page.error).toBeUndefined();
    expect(page.perception?.frames).toHaveLength(2);
    const pinned = await app.panel.evaluate(async () => {
      const session = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
      return {
        session,
        tab: await chrome.tabs.get(session.tabId),
        zoom: await chrome.tabs.getZoom(session.tabId),
      };
    });
    expect(page.perception.native).toMatchObject({
      windowId: pinned.tab.windowId,
      tabId: pinned.session.tabId,
      documentId: pinned.session.documentId,
      frameId: 0,
    });
    expect(
      page.perception.frames.every(
        (frame: any) => frame.viewport.browserZoom === pinned.zoom,
      ),
    ).toBe(true);
    expect(
      page.perception.frames.find((frame: any) => frame.native.frameId !== 0)
        .parentFrameId,
    ).toBe(0);
    const root = page.perception.frames.find(
      (frame: any) => frame.native.frameId === 0,
    );
    const region = page.perception.regions.find(
      (item: any) => item.frameId === 0 && item.role === "main",
    );
    expect(region).toBeDefined();
    const regionRequest = {
      native: page.perception.native,
      scanId: root.scanId,
      pageRevision: root.pageRevision,
      regionId: region.id,
    };
    const refreshed = await app.panel.evaluate(
      async (request) =>
        chrome.runtime.sendMessage({
          type: "GET_PAGE",
          regionObservation: request,
        }),
      regionRequest,
    );
    expect(refreshed.error).toBeUndefined();
    expect(refreshed.perception.pageRevision).toBe(refreshed.page.revision);
    expect(
      refreshed.perception.frames.find(
        (frame: any) => frame.native.frameId === 0,
      ).scanId,
    ).not.toBe(root.scanId);
    const stale = await app.panel.evaluate(
      async (request) =>
        chrome.runtime.sendMessage({
          type: "GET_PAGE",
          regionObservation: request,
        }),
      regionRequest,
    );
    expect(stale.error).toContain("unavailable");
    expect(await app.page.evaluate(() => ({ x: scrollX, y: scrollY }))).toEqual(
      { x: 0, y: 0 },
    );
    const reply = await app.panel.evaluate(
      async (revision) =>
        await chrome.runtime.sendMessage({
          type: "SET_GOAL",
          goal: "Find embedded search",
          revision,
        }),
      refreshed.page.revision,
    );
    expect(reply.error).toBeUndefined();
    await expect
      .poll(async () => {
        const v = await app.view();
        return v?.controls?.find((c: any) => c.id === v.selectedControlId)
          ?.label;
      })
      .toBe("Embedded search");
    const frame = app.page
      .frames()
      .find((f) => f.url().includes("embedded-controls"))!;
    await expect(frame.locator("#internet-navigator-overlay")).toBeAttached();
    await frame.getByRole("textbox", { name: "Embedded search" }).click();
    await expect
      .poll(async () => (await app.view())?.goalPlan?.status)
      .toBe("completed");
    await app.page.evaluate(() => {
      const d = document.createElement("dialog");
      d.innerHTML = "<h2>Blocking dialog</h2><button>Close</button>";
      document.body.append(d);
      d.showModal();
    });
    await expect
      .poll(async () =>
        ((await app.view())?.controls || []).some(
          (c: any) => c.label === "Embedded search",
        ),
      )
      .toBe(false);
    await app.stop();
    await expect(
      frame.locator("#internet-navigator-overlay"),
    ).not.toBeAttached();
  } finally {
    await app.close();
  }
});
test("an ungranted embedded origin remains unscanned and exposes selective access recovery", async () => {
  const app = await openNavigatorExtension();
  try {
    await app.context.route("**/frame-denied", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<h1>Workspace</h1><iframe title="Another application" src="https://ungranted.test/controls" style="width:650px;height:300px"></iframe>',
      }),
    );
    await app.context.route("https://ungranted.test/**", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<input aria-label="Private embedded field">',
      }),
    );
    await app.page.goto("http://127.0.0.1:5173/frame-denied");
    await app.start();
    await expect
      .poll(async () => (await app.view())?.frameAccess || [])
      .toContain("https://ungranted.test");
    expect(JSON.stringify((await app.view())?.controls)).not.toContain(
      "Private embedded field",
    );
    await expect(
      app.panel.getByRole("button", { name: "Allow https://ungranted.test" }),
    ).toBeVisible();
    await app.panel
      .getByRole("button", { name: "Conversation", exact: true })
      .click();
    const allow = app.panel.getByRole("button", {
      name: "Allow https://ungranted.test",
      exact: true,
    });
    await expect(allow).toBeVisible();
    await app.panel.evaluate(() => {
      (globalThis as any).__requestedFrameOrigins = [];
      chrome.permissions.request = ((
        permissions: any,
        callback?: (granted: boolean) => void,
      ) => {
        (globalThis as any).__requestedFrameOrigins = permissions.origins;
        callback?.(false);
        return Promise.resolve(false);
      }) as typeof chrome.permissions.request;
    });
    await allow.click();
    await expect(app.panel.getByRole("alert")).toContainText(
      "Access was not granted",
    );
    expect(
      await app.panel.evaluate(
        () => (globalThis as any).__requestedFrameOrigins,
      ),
    ).toEqual(["https://ungranted.test/*"]);
    expect(JSON.stringify((await app.view())?.controls)).not.toContain(
      "Private embedded field",
    );
  } finally {
    await app.close();
  }
});
