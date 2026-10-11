import {
  chromium,
  expect,
  type BrowserContext,
  type Worker,
  type Page,
} from "@playwright/test";
import { mkdtemp, cp, rm, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
export async function openNavigatorExtension(
  viewport = { width: 1280, height: 900 },
) {
  const directory = await mkdtemp(join(tmpdir(), "navigator-e2e-"));
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
  const launch = () =>
    chromium.launchPersistentContext(join(directory, "profile"), {
      channel: "chromium",
      headless: true,
      args: [
        "--disable-extensions-except=" + extension,
        "--load-extension=" + extension,
      ],
      viewport,
    });
  let context: BrowserContext, worker: Worker, page: Page, panel: Page;
  const initialize = async () => {
    context = await launch();
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    page = await context.newPage();
    panel = await context.newPage();
    await panel.goto(
      "chrome-extension://" + new URL(worker.url()).host + "/sidepanel.html",
    );
    await panel.setViewportSize({ width: 380, height: 1000 });
  };
  await initialize();
  const view = () =>
    panel.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "GET_SESSION" }))?.view,
    );
  const start = async (routeId = "navigator.live") => {
    await page.bringToFront();
    const chooser = panel.getByRole("combobox", { name: "Choose a task" });
    await expect(chooser).toBeEnabled();
    await chooser.selectOption(routeId);
    await page.bringToFront();
    await panel
      .getByRole("button", { name: "Start navigation" })
      .evaluate((e) => (e as HTMLButtonElement).click());
    await expect.poll(async () => (await view())?.status).toBe("running");
  };
  const stop = () =>
    panel.evaluate(
      async () => await chrome.runtime.sendMessage({ type: "STOP" }),
    );
  const close = async () => {
    await context.close();
    const target = resolve(directory);
    if (
      !target.startsWith(resolve(tmpdir()) + sep) ||
      !basename(target).startsWith("navigator-e2e-")
    )
      throw new Error("Unsafe temporary cleanup target");
    await rm(target, { recursive: true, force: true });
  };
  const restart = async () => {
    await context.close();
    await initialize();
  };
  return {
    get context() {
      return context;
    },
    get page() {
      return page;
    },
    get panel() {
      return panel;
    },
    get worker() {
      return worker;
    },
    view,
    start,
    stop,
    close,
    restart,
  };
}
