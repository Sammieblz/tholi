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
  ]);
  expect(manifest.permissions).not.toContain("tabs");
  context = await chromium.launchPersistentContext(join(directory, "profile"), {
    channel: "chromium",
    headless: true,
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
async function start() {
  await page.bringToFront();
  const result = await panel.evaluate(
    async () => await chrome.runtime.sendMessage({ type: "START" }),
  );
  expect(result?.error, JSON.stringify(result)).toBeUndefined();
  await expect(page.locator("#internet-navigator-overlay")).toBeVisible();
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
  await status("BOUNDARY");
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
  await status("BOUNDARY");
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
  await status("WAITING");
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
  await status("RUNNING");
  await expect(panel.locator(".error")).toHaveCount(0);
  await panel.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.locator("#internet-navigator-overlay")).toHaveCount(0);
});
