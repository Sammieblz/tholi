import { test, expect } from "../../../support/browser-test";
import { openNavigatorExtension } from "../../../support/navigator-extension";
test("authorized frame controls bind to their own document and hide behind parent dialogs", async () => {
  const app = await openNavigatorExtension();
  try {
    await app.context.route("**/frame-host", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<h1>Workspace</h1><iframe title="Embedded application" src="http://localhost:5173/embedded-controls" style="width:650px;height:300px;border:0"></iframe>',
      }),
    );
    await app.context.route("**/embedded-controls", (route) =>
      route.fulfill({
        contentType: "text/html",
        body: '<label>Embedded search<input aria-label="Embedded search" style="width:400px;height:40px"></label><button aria-label="Menu" aria-expanded="false">Menu</button>',
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
    const reply = await app.panel.evaluate(
      async (revision) =>
        await chrome.runtime.sendMessage({
          type: "SET_GOAL",
          goal: "Find embedded search",
          revision,
        }),
      page.page.revision,
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
      chrome.permissions.request = async (permissions) => {
        (globalThis as any).__requestedFrameOrigins = permissions.origins;
        return false;
      };
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
