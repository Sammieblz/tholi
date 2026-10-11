import {
  test,
  expect,
  chromium,
  type BrowserContext,
  type Page,
  type Worker,
} from "@playwright/test";
import { mkdtemp, readFile, writeFile, cp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
let context: BrowserContext,
  page: Page,
  panel: Page,
  worker: Worker,
  directory: string;
test.beforeAll(async ({}, testInfo) => {
  directory = await mkdtemp(join(tmpdir(), "navigator-e2e-"));
  const extension = join(directory, "extension");
  await cp(resolve("dist/extension"), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, "manifest.json"), "utf8"),
  );
  expect(manifest.host_permissions).toEqual([
    "http://127.0.0.1/*",
    "http://localhost/*",
    "https://en.wikipedia.org/*",
  ]);
  expect(manifest.permissions).not.toContain("tabs");
  context = await chromium.launchPersistentContext(join(directory, "profile"), {
    channel: "chromium",
    headless: true,
    acceptDownloads: true,
    args: [
      "--disable-extensions-except=" + extension,
      "--load-extension=" + extension,
    ],
    viewport: testInfo.project.use.viewport || { width: 1280, height: 900 },
  });
  worker =
    context.serviceWorkers()[0] ||
    (await context.waitForEvent("serviceworker"));
  const extensionId = new URL(worker.url()).host;
  page = await context.newPage();
  await page.goto("http://127.0.0.1:5173");
  panel = await context.newPage();
  await panel.goto("chrome-extension://" + extensionId + "/sidepanel.html");
  await panel.setViewportSize({ width: 380, height: 1000 });
});
test.afterAll(async () => {
  await context?.close();
  if (directory) {
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !basename(target).startsWith("navigator-e2e-")
    )
      throw new Error("Unsafe temporary cleanup target");
    await rm(target, { recursive: true, force: true });
  }
});
async function start(routeId = "demo.subscription.cancel") {
  await page.bringToFront();
  const chooser = panel.getByRole("combobox", { name: "Choose a task" });
  await expect(chooser).toBeEnabled();
  await chooser.selectOption(routeId);
  await page.bringToFront();
  // In headless tests the panel is an extension tab. Dispatch its actual button
  // handler without foregrounding that tab; the real side panel leaves the website active.
  await panel
    .getByRole("button", { name: "Start navigation" })
    .evaluate((button) => (button as HTMLButtonElement).click());
  await expect(page.locator("#internet-navigator-overlay")).toBeVisible();
  await expect(panel.locator(".indicator")).toHaveText("ON");
  await expect(panel.locator(".error")).toHaveCount(0);
}
async function status(value: string) {
  await expect(panel.locator(".current .eyebrow")).toHaveText(value);
}
async function reset() {
  await panel.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "STOP" }),
  );
  await page.goto("http://127.0.0.1:5173");
  await expect(
    panel.getByRole("button", { name: "Start navigation" }),
  ).toBeVisible();
}
async function next(name: string, heading: string) {
  await page
    .getByRole("button", { name, exact: true })
    .and(page.locator("button:enabled"))
    .click();
  await expect(
    page.getByRole("heading", { name: heading, exact: true }),
  ).toBeVisible();
  const states: Record<string, string> = {
    "Account overview": "account",
    "Billing & subscription": "billing",
    "Manage your plan": "plan",
    "Before you go": "retention",
    "Confirm cancellation": "confirmation",
    "Profile settings": "profile",
    "Sign in to Northstar": "login",
  };
  await expect
    .poll(async () =>
      panel.evaluate(
        async () =>
          (await chrome.runtime.sendMessage({ type: "GET_SESSION" }))?.view
            ?.stateId,
      ),
    )
    .toBe(states[heading]);
}
test("explicit activation, verified steps, retention branch and final hard stop", async () => {
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
  await start();
  await mkdir("output/qa", { recursive: true });
  await page.screenshot({
    path: "output/qa/demo-guidance-" + test.info().project.name + ".png",
  });
  await panel.screenshot({
    path: "output/qa/panel-guidance-" + test.info().project.name + ".png",
  });
  await next("Account", "Account overview");
  await next("Billing", "Billing & subscription");
  await next("Manage subscription", "Manage your plan");
  await next("Cancel subscription", "Before you go");
  await next("Continue cancellation", "Confirm cancellation");
  await status("REVIEW REQUIRED");
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
  await expect(panel.locator(".evidence")).toContainText(
    "5 verified transitions",
  );
  await page
    .getByRole("button", { name: "Confirm cancellation", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Subscription canceled", exact: true }),
  ).toBeVisible();
  await status("REVIEW REQUIRED");
  await mkdir("output/qa", { recursive: true });
  await page.screenshot({ path: "output/qa/demo-success.png" });
  await panel.screenshot({ path: "output/qa/panel-boundary.png" });
});
test("wrong turn reroutes, alternate label survives, pause and stop remove guidance", async () => {
  await reset();
  await start();
  await next("Profile", "Profile settings");
  await status("REROUTING");
  await next("Back to account", "Account overview");
  await next("Billing", "Billing & subscription");
  await page.getByText("Demo scenarios", { exact: true }).click();
  await page.getByLabel("Alternate label", { exact: true }).check();
  await expect(
    page.getByRole("button", { name: "Manage plan", exact: true }),
  ).toBeVisible();
  await expect(page.locator("#internet-navigator-overlay")).toBeVisible();
  await next("Manage plan", "Manage your plan");
  await panel.getByRole("button", { name: "Pause navigation" }).click();
  await status("PAUSED");
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
  await panel.getByRole("button", { name: "Resume navigation" }).click();
  await expect(page.locator("#internet-navigator-overlay")).toBeVisible();
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await status("STOPPED");
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
});
test("login excludes synthetic secrets and requires resume", async () => {
  await reset();
  await page.getByText("Demo scenarios", { exact: true }).click();
  await page.getByLabel("Login checkpoint", { exact: true }).check();
  await start();
  await next("Account", "Sign in to Northstar");
  await status("CHECKPOINT");
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
  await page.getByRole("button", { name: "Complete demo sign in" }).click();
  await status("CHECKPOINT");
  await panel.getByRole("button", { name: "Resume navigation" }).click();
  await expect(page.locator("#internet-navigator-overlay")).toBeVisible();
  const stored = await worker.evaluate(
    async () => await chrome.storage.session.get(null),
  );
  expect(JSON.stringify(stored)).not.toContain("SENTINEL");
});
test("ambiguous duplicates and unknown screens stop instead of guessing", async () => {
  await reset();
  await page.getByText("Demo scenarios", { exact: true }).click();
  await page.getByLabel("Ambiguous duplicate", { exact: true }).check();
  await start();
  await next("Account", "Account overview");
  await next("Billing", "Billing & subscription");
  await status("STOPPED");
  await expect(panel.locator(".current")).toContainText(
    "Multiple controls match",
  );
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
  await reset();
  await start();
  await page.getByText("Demo scenarios", { exact: true }).click();
  await page
    .getByRole("button", { name: "Unknown screen", exact: true })
    .click();
  await status("STOPPED");
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
});

test("delayed same-URL render waits, and full page navigation stops", async () => {
  await reset();
  await page.getByText("Demo scenarios", { exact: true }).click();
  await page.getByLabel("Delayed render", { exact: true }).check();
  await start();
  await page.getByRole("button", { name: "Account", exact: true }).click();
  await expect(
    page.getByRole("heading", {
      name: "Loading your next screen…",
      exact: true,
    }),
  ).toBeVisible();
  await status("WAITING FOR THE WEBSITE");
  await expect(panel.locator(".evidence")).toContainText(
    "0 verified transitions",
  );
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
  await expect(
    page.getByRole("heading", { name: "Account overview", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      panel.evaluate(
        async () =>
          (await chrome.runtime.sendMessage({ type: "GET_SESSION" }))?.view
            ?.stateId,
      ),
    )
    .toBe("account");
  await expect(panel.locator(".evidence")).toContainText(
    "1 verified transitions",
  );
  await page.goto("about:blank");
  await status("STOPPED");
});

test("production localhost access is available without a toolbar grant", async () => {
  const granted = await worker.evaluate(
    async () =>
      await chrome.permissions.contains({
        origins: ["http://127.0.0.1/*", "http://localhost/*"],
      }),
  );
  expect(granted).toBe(true);
  await reset();
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
  await page.goto("http://localhost:5173");
  await start();
  await status("GUIDING");
  await expect(panel.locator(".error")).toHaveCount(0);
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
});

test("two origin-filtered tasks have independent previews and billing completion", async () => {
  await reset();
  await page.bringToFront();
  const choice = panel.getByRole("combobox", { name: "Choose a task" });
  await expect(choice.locator("option")).toHaveCount(3);
  await choice.selectOption("demo.billing.overview");
  await expect(panel.locator(".route-card h2")).toHaveText(
    "Find billing details",
  );
  await expect(panel.locator(".notice")).toContainText("read-only route");
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
  await start("demo.billing.overview");
  await expect(choice).toBeDisabled();
  await next("Account", "Account overview");
  await next("Billing", "Billing & subscription");
  await status("COMPLETED");
  await expect(panel.locator(".current")).toContainText("You reached Billing");
  await expect(panel.locator(".current")).not.toContainText("canceled");
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
  await expect(panel.locator(".evidence")).toContainText(
    "2 verified transitions",
  );
  const pin = await panel.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "GET_SESSION" }),
  );
  expect(pin.routeId).toBe("demo.billing.overview");
  expect(pin.routeVersion).toBe("0.1.0");
  await panel.screenshot({
    path:
      "output/qa/panel-billing-completed-" + test.info().project.name + ".png",
  });
});
test("active sessions reject switching and delayed updates from a previous route", async () => {
  await reset();
  await start();
  const previous = await panel.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "GET_SESSION" }),
  );
  const blocked = await panel.evaluate(
    async () =>
      await chrome.runtime.sendMessage({
        type: "START",
        routeId: "demo.billing.overview",
        routeVersion: "0.1.0",
      }),
  );
  expect(blocked.error).toContain("Stop the current navigation");
  await panel.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "STOP" }),
  );
  await start("demo.billing.overview");
  const pin = await panel.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "GET_SESSION" }),
  );
  expect(pin.sessionId).not.toBe(previous.sessionId);
  const replies = await worker.evaluate(
    async ({ tabId, previous }) =>
      await chrome.scripting.executeScript({
        target: { tabId },
        func: async (token, view) =>
          await chrome.runtime.sendMessage({
            type: "SESSION_UPDATE",
            sessionId: token,
            view,
          }),
        args: [previous.sessionId, previous.view],
      }),
    { tabId: pin.tabId, previous },
  );
  expect(replies[0].result.error).toContain("Stale");
  const stored = await panel.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "GET_SESSION" }),
  );
  expect(stored.sessionId).toBe(pin.sessionId);
  expect(stored.view.routeId).toBe("demo.billing.overview");
  const staleStop = await worker.evaluate(
    async ({ tabId, sessionId }) =>
      await chrome.tabs.sendMessage(tabId, {
        type: "CONTROL_SESSION",
        sessionId,
        action: "STOP",
      }),
    { tabId: pin.tabId, sessionId: previous.sessionId },
  );
  expect(staleStop.error).toContain("Stale");
  await expect(page.locator("#internet-navigator-overlay")).toBeVisible();
  const unavailable = await panel.evaluate(
    async () =>
      await chrome.runtime.sendMessage({
        type: "START",
        routeId: "demo.billing.overview",
        routeVersion: "9.9.9",
      }),
  );
  expect(unavailable.error).toContain("unavailable");
});
test("unsupported tabs offer no tasks and cannot replace a pinned session", async () => {
  await reset();
  await start("demo.billing.overview");
  const pin = await panel.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "GET_SESSION" }),
  );
  const unsupported = await context.newPage();
  await unsupported.goto("about:blank");
  await unsupported.bringToFront();
  const current = await panel.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "GET_CONTEXT" }),
  );
  expect(current.routes).toEqual([]);
  await expect(
    panel.getByRole("heading", { name: "No supported tasks" }),
  ).toBeVisible();
  await expect(panel.locator(".tab-warning")).toContainText("another tab");
  const rejected = await panel.evaluate(
    async () =>
      await chrome.runtime.sendMessage({
        type: "START",
        routeId: "demo.subscription.cancel",
        routeVersion: "0.1.0",
      }),
  );
  expect(rejected.error).toBeTruthy();
  const stillPinned = await panel.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "GET_SESSION" }),
  );
  expect(stillPinned.sessionId).toBe(pin.sessionId);
  expect(stillPinned.routeId).toBe("demo.billing.overview");
  await unsupported.close();
  await page.bringToFront();
});

test("debug inspector renders scoring and exports bounded diagnostics", async () => {
  await reset();
  await start();
  await panel.locator("summary").evaluate((e) => (e as HTMLElement).click());
  await panel.getByLabel("Show route debug inspector").evaluate((e) => {
    (e as HTMLInputElement).click();
  });
  const inspector = panel.getByRole("region", {
    name: "Route debug inspector",
  });
  await expect(
    inspector.getByRole("heading", { name: "Detected state" }),
  ).toBeVisible();
  await expect(inspector.locator("table").first()).toContainText("home");
  await next("Account", "Account overview");
  await expect(inspector).toContainText("observed account · verified");
  await page.bringToFront();
  const exportButton = inspector.getByRole("button", {
    name: "Export diagnostics",
  });
  await expect(exportButton).toBeEnabled();
  const downloadPromise = panel.waitForEvent("download");
  await exportButton.evaluate((e) => (e as HTMLButtonElement).click());
  const download = await downloadPromise;
  const report = JSON.parse(await readFile((await download.path())!, "utf8"));
  expect(report.category).toBe("diagnostics");
  expect(report.diagnostics.transitions[0].outcome).toBe("verified");
  expect(JSON.stringify(report)).not.toMatch(
    /127\.0\.0\.1|"landmarks":|"pathname":/,
  );
  await page.bringToFront();
  await panel.screenshot({
    path: "output/qa/debug-inspector-" + test.info().project.name + ".png",
  });
});
