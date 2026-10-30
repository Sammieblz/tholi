import { expect } from "@playwright/test";
import firefox from "selenium-webdriver/firefox.js";
import { By, until, type WebDriver } from "selenium-webdriver";
import type { attachWebDriverExtension } from "./webdriver-extension";
type App = Awaited<ReturnType<typeof attachWebDriverExtension>>;
/** Exercise the real Firefox toolbar gesture in a disposable test profile. */
export async function activateFirefoxToolbar(driver: WebDriver) {
  const gecko = driver as firefox.Driver;
  await gecko.setContext(firefox.Context.CHROME);
  try {
    await gecko.executeScript(() => {
      const scope = globalThis as any;
      let CustomizableUI = scope.CustomizableUI;
      if (!CustomizableUI) {
        try {
          CustomizableUI = scope.ChromeUtils.importESModule(
            "moz-src:///browser/components/customizableui/CustomizableUI.sys.mjs",
          ).CustomizableUI;
        } catch {
          CustomizableUI = scope.ChromeUtils.importESModule(
            "resource:///modules/CustomizableUI.sys.mjs",
          ).CustomizableUI;
        }
      }
      CustomizableUI.addWidgetToArea(
        "tholi_ilunonsen_com-browser-action",
        "nav-bar",
      );
    });
    const toolbar = await gecko.findElement(
      By.id("tholi_ilunonsen_com-browser-action"),
    );
    await gecko.actions().move({ origin: toolbar }).click().perform();
  } finally {
    await gecko.setContext(firefox.Context.CONTENT);
  }
}
/** Native surface contract shared by the four installed browser checks. */
export async function verifyWebDriverSurfaces(
  app: App,
  target: "chromium" | "firefox",
) {
  const control = async (selector: By) =>
    app.driver
      .wait(
        async () => {
          try {
            for (const element of await app.driver.findElements(selector))
              if (await element.isDisplayed()) return element;
          } catch (error) {
            if (
              !/stale|not known in the current browsing context/i.test(
                String(error),
              )
            )
              throw error;
          }
          return false;
        },
        5000,
        "Visible surface control: " + selector,
      )
      .then((value) => {
        if (!value) throw Error("Missing surface control");
        return value;
      });
  await app.site(() => document.title);
  await (await control(By.css("h1"))).click();
  await app.goal("Show search");
  const request = (await app.view()).request.id;
  await app.driver.switchTo().window(app.panel);
  await (await control(By.css('button[aria-label="Tholi settings"]'))).click();
  await (
    await control(
      By.xpath('//button[normalize-space(.)="Use floating widget"]'),
    )
  ).click();
  const shell = async () => {
    await app.driver.switchTo().window(app.website);
    await app.driver.switchTo().defaultContent();
    const host = await app.driver.wait(
      until.elementLocated(By.css("#tholi-widget")),
      10000,
    );
    return host.getShadowRoot();
  };
  const widget = async () => {
    const root = await shell();
    const frame = await root.findElement(By.css("iframe"));
    await app.driver.switchTo().frame(frame);
    await app.driver.wait(until.elementLocated(By.css(".tholi-app")), 10000);
  };
  await widget();
  // Wait for the actual widget layout, not only React's initial root mount.
  await (await control(By.css('button[aria-label="Widget menu"]'))).click();
  await (
    await control(By.xpath('//button[normalize-space(.)="Conversation"]'))
  ).click();
  const composer = await control(
    By.css('textarea[aria-label="Navigation goal"]'),
  );
  await composer.clear();
  await composer.sendKeys("Retained follow-up draft");
  await app.waitFor(
    () =>
      app.extension(() =>
        (
          (globalThis as any).browser || (globalThis as any).chrome
        ).storage.session.get("tholiDraft"),
      ),
    (value) => value.tholiDraft === "Retained follow-up draft",
    "Widget draft persisted",
  );
  await (
    await shell()
  )
    .findElement(By.css(".minimize"))
    .then((button) => button.click());
  await app.waitFor(
    () =>
      app.site(
        () => document.getElementById("tholi-widget")?.dataset.minimized,
      ),
    (value) => value === "true",
    "Widget minimized to launcher",
  );
  await (await control(By.css('input[type="search"]'))).click();
  await app.waitFor(
    () => app.view(),
    (value) => value.goalPlan?.status === "completed",
    "Arrival is verified while minimized",
  );
  expect(
    await app.site(
      () => !!document.getElementById("internet-navigator-overlay"),
    ),
  ).toBe(false);
  await (
    await shell()
  )
    .findElement(By.css(".launcher"))
    .then((button) => button.click());
  await app.waitFor(
    () =>
      app.site(
        () => document.getElementById("tholi-widget")?.dataset.minimized,
      ),
    (value) => value !== "true",
    "Launcher restored widget",
  );
  await widget();
  await expect
    .poll(async () =>
      (
        await control(By.css('textarea[aria-label="Navigation goal"]'))
      ).getAttribute("value"),
    )
    .toBe("Retained follow-up draft");
  await (await control(By.css('button[aria-label="Widget menu"]'))).click();
  await (
    await control(By.xpath('//button[normalize-space(.)="Dock to sidebar"]'))
  ).click();
  await app.driver.switchTo().defaultContent();
  if (target === "firefox") {
    // Gecko forbids sidebarAction in a web-embedded extension iframe. The failed
    // explicit Dock keeps the widget usable until a real toolbar user gesture.
    expect(
      await app.site(() => !!document.getElementById("tholi-widget")),
    ).toBe(true);
    await activateFirefoxToolbar(app.driver);
  }
  try {
    await app.waitFor(
      () => app.site(() => !!document.getElementById("tholi-widget")),
      (value) => !value,
      "Widget removed only after successful native sidebar handoff",
    );
  } catch (error) {
    const state = await app.message({ type: "UI_GET" });
    const native = await app.extension(() =>
      (globalThis as any).browser?.sidebarAction?.isOpen({}),
    );
    throw Error(
      "Native handoff: " +
        JSON.stringify({ presentation: state.presentation, native }),
      { cause: error },
    );
  }
  expect((await app.view()).request.id).toBe(request);
  const open = await app.extension(async (target: string) => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    if (target === "firefox") return api.sidebarAction.isOpen({});
    return (
      (await api.runtime.getContexts({ contextTypes: ["SIDE_PANEL"] })).length >
      0
    );
  }, target);
  expect(open, "The actual native sidebar is open").toBe(true);
  return {
    nativeSidebar: true,
    minimizedArrival: true,
    draftRetained: true,
    requestRetained: true,
  };
}
