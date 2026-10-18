import browserTools from "../../config/testing/browser-tools.json" with { type: "json" };
import { Builder, By, until } from "selenium-webdriver";
import chrome from "selenium-webdriver/chrome.js";
import edge from "selenium-webdriver/edge.js";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { attachWebDriverExtension } from "./webdriver-extension";
import {
  assertFixtureUrl,
  fixtureOnlySeleniumNetwork,
} from "./selenium-network";
export async function openBrandedExtension(
  name: "chrome" | "edge" | "brave",
  url: string,
) {
  assertFixtureUrl(url);
  const options = name === "edge" ? new edge.Options() : new chrome.Options();
  options.addArguments(
    "--headless=new",
    "--enable-unsafe-extension-debugging",
    "--remote-debugging-pipe",
  );
  options.set("webSocketUrl", true);
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
  }
  const builder = new Builder().forBrowser(
    name === "edge" ? "MicrosoftEdge" : "chrome",
  );
  if (name === "edge") builder.setEdgeOptions(options as edge.Options);
  else builder.setChromeOptions(options as chrome.Options);
  const driver = await builder.build();
  try {
    await driver.manage().setTimeouts({ script: 35000, pageLoad: 30000 });
    const installed = await (
      driver as typeof driver & {
        installWebExtension(path: string): Promise<{ id: string }>;
      }
    ).installWebExtension(resolve("dist/extension"));
    await driver.get(url);
    const website = await driver.getWindowHandle();
    await driver.switchTo().newWindow("tab");
    const panel = await driver.getWindowHandle();
    await driver.get("chrome-extension://" + installed.id + "/sidepanel.html");
    await driver.wait(until.elementLocated(By.css(".tholi-app")), 10000);
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
    return await attachWebDriverExtension(
      driver,
      website,
      panel,
      tabId,
      url,
      await fixtureOnlySeleniumNetwork(driver, [website, panel]),
    );
  } catch (error) {
    await driver.quit().catch(() => {});
    throw error;
  }
}
