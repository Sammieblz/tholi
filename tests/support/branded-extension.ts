import browserTools from "../../config/testing/browser-tools.json" with { type: "json" };
import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import edge from "selenium-webdriver/edge.js";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { resolve } from "node:path";
import { attachWebDriverExtension, seleniumBidi } from "./webdriver-extension";
import {
  assertFixtureUrl,
  fixtureOnlySeleniumNetwork,
} from "./selenium-network";
import { permissionVariant } from "./permission-variant";

export async function openBrandedExtension(
  name: "chrome" | "edge" | "brave",
  url: string,
  fixturePermissions: string[] = [],
) {
  assertFixtureUrl(url);
  const options = name === "edge" ? new edge.Options() : new chrome.Options();
  const nativeIdentity =
    name === "chrome" && process.env.THOLI_BROWSER_GROUP === "identity";
  options.addArguments(
    "--headless=new",
    "--enable-unsafe-extension-debugging",
    "--remote-debugging-pipe",
  );
  options.set("webSocketUrl", true);
  const builder = new Builder().forBrowser(
    name === "edge" ? "MicrosoftEdge" : "chrome",
  );
  if (name === "brave") {
    const binary =
      process.env.THOLI_BRAVE_BINARY ||
      resolve(
        "output/browser-tools/brave",
        browserTools.brave.version,
        "brave.exe",
      );
    if (!existsSync(binary))
      throw Error(
        "Brave is required for branded verification. Set THOLI_BRAVE_BINARY or fetch the pinned portable browser.",
      );
    (options as chrome.Options).setChromeBinaryPath(binary);
    // Hosted runners put Chrome's driver on PATH. Resolve Brave's own engine
    // instead, which can be a different Chromium major from installed Chrome.
    const paths = JSON.parse(
      execFileSync(
        resolve(
          "node_modules/selenium-webdriver/bin/windows/selenium-manager.exe",
        ),
        [
          "--browser",
          "chrome",
          "--browser-path",
          binary,
          "--skip-driver-in-path",
          "--output",
          "json",
          "--avoid-stats",
        ],
        { encoding: "utf8" },
      ),
    ).result;
    builder.setChromeService(new chrome.ServiceBuilder(paths.driver_path));
  }
  if (name === "edge") builder.setEdgeOptions(options as edge.Options);
  else builder.setChromeOptions(options as chrome.Options);
  const driver = await builder.build();
  try {
    await driver.manage().setTimeouts({ script: 35000, pageLoad: 30000 });
    const installed = await (
      driver as typeof driver & {
        installWebExtension(path: string): Promise<{ id: string }>;
      }
    ).installWebExtension(await permissionVariant(fixturePermissions));
    await driver.get(url);
    const website = await driver.getWindowHandle();
    await driver.switchTo().newWindow("tab");
    const panel = await driver.getWindowHandle();
    await driver.get("chrome-extension://" + installed.id + "/sidepanel.html");
    const application = await driver.wait(
      until.elementLocated(By.css(".tholi-app")),
      10000,
    );
    if (nativeIdentity)
      await driver.wait(until.elementIsVisible(application), 10_000);
    const tabId = await driver.executeAsyncScript<number>(function (
      url: string,
      done: (value: number) => void,
    ) {
      const api = (globalThis as any).browser || (globalThis as any).chrome;
      api.tabs
        .query({})
        .then((tabs: any[]) =>
          done(tabs.find((tab) => tab.url === url)?.id ?? -1),
        );
    }, url);
    if (tabId < 0) throw Error("Branded fixture tab missing");
    if (nativeIdentity) {
      // The mapper can pause the browser-owned auth popup and restarted worker.
      // Keep the real browser flow and use classic execution after installation.
      // https://github.com/GoogleChromeLabs/chromium-bidi/blob/main/src/bidiMapper/BidiServer.ts
      const reply = await (
        await seleniumBidi(driver)
      ).send({
        method: "goog:cdp.sendCommand",
        params: {
          method: "Target.setAutoAttach",
          params: {
            autoAttach: false,
            waitForDebuggerOnStart: false,
            flatten: true,
          },
        },
      });
      if (reply.error)
        throw Error("The native Chrome debugger attachment policy failed.");
    }
    return await attachWebDriverExtension(
      driver,
      website,
      panel,
      tabId,
      url,
      await fixtureOnlySeleniumNetwork(driver, [website, panel]),
      undefined,
      nativeIdentity ? "classic" : "bidi",
    );
  } catch (error) {
    await driver.quit().catch(() => {});
    throw error;
  }
}
