import type { CDPSession, Page } from "@playwright/test";

const downloadRoots = new WeakMap<Page, string>();

interface SidebarTabHarness {
  hold: () => Promise<void>;
  release: () => void;
}

/** A headless extension tab must keep the website context of a native sidebar. */
export async function installSidebarTabHarness(
  panel: Page,
  downloadsPath: string,
) {
  downloadRoots.set(panel, downloadsPath);
  await panel.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let website: any;
    chrome.runtime.sendMessage = (async (message: any) => {
      const atRead = website;
      const reply = await send(message);
      return message?.type === "GET_CONTEXT"
        ? website || atRead || reply
        : reply;
    }) as typeof chrome.runtime.sendMessage;
    (
      globalThis as typeof globalThis & { __tholiSidebarTab: SidebarTabHarness }
    ).__tholiSidebarTab = {
      async hold() {
        const context = await send({ type: "GET_CONTEXT" });
        if (!context.routes?.length || context.tabId !== context.session?.tabId)
          throw new Error("The active website must own the current session.");
        website = context;
      },
      release() {
        website = undefined;
      },
    };
  });
}

/** Use real foreground input for browser downloads, without switching the task. */
export async function withSidebarTabForeground<T>(
  panel: Page,
  page: Page,
  action: () => Promise<T>,
): Promise<T> {
  await page.bringToFront();
  await panel.evaluate(() =>
    (
      globalThis as typeof globalThis & { __tholiSidebarTab: SidebarTabHarness }
    ).__tholiSidebarTab.hold(),
  );
  let cdp: CDPSession | undefined;
  try {
    await panel.bringToFront();
    const downloadPath = downloadRoots.get(panel);
    if (!downloadPath)
      throw new Error("Missing disposable download directory.");
    cdp = await panel.context().newCDPSession(panel);
    // Bind the native download override to this exact disposable context.
    // The default CDP context need not own a persistent extension tab.
    const { targetInfo } = await cdp.send("Target.getTargetInfo");
    await cdp.send("Browser.setDownloadBehavior", {
      behavior: "allowAndName",
      browserContextId: targetInfo.browserContextId,
      downloadPath,
      eventsEnabled: true,
    });
    return await action();
  } finally {
    await cdp?.detach().catch(() => {});
    await page.bringToFront().catch(() => {});
    await panel
      .evaluate(() =>
        (
          globalThis as typeof globalThis & {
            __tholiSidebarTab: SidebarTabHarness;
          }
        ).__tholiSidebarTab.release(),
      )
      .catch(() => {});
  }
}
