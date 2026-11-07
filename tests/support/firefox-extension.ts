import browserTools from "../../config/testing/browser-tools.json" with { type: "json" };
import {
  registerFirefoxDriver,
  closeFirefoxDriver,
} from "./native-browser-lifecycle";
import {
  attachWebDriverExtension,
  seleniumBidi,
  setNativeViewport,
  findWebDriverWindow,
} from "./webdriver-extension";
import {
  assertFixtureUrl,
  fixtureOnlySeleniumNetwork,
} from "./selenium-network";
import { permissionVariant } from "./permission-variant";
import { waitForWelcomeInstallation } from "./webdriver-welcome";
import { Builder, By, until, type WebDriver } from "selenium-webdriver";
import firefox from "selenium-webdriver/firefox.js";
import { randomUUID } from "node:crypto";
import {
  installedBrowserBinary,
  nativeBrowserScale,
  resolveBrowserTools,
} from "./browser-tools";
export function firefoxBinary() {
  return installedBrowserBinary("firefox");
}
export async function openFirefoxExtension(
  url = "http://127.0.0.1:5173/",
  viewport = { width: 1280, height: 900 },
  fixtureDataCollection: readonly string[] = [],
) {
  assertFixtureUrl(url);
  const extension = await permissionVariant([], {
    target: "firefox",
    dataCollection: fixtureDataCollection,
  });
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
  const scale = nativeBrowserScale();
  if (scale !== undefined)
    options.setPreference("layout.css.devPixelsPerPx", String(scale));
  const binary = firefoxBinary();
  const paths = resolveBrowserTools({
    browser: "firefox",
    binary,
    driver: process.env.THOLI_GECKODRIVER,
    driverVersion: browserTools.geckodriverVersion,
  });
  options.setBinary(paths.browserPath);
  // Chrome context is used only to load an extension-owned test tab. It does
  // not change the add-on's permissions, content-script world, or manifest.
  const driver = (await new Builder()
    .forBrowser("firefox")
    .setFirefoxOptions(options)
    .setFirefoxService(
      new firefox.ServiceBuilder(paths.driverPath).addArguments(
        "--allow-system-access",
      ),
    )
    .build()) as firefox.Driver;
  await registerFirefoxDriver(driver);
  try {
    await setNativeViewport(driver, viewport);
    await driver.manage().setTimeouts({ script: 35000, pageLoad: 30000 });
    // BiDi installs the local unpacked directory. The deprecated classic API
    // ZIPs/base64-encodes every model asset in memory before sending it again.
    const installed = await (
      await seleniumBidi(driver)
    ).send({
      method: "webExtension.install",
      params: {
        extensionData: {
          type: "path",
          path: extension,
        },
      },
    });
    if (
      installed.error ||
      installed.result?.extension !== "tholi@ilunonsen.com"
    )
      throw Error(
        installed.message ||
          "Firefox did not install the expected local extension.",
      );
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
    const panel = await driver.wait(
      () =>
        findWebDriverWindow(
          driver,
          "moz-extension://" + uuid + "/sidepanel.html",
        ),
      10_000,
      "The exact packaged Firefox sidebar tab is available",
    );
    if (!panel) throw Error("The packaged Firefox sidebar is missing.");
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
    const app = await attachWebDriverExtension(
      driver,
      website,
      panel,
      tabId,
      url,
      finishNetwork,
      () => closeFirefoxDriver(driver),
    );
    await waitForWelcomeInstallation(app);
    return {
      ...app,
      driver,
    };
  } catch (error) {
    await closeFirefoxDriver(driver);
    throw error;
  }
}
export type FirefoxApp = Awaited<ReturnType<typeof openFirefoxExtension>>;

/** Pregrant only explicit fixture permissions in the owned disposable Firefox. */
export async function grantFirefoxFixturePermissions(
  driver: firefox.Driver,
  permissions: { origins?: string[]; data_collection?: readonly string[] },
) {
  await driver.setContext(firefox.Context.CHROME);
  try {
    return await driver.executeAsyncScript<boolean>(function (
      requested: { origins?: string[]; data_collection?: string[] },
      done: (result: boolean) => void,
    ) {
      // https://searchfox.org/firefox-main/source/toolkit/components/extensions/ExtensionPermissions.sys.mjs
      const { ExtensionPermissions } = (
        globalThis as any
      ).ChromeUtils.importESModule(
        "resource://gre/modules/ExtensionPermissions.sys.mjs",
      );
      const extension = (globalThis as any).WebExtensionPolicy.getByID(
        "tholi@ilunonsen.com",
      )?.extension;
      if (!extension) return done(false);
      ExtensionPermissions.add(
        "tholi@ilunonsen.com",
        {
          permissions: [],
          origins: requested.origins || [],
          data_collection: requested.data_collection || [],
        },
        extension,
      ).then(
        () => done(true),
        () => done(false),
      );
    }, permissions);
  } finally {
    await driver.setContext(firefox.Context.CONTENT);
  }
}
export { By, until, type WebDriver };
