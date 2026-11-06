import { expect, type TestInfo } from "@playwright/test";
import { By, Key, until } from "selenium-webdriver";
import { Select } from "selenium-webdriver/lib/select.js";
import firefox from "selenium-webdriver/firefox.js";
import type chrome from "selenium-webdriver/chrome.js";
import { openBrandedExtension } from "./branded-extension";
import { openFirefoxExtension } from "./firefox-extension";
import { setNativeViewport } from "./webdriver-extension";
import { acceptanceServer } from "./fixture-server";
import {
  navigationServiceFixture,
  privateLearningPageHtml,
  seedNavigationServiceAccount,
} from "./navigation-service-fixture";
import backendDataPermissions from "../../config/backend-data-permissions.json" with { type: "json" };
import { luminance, parseColor } from "../../packages/ui/page-theme";

/** One native-browser flow. Every service response is loopback and the model is fake. */
export async function verifyWebDriverPrivateLearning(
  target: "chromium" | "firefox",
  info: TestInfo,
) {
  const website = await acceptanceServer({
    "/knowledge/start": privateLearningPageHtml,
    "/knowledge/help":
      '<html lang="en"><title>Help</title><body><h1 id="help-outcome">Help</h1><p>You reached Help.</p></body></html>',
  });
  const url = new URL("/knowledge/start", website.url).href;
  const service = await navigationServiceFixture(
    target === "firefox" ? "extension-firefox" : "extension-chromium",
    { customer: true, knowledge: { origin: new URL(url).origin } },
  );
  let app: Awaited<ReturnType<typeof openBrandedExtension>> | undefined;
  let failure: unknown;
  try {
    app =
      target === "firefox"
        ? await openFirefoxExtension(url, { width: 1280, height: 900 })
        : await openBrandedExtension("chrome", url, ["http://127.0.0.1/*"], {
            nativeLifecycle: true,
          });
    const current = app;
    if (target === "firefox") {
      // Preserve the shipped optional manifest. Required-permission variants
      // cannot exercise permissions.request for the same categories.
      // https://searchfox.org/firefox-main/source/toolkit/components/extensions/ExtensionPermissions.sys.mjs
      const manifest = await app.extension(() =>
        (globalThis as any).browser.runtime.getManifest(),
      );
      const optional =
        manifest.browser_specific_settings.gecko.data_collection_permissions
          .optional;
      expect(
        backendDataPermissions.every((category) => optional.includes(category)),
      ).toBe(true);
      const gecko = app.driver as firefox.Driver;
      await gecko.setContext(firefox.Context.CHROME);
      try {
        const granted = await gecko.executeAsyncScript<boolean>(function (
          categories: string[],
          done: (result: boolean) => void,
        ) {
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
              origins: [],
              data_collection: categories,
            },
            extension,
          ).then(
            () => done(true),
            () => done(false),
          );
        }, backendDataPermissions);
        expect(granted).toBe(true);
      } finally {
        await gecko.setContext(firefox.Context.CONTENT);
      }
      expect(
        await app.extension(
          (categories: string[]) =>
            (globalThis as any).browser.permissions.contains({
              data_collection: categories,
            }),
          backendDataPermissions,
        ),
      ).toBe(true);
    }
    await info.attach("browser-runtime", {
      body: Buffer.from(
        JSON.stringify({
          name: target === "firefox" ? "firefox" : "chrome",
          target,
          version: app.version,
          driverVersion: app.driverVersion,
          platform: app.platform,
          runtimePlatform: app.runtimePlatform,
        }),
      ),
      contentType: "application/json",
    });
    await seedNavigationServiceAccount(app, service.settings, target);
    await app.start();
    const panel = () => current.driver.switchTo().window(current.panel);
    const visible = async (selector: By) => {
      await panel();
      const element = await current.driver.wait(
        until.elementLocated(selector),
        10_000,
      );
      await current.driver.wait(until.elementIsVisible(element), 10_000);
      return element;
    };
    const named = (name: string) =>
      visible(By.xpath(`//button[normalize-space(.)="${name}"]`));
    const openSettings = async () => {
      await panel();
      const popovers = await current.driver.findElements(
        By.css(".tholi-settings-popup"),
      );
      if (!popovers.length || !(await popovers[0].isDisplayed()))
        await (
          await visible(By.css('button[aria-label="Tholi settings"]'))
        ).sendKeys(Key.ENTER);
      await current.waitFor(
        () =>
          current.extension(() => {
            const field = document.querySelector<HTMLFieldSetElement>(
              ".tholi-private-learning fieldset",
            );
            return !!field && !field.disabled;
          }),
        Boolean,
        "The acknowledged private-learning choices are ready",
      );
    };
    await openSettings();
    await (await named("Refresh AI connections")).sendKeys(Key.ENTER);
    const selector = await visible(By.css("#tholi-provider-choice"));
    await current.driver.wait(
      async () => (await selector.findElements(By.css("option"))).length === 2,
      10_000,
    );
    // Use WebDriver's native option selection instead of assuming that the
    // platform commits a closed select after the same arrow-key sequence.
    await new Select(selector).selectByValue(service.provider.id);
    if ((await selector.getAttribute("value")) !== service.provider.id)
      throw Error("The native provider selection was not acknowledged.");
    const chooseProvider = await named("Use selected provider");
    await current.driver.wait(
      until.elementIsEnabled(chooseProvider),
      10_000,
      "The selected provider action remained disabled after native selection.",
    );
    await chooseProvider.sendKeys(Key.ENTER);
    await current.waitFor(
      async () => {
        const error = await current.extension(() => {
          const element = document.getElementById("tholi-account-error");
          return element && !element.hidden ? element.textContent : "";
        });
        if (error) throw Error("Provider selection failed: " + error);
        return current.message({ type: "AUTH_INFERENCE_STATUS" });
      },
      (value) => value.enabled && value.profile === "customer-funded",
      "An explicit current provider selection is acknowledged",
    );
    await current.waitFor(
      () =>
        current.extension(
          () =>
            !document.querySelector<HTMLFieldSetElement>(
              ".tholi-provider-selection",
            )?.disabled,
        ),
      Boolean,
      "Account controls finish the provider update",
    );
    const inputs = await current.driver.findElements(
      By.css('.tholi-private-learning input[type="checkbox"]'),
    );
    expect(inputs).toHaveLength(2);
    expect(await inputs[0].isSelected()).toBe(false);
    expect(await inputs[1].isSelected()).toBe(false);
    await inputs[1].sendKeys(Key.SPACE);
    await current.waitFor(
      async () => service.siteSettings?.use,
      Boolean,
      "Website reuse is an explicit separate choice",
    );
    await current.waitFor(
      () =>
        current.extension(
          () =>
            !document.querySelector<HTMLFieldSetElement>(
              ".tholi-private-learning fieldset",
            )?.disabled,
        ),
      Boolean,
      "Learning settings are acknowledged",
    );
    // Request only OS-level media emulation in the disposable native browser.
    if (target === "firefox") {
      const driver = current.driver as firefox.Driver;
      await driver.setContext(firefox.Context.CHROME);
      try {
        await driver.executeScript(() =>
          (globalThis as any).Services.prefs.setIntPref(
            "ui.prefersReducedMotion",
            1,
          ),
        );
      } finally {
        await driver.setContext(firefox.Context.CONTENT);
      }
    } else {
      await (current.driver as chrome.Driver).sendDevToolsCommand(
        "Emulation.setEmulatedMedia",
        { features: [{ name: "prefers-reduced-motion", value: "reduce" }] },
      );
    }
    await current.waitFor(
      () =>
        current.extension(
          () => matchMedia("(prefers-reduced-motion: reduce)").matches,
        ),
      Boolean,
      "The native browser observes reduced motion",
    );
    const layouts: unknown[] = [];
    for (const theme of ["light", "dark"] as const) {
      await current.site((theme: string) => {
        document.documentElement.style.background =
          theme === "light" ? "#111111" : "#ffffff";
        document.body.style.background =
          theme === "light" ? "#111111" : "#ffffff";
        document.body.style.color = theme === "light" ? "#ffffff" : "#111111";
      }, theme);
      await current.waitFor(
        () =>
          current.extension(() => document.documentElement.dataset.tholiTheme),
        (value) => value === theme,
        "The automatic contrast theme follows the website",
      );
      // Firefox enforces a 500px native window minimum for this extension
      // context. Chrome's 375px case is explicitly a CSS viewport emulation.
      for (const width of [target === "firefox" ? 500 : 375, 640, 960, 1280]) {
        await panel();
        if (target === "chromium") {
          // Headless Chrome has a minimum outer-window width. Emulate the
          // panel CSS viewport while retaining native extension identity.
          await (current.driver as chrome.Driver).sendDevToolsCommand(
            "Emulation.clearDeviceMetricsOverride",
            {},
          );
          await setNativeViewport(current.driver, {
            width: Math.max(600, width),
            height: 900,
          });
          await (current.driver as chrome.Driver).sendDevToolsCommand(
            "Emulation.setDeviceMetricsOverride",
            { width, height: 900, deviceScaleFactor: 0, mobile: false },
          );
        } else {
          await setNativeViewport(current.driver, { width, height: 900 });
        }
        await openSettings();
        const control = await visible(
          By.css('.tholi-private-learning input[type="checkbox"]'),
        );
        await control.sendKeys(Key.TAB);
        const keyboardFocus = await current.extension(() => {
          const section = document.querySelector<HTMLElement>(
            ".tholi-private-learning",
          )!;
          const active = document.activeElement as HTMLElement;
          const focus = getComputedStyle(active);
          return {
            focused: section.contains(active),
            outline: focus.outlineStyle,
            outlineWidth: parseFloat(focus.outlineWidth),
          };
        });
        // The synthetic panel is a tab. Restore the actual pinned website as
        // active before its normal appearance reader samples the page tone.
        await current.site(() => document.title);
        await current.waitFor(
          () =>
            current.extension(
              () => document.documentElement.dataset.tholiTheme,
            ),
          (value) => value === theme,
          "The page-derived theme settles after native panel interaction",
        );
        const dimensions = await current.extension(() => {
          const section = document.querySelector<HTMLElement>(
            ".tholi-private-learning",
          )!;
          const popup = document.querySelector<HTMLElement>(
            ".tholi-settings-popup",
          )!;
          return {
            viewport: innerWidth,
            theme: document.documentElement.dataset.tholiTheme,
            overflow:
              document.documentElement.scrollWidth > innerWidth + 1 ||
              popup.scrollWidth > popup.clientWidth + 1,
            targets: [...section.querySelectorAll("label,button")].map(
              (element) => element.getBoundingClientRect().height,
            ),
            foreground: getComputedStyle(section).color,
            background: getComputedStyle(popup).backgroundColor,
            reduced: matchMedia("(prefers-reduced-motion: reduce)").matches,
          };
        });
        const layout = { ...dimensions, ...keyboardFocus };
        expect(layout.viewport).toBe(width);
        expect(layout.theme).toBe(theme);
        expect(layout.overflow).toBe(false);
        expect(layout.targets.every((height: number) => height >= 44)).toBe(
          true,
        );
        expect(layout.focused).toBe(true);
        expect(layout.outline).not.toBe("none");
        expect(layout.outlineWidth).toBeGreaterThanOrEqual(2);
        expect(layout.reduced).toBe(true);
        const colors = [
          parseColor(layout.foreground),
          parseColor(layout.background),
        ];
        expect(colors.every(Boolean)).toBe(true);
        const levels = colors
          .map((color) => luminance(color!))
          .sort((a, b) => a - b);
        expect((levels[1] + 0.05) / (levels[0] + 0.05)).toBeGreaterThanOrEqual(
          4.5,
        );
        layouts.push(layout);
      }
    }
    if (target === "chromium") {
      await panel();
      await (current.driver as chrome.Driver).sendDevToolsCommand(
        "Emulation.clearDeviceMetricsOverride",
        {},
      );
    }
    await setNativeViewport(current.driver, { width: 1280, height: 900 });
    await panel();
    await current.driver.actions().sendKeys(Key.ESCAPE).perform();
    await current.goal("Find Help");
    const proposed = await current.waitFor(
      () => current.view(),
      (view) =>
        view.serviceNavigation?.state === "guiding" &&
        view.serviceNavigation.message?.includes("No model request") &&
        view.page?.controls.find(
          (control: any) => control.id === view.selectedControlId,
        )?.label === "Settings",
      "Compatible private knowledge binds a fresh native Settings control",
      30_000,
    );
    expect(proposed.verifiedSteps).toBe(0);
    expect(service.decisions).toHaveLength(0);
    expect(service.knowledgeQueries.length).toBeGreaterThanOrEqual(2);
    const initialDocument = (await current.message({ type: "GET_SESSION" }))
      .documentId;
    expect(initialDocument).toBeTruthy();
    await current.site(() => document.title);
    await current.driver.findElement(By.id("settings")).click();
    const verified = await current.waitFor(
      () => current.view(),
      (view) => view.verifiedSteps >= 1,
      "An actual reveal, rather than the proposal, establishes a verified step",
    );
    expect(
      await current.site(() =>
        document.getElementById("settings")?.getAttribute("aria-expanded"),
      ),
    ).toBe("true");
    expect(verified.goalPlan.status).not.toBe("completed");
    // The user's native pointer action must reach the independent DOM outcome.
    await current.driver
      .actions()
      .move({ origin: await current.driver.findElement(By.id("help")) })
      .click()
      .perform();
    await current.waitFor(
      () =>
        current.site(
          () => document.getElementById("help-outcome")?.textContent,
        ),
      (value) => value === "Help",
      "The independent DOM task outcome is reached by the user's real navigation",
    );
    const known = {
      completedTasksByDom: 1,
      verifiedReveals: verified.verifiedSteps,
      decisions: service.decisions.length,
      liveProviderCalls: 0,
      liveProviderTokens: 0,
    };
    expect(known.decisions).toBe(0);
    await current.message({ type: "STOP" });
    await current.visit(url);
    await current.start();
    await current.site(() => {
      document.getElementById("settings")!.textContent = "Account";
    });
    await current.goal("Find Help");
    await current.waitFor(
      async () => service.decisions.length,
      (value) => value === 1,
      "Changed structure requires a bounded fake inference fallback",
    );
    expect(service.decisions[0].input.profile).toBe("customer-funded");
    expect(service.decisions[0].input.observation.native.documentId).not.toBe(
      initialDocument,
    );
    service.decisions[0].release();
    await current.waitFor(
      () => current.view(),
      (view) => view.serviceNavigation?.state === "guiding",
      "The fixture fallback binds through the shared native join",
    );
    await openSettings();
    const remembered = await current.driver.findElements(
      By.css('.tholi-private-learning input[type="checkbox"]'),
    );
    await remembered[1].sendKeys(Key.SPACE);
    await current.waitFor(
      async () => service.siteSettings?.use === false,
      Boolean,
      "Reuse is paused separately from provider processing",
    );
    await current.waitFor(
      () =>
        current.extension(
          () =>
            !document.querySelector<HTMLFieldSetElement>(
              ".tholi-private-learning fieldset",
            )?.disabled,
        ),
      Boolean,
      "The pause has been acknowledged",
    );
    await (await named("Forget cloud knowledge")).sendKeys(Key.ENTER);
    const dialog = await visible(By.css('[role="alertdialog"]'));
    await dialog
      .findElement(By.xpath('.//button[normalize-space(.)="Cancel"]'))
      .sendKeys(Key.ENTER);
    expect(service.siteWrites.some((write) => write.method === "DELETE")).toBe(
      false,
    );
    await (await named("Forget cloud knowledge")).sendKeys(Key.ENTER);
    const confirmed = await visible(By.css('[role="alertdialog"]'));
    await confirmed
      .findElement(
        By.xpath('.//button[normalize-space(.)="Forget cloud knowledge"]'),
      )
      .sendKeys(Key.ENTER);
    await current.waitFor(
      async () => service.siteWrites.some((write) => write.method === "DELETE"),
      Boolean,
      "Cloud forgetting requires explicit confirmation",
    );
    await openSettings();
    const local = await visible(By.css('input[type="radio"][value="local"]'));
    await local.sendKeys(Key.SPACE);
    await current.waitFor(
      () => current.message({ type: "AUTH_INFERENCE_STATUS" }),
      (value) => !value.enabled,
      "Local processing is acknowledged",
    );
    const counts = [service.decisions.length, service.knowledgeQueries.length];
    await panel();
    await current.driver.actions().sendKeys(Key.ESCAPE).perform();
    await current.goal("Find the amber compass");
    expect([service.decisions.length, service.knowledgeQueries.length]).toEqual(
      counts,
    );
    expect(service.failures).toEqual([]);
    await info.attach("private-learning-native", {
      body: Buffer.from(
        JSON.stringify({
          target,
          panelViewportEmulated: target === "chromium",
          viewportAdapter: target === "chromium" ? "CDP" : "native window",
          keyboardFocusMeasuredWhilePanelActive: true,
          layouts,
          known,
          changedStructure: {
            fakeDecisions: 1,
            liveProviderCalls: 0,
            liveProviderTokens: 0,
          },
          localStoppedNewRequests: true,
          syntheticAccount: true,
          fixturePregrants: true,
          nativePermissionPrompt: "pending",
          realSignIn: "pending",
        }),
      ),
      contentType: "application/json",
    });
  } catch (error) {
    failure = error;
    throw error;
  } finally {
    const cleanup = await Promise.allSettled([
      app?.close(),
      service.close(),
      website.close(),
    ]);
    const errors = cleanup.flatMap((result) =>
      result.status === "rejected" ? [result.reason] : [],
    );
    if (errors.length)
      throw new AggregateError(
        failure === undefined ? errors : [failure, ...errors],
        "Native private-learning verification and cleanup failures",
      );
  }
}
