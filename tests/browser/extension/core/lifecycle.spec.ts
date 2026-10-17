import { test, expect } from "../../../support/browser-test";
import { openNavigatorExtension } from "../../../support/navigator-extension";
import { setGoal } from "../../../support/acceptance-runner";
const html = (next = false) =>
  `<!doctype html><html><body><h1>${next ? "Second" : "First"} document</h1><input type="search" aria-label="Search catalogue"><fieldset><legend>Color</legend><input type="radio" name="color" id="light" checked><label for="light">Light</label><input type="radio" name="color" id="dark"><label for="dark">Dark</label></fieldset><a href="/lifecycle/${next ? "first" : "second"}">${next ? "Previous" : "Next"} document</a><button>Feedback</button></body></html>`;
async function prepare(viewport: any) {
  const app = await openNavigatorExtension(viewport);
  await app.context.route("http://localhost:5173/lifecycle/**", (r) =>
    r.fulfill({
      contentType: "text/html",
      body: html(r.request().url().endsWith("second")),
    }),
  );
  await app.page.goto("http://localhost:5173/lifecycle/first");
  await app.start();
  return app;
}
async function restartWorker(app: Awaited<ReturnType<typeof prepare>>) {
  // MV3 restarts keep Playwright's Worker object; a changed global epoch proves
  // the real execution context restarted, rather than assuming a close event.
  const cdp = await app.context.newCDPSession(app.panel);
  const versions = new Map<string, any>();
  cdp.on("ServiceWorker.workerVersionUpdated", (event) => {
    for (const v of event.versions) versions.set(v.versionId, v);
  });
  await cdp.send("ServiceWorker.enable");
  const url = app.context
    .serviceWorkers()
    .find((w) => w.url().endsWith("/worker.js"))!
    .url();
  await expect
    .poll(
      () =>
        [...versions.values()].find(
          (v) => v.scriptURL === url && v.runningStatus === "running",
        )?.versionId,
    )
    .toBeTruthy();
  const version = [...versions.values()].find(
    (v) => v.scriptURL === url && v.runningStatus === "running",
  );
  const before = app.context.serviceWorkers().find((w) => w.url() === url)!;
  const epoch = () =>
    before.evaluate(() => {
      const scope = globalThis as any;
      return (scope.__navigatorTestEpoch ||= crypto.randomUUID());
    });
  const previousEpoch = await epoch();
  await cdp.send("ServiceWorker.stopWorker", { versionId: version.versionId });
  await app.view();
  await expect.poll(epoch).not.toBe(previousEpoch);
  await cdp.detach();
}
test("Back and Forward keep fresh full-document and same-document bindings without duplicate progress", async ({}, info) => {
  const app = await prepare(info.project.use.viewport);
  try {
    await setGoal(app, "Next document");
    await app.page
      .getByRole("link", { name: "Next document", exact: true })
      .click();
    await expect
      .poll(async () => (await app.view()).page?.path)
      .toBe("/lifecycle/second");
    await expect.poll(async () => (await app.view()).verifiedSteps).toBe(1);
    const second = (await app.view()).controls[0].id;
    await app.page.goBack();
    await expect
      .poll(async () => (await app.view()).page?.path)
      .toBe("/lifecycle/first");
    expect((await app.view()).verifiedSteps).toBe(1);
    await app.page.goForward();
    await expect
      .poll(async () => (await app.view()).page?.path)
      .toBe("/lifecycle/second");
    expect((await app.view()).verifiedSteps).toBe(1);
    const rejected = await app.panel.evaluate(
      (id) =>
        chrome.runtime.sendMessage({ type: "GUIDE_CONTROL", controlId: id }),
      second,
    );
    expect(rejected.error).toMatch(/stale/);
    await app.page.evaluate(() => {
      history.pushState({}, "", "/lifecycle/spa");
      document.body.innerHTML = "<h1>SPA page</h1><button>Help</button>";
      window.onpopstate = () => {
        document.body.innerHTML = location.pathname.endsWith("spa")
          ? "<h1>SPA page</h1><button>Help</button>"
          : "<h1>Second document</h1><button>About</button>";
      };
    });
    await expect
      .poll(async () => (await app.view()).page?.path)
      .toBe("/lifecycle/spa");
    await setGoal(app, "Help");
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      1,
    );
    await app.page.goBack();
    await expect
      .poll(async () => (await app.view()).page?.path)
      .toBe("/lifecycle/second");
    await expect(app.page.locator("#internet-navigator-overlay")).toHaveCount(
      0,
    );
    await app.page.goForward();
    await expect
      .poll(async () => (await app.view()).page?.path)
      .toBe("/lifecycle/spa");
    expect((await app.view()).verifiedSteps).toBe(1);
  } finally {
    await app.close();
  }
});
for (const state of ["running", "waiting", "paused"] as const) {
  test(`actual service-worker suspension restores ${state} without duplicate guidance`, async ({}, info) => {
    const app = await prepare(info.project.use.viewport);
    let release: () => void = () => {};
    let navigation: Promise<unknown> | undefined;
    try {
      const initial = await app.panel.evaluate(() =>
        chrome.runtime.sendMessage({ type: "GET_SESSION" }),
      );
      if (state === "waiting") {
        const gate = new Promise<void>((r) => (release = r));
        await app.context.route(
          "http://localhost:5173/lifecycle/second",
          async (r) => {
            await gate;
            await r.fulfill({ contentType: "text/html", body: html(true) });
          },
        );
        await setGoal(app, "Next document");
        navigation = app.page
          .getByRole("link", { name: "Next document", exact: true })
          .click();
        await expect
          .poll(async () => (await app.view()).status)
          .toBe("waiting");
      } else if (state === "paused")
        await app.panel.evaluate(() =>
          chrome.runtime.sendMessage({ type: "PAUSE" }),
        );
      else await setGoal(app, "Switch to dark mode");
      await restartWorker(app);
      const restored = await app.panel.evaluate(() =>
        chrome.runtime.sendMessage({ type: "GET_SESSION" }),
      );
      expect(restored.sessionId).toBe(initial.sessionId);
      expect(restored.view.status).toBe(state);
      if (state === "waiting") {
        release();
        await navigation;
        await expect
          .poll(async () => (await app.view()).page?.path)
          .toBe("/lifecycle/second");
        await expect.poll(async () => (await app.view()).verifiedSteps).toBe(1);
        expect((await app.view()).goalPlan.status).toBe("completed");
      } else {
        if (state === "paused") {
          await app.page.evaluate(() => {
            document
              .querySelector("#dark")!
              .setAttribute("aria-label", "Dark updated");
          });
          expect((await app.view()).page).toBeUndefined();
          await app.page.bringToFront();
          await app.panel.evaluate(() =>
            chrome.runtime.sendMessage({ type: "RESUME" }),
          );
          await setGoal(app, "Dark updated");
        }
        await app.page
          .getByLabel(state === "paused" ? "Dark updated" : "Dark", {
            exact: true,
          })
          .check();
        await expect.poll(async () => (await app.view()).verifiedSteps).toBe(1);
        await app.panel.evaluate(() =>
          chrome.runtime.sendMessage({ type: "GET_PAGE" }),
        );
        expect((await app.view()).verifiedSteps).toBe(1);
      }
    } finally {
      release();
      await navigation?.catch(() => {});
      await app.close();
    }
  });
  test(`tab switching and closure keep ${state} pinned`, async ({}, info) => {
    const app = await prepare(info.project.use.viewport);
    let release: () => void = () => {};
    let navigation: Promise<unknown> | undefined;
    try {
      if (state === "paused")
        await app.panel.evaluate(() =>
          chrome.runtime.sendMessage({ type: "PAUSE" }),
        );
      else if (state === "waiting") {
        const gate = new Promise<void>((r) => (release = r));
        await app.context.route(
          "http://localhost:5173/lifecycle/second",
          async (r) => {
            await gate;
            await r.fulfill({ contentType: "text/html", body: html(true) });
          },
        );
        await setGoal(app, "Next document");
        navigation = app.page
          .getByRole("link", { name: "Next document", exact: true })
          .click()
          .catch((error) => {
            if (!app.page.isClosed()) throw error;
          });
        await expect
          .poll(async () => (await app.view()).status)
          .toBe("waiting");
      } else await setGoal(app, "Show search");
      const other = await app.context.newPage();
      await other.goto("http://localhost:5173/lifecycle/other");
      await other.bringToFront();
      for (const type of ["GET_PAGE", "RESUME"]) {
        const reply = await app.panel.evaluate(
          (type) => chrome.runtime.sendMessage({ type }),
          type,
        );
        expect(reply.error).toMatch(/Return to the tab/);
      }
      await expect(other.locator("#internet-navigator-overlay")).toHaveCount(0);
      expect((await app.view()).status).toBe(state);
      await app.page.close();
      await expect.poll(async () => !!(await app.view())).toBe(false);
      const stored = await app.panel.evaluate(() =>
        chrome.storage.session.get("navigatorSession"),
      );
      expect(stored.navigatorSession).toBeUndefined();
    } finally {
      release();
      await navigation?.catch(() => {});
      await app.close();
    }
  });
}
