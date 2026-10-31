import { permissionVariant } from "./permission-variant";
import { prepareChromiumProfile } from "./chromium-profile";
import { installSidebarTabHarness } from "./sidebar-tab";
import {
  chromium,
  expect,
  test,
  type BrowserContext,
  type Worker,
  type Page,
} from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, sep, basename } from "node:path";
export async function openNavigatorExtension(
  viewport = { width: 1280, height: 900 },
  fixturePermissions: string[] = [],
  options: {
    nativeViewport?: boolean;
    allowAutomaticDownloads?: boolean;
    persistentPermissions?: boolean;
    standalone?: boolean;
  } = {},
) {
  const directory = await mkdtemp(join(tmpdir(), "navigator-e2e-"));
  const extension = await permissionVariant(fixturePermissions, {
    persistent: options.persistentPermissions,
  });
  const { profilePath, downloadsPath, launchArgs } =
    await prepareChromiumProfile(directory, options);
  const launch = () =>
    chromium.launchPersistentContext(profilePath, {
      channel: "chromium",
      headless: true,
      acceptDownloads: true,
      downloadsPath,
      args: [
        ...launchArgs,
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
    await installSidebarTabHarness(panel, options.allowAutomaticDownloads);
    await panel.goto(
      "chrome-extension://" + new URL(worker.url()).host + "/sidepanel.html",
    );
    if (!options.nativeViewport)
      await panel.setViewportSize({ width: 380, height: 1000 });
  };
  /** Invoke the native action and measure real content geometry, without viewport emulation. */
  const prepareNativeAction = async () => {
    if (!options.nativeViewport || page.viewportSize() !== null)
      throw Error(
        "Native action setup requires an un-emulated browser viewport.",
      );
    await page.bringToFront();
    const browserSession = await context.browser()!.newBrowserCDPSession();
    try {
      const targets = await browserSession.send("Target.getTargets", {
        filter: [{ type: "tab", exclude: false }, { exclude: true }],
      });
      const candidates = targets.targetInfos.filter(
        (target) => target.type === "tab" && target.url === page.url(),
      );
      if (candidates.length !== 1)
        throw Error("The exact fixture tab target is unavailable.");
      await browserSession.send("Extensions.triggerAction", {
        id: new URL(worker.url()).host,
        targetId: candidates[0].targetId,
      });
    } finally {
      await browserSession.detach();
    }
    const pageSession = await context.newCDPSession(page);
    let stable = 0;
    try {
      // Native side-panel opening changes the content area. Resize the real
      // owned window and read it back; never replace browser viewport metadata.
      await expect
        .poll(
          async () => {
            const actual = await page.evaluate(() => ({
              width: innerWidth,
              height: innerHeight,
            }));
            if (
              actual.width === viewport.width &&
              actual.height === viewport.height
            )
              return ++stable >= 3;
            stable = 0;
            const { windowId, bounds } = await pageSession.send(
              "Browser.getWindowForTarget",
            );
            if (
              bounds.width === undefined ||
              bounds.height === undefined ||
              bounds.windowState !== "normal"
            )
              throw Error(
                "A normal owned browser window is required for native geometry.",
              );
            await pageSession.send("Browser.setWindowBounds", {
              windowId,
              bounds: {
                width: bounds.width + viewport.width - actual.width,
                height: bounds.height + viewport.height - actual.height,
              },
            });
            return false;
          },
          { timeout: 5000, intervals: [100, 100, 100] },
        )
        .toBe(true);
    } finally {
      await pageSession.detach();
    }
    await page.bringToFront();
    const actual = await page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
      devicePixelRatio,
      visualWidth: visualViewport?.width,
      visualHeight: visualViewport?.height,
      visualScale: visualViewport?.scale,
      visualOffsetLeft: visualViewport?.offsetLeft,
      visualOffsetTop: visualViewport?.offsetTop,
    }));
    if (
      actual.width !== viewport.width ||
      actual.height !== viewport.height ||
      actual.visualWidth !== viewport.width ||
      actual.visualHeight !== viewport.height ||
      actual.visualScale !== 1 ||
      actual.visualOffsetLeft !== 0 ||
      actual.visualOffsetTop !== 0
    )
      throw Error(
        "Native content geometry does not match the declared viewport.",
      );
    return actual;
  };
  const openDetails = async () => {
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
  };
  const view = async () => {
    return panel.evaluate(async () => {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        return await Promise.race([
          chrome.runtime
            .sendMessage({ type: "GET_SESSION" })
            .then((reply) => reply?.view),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(Error("Session read exceeded five seconds")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    });
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
    // A running worker can precede the UI command response. Do not let a test
    // programmatically click the disabled composer during that interval.
    await expect(
      panel.getByRole("button", { name: "Pause navigation", exact: true }),
    ).toBeEnabled();
  };
  const stop = () =>
    panel.evaluate(
      async () => await chrome.runtime.sendMessage({ type: "STOP" }),
    );
  const dispose = async (operation: () => Promise<void>) => {
    const info = options.standalone ? undefined : test.info(),
      bodyBudget = info?.timeout,
      started = performance.now();
    const cleanupBudget = 30000;
    // Profile/trace disposal is infrastructure work. Keep the original body
    // deadline and allow only the time actually spent in bounded cleanup.
    if (info && bodyBudget) info.setTimeout(bodyBudget + cleanupBudget);
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        operation(),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(Error("Browser profile disposal exceeded thirty seconds")),
            cleanupBudget,
          );
        }),
      ]);
    } finally {
      clearTimeout(timer);
      const elapsedMs = performance.now() - started;
      if (info && bodyBudget)
        info.setTimeout(bodyBudget + Math.min(elapsedMs, cleanupBudget));
      await info?.attach("browser-disposal", {
        body: Buffer.from(JSON.stringify({ elapsedMs, cleanupBudget })),
        contentType: "application/json",
      });
    }
  };
  const close = () =>
    dispose(async () => {
      await context?.close();
      const target = resolve(directory);
      if (
        !target.startsWith(resolve(tmpdir()) + sep) ||
        !basename(target).startsWith("navigator-e2e-")
      )
        throw new Error("Unsafe temporary cleanup target");
      await rm(target, { recursive: true, force: true });
    });
  const restart = async () => {
    await dispose(() => context.close());
    await initialize();
  };
  try {
    await initialize();
  } catch (error) {
    // Callers cannot run their finally block until this factory returns. Close
    // a partly initialized profile here too, so failed startup cannot strand it.
    try {
      await close();
    } catch (cleanup) {
      throw new AggregateError(
        [error, cleanup],
        "Extension startup and cleanup failed",
      );
    }
    throw error;
  }
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
    openDetails,
    start,
    prepareNativeAction,
    stop,
    close,
    restart,
  };
}
