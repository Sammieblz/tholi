import { readFile } from "node:fs/promises";
import { deterministicNetwork } from "./browser-test";
import type { Page } from "@playwright/test";

const downloadProfiles = new WeakSet<Page>();

interface SidebarTabHarness {
  hold: () => Promise<void>;
  release: () => void;
}

/** A headless extension tab must keep the website context of a native sidebar. */
export async function installSidebarTabHarness(
  panel: Page,
  allowAutomaticDownloads = false,
) {
  await deterministicNetwork(panel.context());
  if (allowAutomaticDownloads) downloadProfiles.add(panel);
  await panel.addInitScript(() => {
    const send = chrome.runtime.sendMessage.bind(chrome.runtime);
    let website: any;
    chrome.runtime.sendMessage = ((
      message: any,
      callback?: (reply: any) => void,
    ) => {
      const atRead = website,
        win = globalThis as any;
      const counter = win.__slowReads && win.__polling?.[message?.type];
      if (counter) {
        counter.calls++;
        counter.active++;
        counter.max = Math.max(counter.max, counter.active);
      }
      const result = send(message)
        .then(async (reply) => {
          if (counter)
            await new Promise((resolve) =>
              setTimeout(resolve, message.type === "GET_CONTEXT" ? 1500 : 3000),
            );
          return message?.type === "GET_CONTEXT"
            ? website || atRead || reply
            : reply;
        })
        .finally(() => {
          if (counter) counter.active--;
        });
      if (typeof callback === "function") {
        void result.then(callback);
        return;
      }
      return result;
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

/** Read the real completed export from the explicitly pregranted test profile. */
export async function downloadFromSidebar(
  panel: Page,
  page: Page,
  activate: () => Promise<unknown>,
): Promise<Buffer> {
  if (!downloadProfiles.has(panel))
    throw Error(
      "Export checks require a pregranted disposable download profile.",
    );
  await page.bringToFront();
  await panel.evaluate(() =>
    (
      globalThis as typeof globalThis & { __tholiSidebarTab: SidebarTabHarness }
    ).__tholiSidebarTab.hold(),
  );
  try {
    await panel.bringToFront();
    await panel.waitForFunction(() => document.hasFocus(), undefined, {
      timeout: 5000,
    });
    const [download] = await Promise.all([
      panel.waitForEvent("download", { timeout: 30000 }),
      activate(),
    ]);
    const file = await download.path();
    if (!file) throw Error("The export did not complete a browser download.");
    return await readFile(file);
  } finally {
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
