import browserTools from "../../config/testing/browser-tools.json" with { type: "json" };
import {
  registerFirefoxDriver,
  closeFirefoxDriver,
} from "./native-browser-lifecycle";
import { attachWebDriverExtension } from "./webdriver-extension";
import {
  assertFixtureUrl,
  fixtureOnlySeleniumNetwork,
} from "./selenium-network";
import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";
export function firefoxBinary() {
  if (process.env.THOLI_FIREFOX_BINARY) return process.env.THOLI_FIREFOX_BINARY;
  if (process.platform === "win32")
    for (const root of ["HKCU", "HKLM"]) {
      try {
        const result = execFileSync(
          "reg.exe",
          [
            "query",
            root +
              "\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\App Paths\\firefox.exe",
            "/ve",
          ],
          { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
        );
        const path = result.match(/REG_SZ\s+(.+)/)?.[1].trim();
        if (path && existsSync(path)) return path;
      } catch {
        /* Selenium Manager remains the explicit fallback. */
      }
    }
}
export async function openFirefoxExtension(
  url = "http://127.0.0.1:5173/",
  viewport = { width: 1280, height: 900 },
) {
  assertFixtureUrl(url);
  const uuid = randomUUID(),
    options = new firefox.Options()
      .addArguments("-headless")
      .setPreference(
        "extensions.webextensions.uuids",
        JSON.stringify({ "tholi@ilunonsen.com": uuid }),
      )
      .setPreference("browser.shell.checkDefaultBrowser", false)
      .setPreference("browser.aboutwelcome.enabled", false)
      .setPreference("browser.startup.homepage_override.mstone", "ignore");
  options.set("webSocketUrl", true);
  const binary = firefoxBinary();
  const manager = resolve(
    "node_modules/selenium-webdriver/bin/windows/selenium-manager.exe",
  );
  const paths = JSON.parse(
    execFileSync(
      manager,
      [
        "--browser",
        "firefox",
        "--driver-version",
        browserTools.geckodriverVersion,
        "--output",
        "json",
        "--avoid-stats",
        ...(binary ? ["--browser-path", binary] : []),
      ],
      { encoding: "utf8" },
    ),
  ).result;
  options.setBinary(binary || paths.browser_path);
  // Chrome context is used only to load an extension-owned test tab. It does
  // not change the add-on's permissions, content-script world, or manifest.
  const driver = (await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(
      new firefox.ServiceBuilder(
        process.env.THOLI_GECKODRIVER || paths.driver_path,
      ).addArguments("--allow-system-access"),
    )
    .build()) as firefox.Driver;
  await registerFirefoxDriver(driver);
  try {
    await driver.manage().window().setRect(viewport);
    // WebDriver rect is the outer window; acceptance contracts specify CSS viewport pixels.
    const inset = await driver.executeScript<{ x: number; y: number }>(() => ({
      x: outerWidth - innerWidth,
      y: outerHeight - innerHeight,
    }));
    await driver
      .manage()
      .window()
      .setRect({
        width: viewport.width + inset.x,
        height: viewport.height + inset.y,
      });
    await driver.manage().setTimeouts({ script: 35000, pageLoad: 30000 });
    await driver.installAddon(resolve("dist/extension-firefox"), true);
    await driver.get(url);
    const website = await driver.getWindowHandle();
    await driver.setContext(firefox.Context.CHROME);
    await driver.executeScript(
      function (extensionUrl: string) {
        const scope = globalThis as any;
        const tab = scope.gBrowser.addTab(extensionUrl, {
          triggeringPrincipal:
            scope.Services.scriptSecurityManager.getSystemPrincipal(),
        });
        scope.gBrowser.selectedTab = tab;
      },
      "moz-extension://" + uuid + "/sidepanel.html",
    );
    await driver.setContext(firefox.Context.CONTENT);
    const handles = await driver.getAllWindowHandles(),
      panel = handles[handles.length - 1];
    await driver.switchTo().window(panel);
    await driver.wait(until.elementLocated(By.css(".tholi-app")), 10000);
    const tabId = await driver.executeAsyncScript<number>(function (
      websiteUrl: string,
      done: (id: number) => void,
    ) {
      (globalThis as any).browser.tabs
        .query({})
        .then((tabs: any[]) =>
          done(tabs.find((tab) => tab.url === websiteUrl)?.id ?? -1),
        );
    }, url);
    // Gecko BiDi rejects privileged extension contexts. Intercept the real website;
    // extension-local workers are separately constrained by packaged CSP and asset tests.
    const finishNetwork = await fixtureOnlySeleniumNetwork(driver, [website]);
    if (tabId < 0) throw Error("Firefox fixture tab not found: " + url);
    return {
      ...(await attachWebDriverExtension(
        driver,
        website,
        panel,
        tabId,
        url,
        finishNetwork,
        () => closeFirefoxDriver(driver),
      )),
      driver,
    };
  } catch (error) {
    await closeFirefoxDriver(driver);
    throw error;
  }
}
export type FirefoxApp = Awaited<ReturnType<typeof openFirefoxExtension>>;
export { By, until, type WebDriver };
