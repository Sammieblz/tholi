import { By } from "selenium-webdriver";
import { expect } from "@playwright/test";
import {
  findWebDriverWindow,
  type attachWebDriverExtension,
} from "./webdriver-extension";
type App = Awaited<ReturnType<typeof attachWebDriverExtension>>;

export function welcomeTabCount(app: App) {
  return app.extension(async () => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    return (await api.tabs.query({})).filter(
      (tab: any) => tab.url === api.runtime.getURL("welcome.html"),
    ).length as number;
  });
}

export async function openWelcomeSetup(app: App) {
  const url = await app.extension(() => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    return api.runtime.getURL("welcome.html") as string;
  });
  const installed = await app.waitFor(
    () => welcomeTabCount(app),
    (count) => count > 0,
    "Fresh installation creates the exact packaged welcome tab",
    15_000,
  );
  if (!installed) throw Error("The installed welcome tab is missing.");
  const existing = await findWebDriverWindow(app.driver, url);
  if (existing) return existing;
  if (!url.startsWith("chrome-extension://"))
    throw Error("The installed Firefox welcome window is unavailable.");
  // Chrome's BiDi installer leaves API-created extension pages outside its
  // WebDriver handle registry. The tab above is verified independently; exercise
  // its packaged UI in a controlled native tab, just like the sidebar harness.
  await app.driver.switchTo().newWindow("tab");
  const handle = await app.driver.getWindowHandle();
  await app.driver.get(url);
  return handle;
}

/** Actual packaged UI, shared by native Chrome and Firefox coverage. */
export async function verifyFreshWelcomeSetup(app: App) {
  expect(await welcomeTabCount(app)).toBe(1);
  const welcome = await openWelcomeSetup(app);
  expect(welcome).toBeTruthy();
  const signup = await app.driver.wait(async () => {
    const signup = await app.driver.findElement(
      By.xpath('//button[normalize-space(.)="Sign up"]'),
    );
    return (await signup.isEnabled()) ? signup : false;
  }, 15_000);
  if (!signup) throw Error("The welcome Sign up control is unavailable.");
  await signup.click();
  await app.driver.wait(
    async () =>
      (await app.driver.findElement(By.css("h1")).getText()).includes(
        "Tell Tholi",
      ),
    10_000,
  );
  for (let step = 2; step <= 3; step++) {
    await app.driver
      .findElement(By.xpath('//button[normalize-space(.)="Next"]'))
      .click();
    await app.driver.wait(
      async () =>
        (
          await app.driver
            .findElement(By.css('[aria-current="step"]'))
            .getText()
        ).startsWith(`0${step}`),
      10_000,
    );
  }
  await app.driver
    .findElement(By.xpath('//button[normalize-space(.)="Use Tholi locally"]'))
    .click();
  await app.driver.wait(
    async () =>
      (await app.driver.findElements(By.css(".welcome-complete"))).length > 0,
    10_000,
  );
  await app.driver.switchTo().window(app.website);
  const status = await app.message({ type: "SETUP_STATUS" });
  expect(status).toMatchObject({
    version: 1,
    complete: true,
    choice: "local",
    step: 3,
  });
  expect(await app.message({ type: "AUTH_INFERENCE_STATUS" })).toMatchObject({
    enabled: false,
    images: false,
  });
  return welcome;
}
