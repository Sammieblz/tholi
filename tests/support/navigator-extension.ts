import { prepareChromiumProfile } from "./chromium-profile";
import { installSidebarTabHarness } from "./sidebar-tab";
import {
  chromium,
  expect,
  type BrowserContext,
  type Worker,
  type Page,
} from "@playwright/test";
import { mkdtemp, cp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
export async function openNavigatorExtension(
  viewport = { width: 1280, height: 900 },
  fixturePermissions: string[] = [],
  inspectDetails = true,
  options: { nativeViewport?: boolean; allowAutomaticDownloads?: boolean } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "navigator-e2e-"));
  const extension = join(directory, "extension");
  const { profilePath, downloadsPath } = await prepareChromiumProfile(
    directory,
    options,
  );
  await cp(resolve("dist/extension"), extension, { recursive: true });
  const manifest = JSON.parse(
    await readFile(join(extension, "manifest.json"), "utf8"),
  );
  expect(manifest.host_permissions).toEqual([
    "http://127.0.0.1/*",
    "http://localhost/*",
    "https://en.wikipedia.org/*",
  ]);
  // Fixture-only pregrants. These do not validate native Chrome permission UI.
  if (fixturePermissions.length)
    await writeFile(
      join(extension, "manifest.json"),
      JSON.stringify({
        ...manifest,
        host_permissions: [...manifest.host_permissions, ...fixturePermissions],
      }),
    );
  const launch = () =>
    chromium.launchPersistentContext(profilePath, {
      channel: "chromium",
      headless: true,
      acceptDownloads: true,
      downloadsPath,
      args: [
        "--disable-extensions-except=" + extension,
        "--load-extension=" + extension,
        ...(options.nativeViewport
          ? [`--window-size=${viewport.width + 18},${viewport.height + 96}`]
          : []),
      ],
      viewport: options.nativeViewport ? null : viewport,
    });
  let context: BrowserContext, worker: Worker, page: Page, panel: Page;
  const initialize = async () => {
    context = await launch();
    worker =
      context.serviceWorkers()[0] ||
      (await context.waitForEvent("serviceworker"));
    page = await context.newPage();
    panel = await context.newPage();
    await installSidebarTabHarness(panel, downloadsPath);
    await panel.goto(
      "chrome-extension://" + new URL(worker.url()).host + "/sidepanel.html",
    );
    if (!options.nativeViewport)
      await panel.setViewportSize({ width: 380, height: 1000 });
  };
  await initialize();
  const view = async () => {
    if (inspectDetails) {
      await panel
        .locator('.tholi-journey-summary[aria-expanded="false"]')
        .evaluateAll((nodes) => {
          for (const node of nodes) {
            const previous = document.activeElement as HTMLElement | null;
            (node as HTMLButtonElement).click();
            if (document.activeElement === node && previous?.isConnected)
              previous.focus({ preventScroll: true });
          }
        });
      await panel
        .locator('.tholi-disclosure-trigger[aria-expanded="false"]')
        .evaluateAll((nodes) => {
          for (const node of nodes) {
            if (!/^(Route details|Saved routes)/.test(node.textContent || ""))
              continue;
            const previous = document.activeElement as HTMLElement | null;
            (node as HTMLButtonElement).click();
            if (document.activeElement === node && previous?.isConnected)
              previous.focus({ preventScroll: true });
          }
        });
      await panel.locator("details").evaluateAll((nodes) => {
        for (const node of nodes)
          if (
            /^(Route details|Advanced controls|Saved routes|Route preference|Workflow details)/.test(
              node.querySelector(":scope > summary")?.textContent || "",
            )
          )
            (node as HTMLDetailsElement).open = true;
      });
    }
    return panel.evaluate(
      async () =>
        (await chrome.runtime.sendMessage({ type: "GET_SESSION" }))?.view,
    );
  };
  const start = async (routeId = "navigator.live") => {
    await panel
      .getByRole("button", { name: "Tholi settings", exact: true })
      .click();
    await panel
      .getByRole("checkbox", { name: "Advanced controls", exact: true })
      .check();
    await panel.keyboard.press("Escape");
    await page.bringToFront();
    await expect(
      panel
        .locator('.task-choice, section[aria-label="Your destination"]')
        .first(),
    ).toBeVisible();
    const chooser = panel.getByRole("combobox", { name: "Choose a task" });
    if (await chooser.count()) {
      await expect(chooser).toBeEnabled();
      await chooser.selectOption(routeId);
    }
    if (routeId === "navigator.live") {
      const explorer = panel
        .locator("summary")
        .filter({ hasText: /^Explore page controls$/ });
      await expect(explorer).toBeVisible();
      if (!(await explorer.evaluate((node) => node.closest("details")!.open)))
        await explorer.click();
    }
    await page.bringToFront();
    const startButton = panel.getByRole("button", { name: "Start navigation" });
    await expect(startButton).toBeEnabled();
    await startButton.evaluate((e) => (e as HTMLButtonElement).click());
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
