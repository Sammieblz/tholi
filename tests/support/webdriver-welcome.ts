import { By } from "selenium-webdriver";
import { expect, test } from "@playwright/test";
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

/** Install resolves before the worker's onInstalled/tab creation has finished. */
export async function waitForWelcomeInstallation(app: App) {
  const installed = await app.waitFor(
    () => welcomeTabCount(app),
    (count) => count > 0,
    "Fresh installation creates the exact packaged welcome tab",
    15_000,
  );
  if (!installed) throw Error("The installed welcome tab is missing.");
}

export async function openWelcomeSetup(app: App) {
  await waitForWelcomeInstallation(app);
  const url = await app.extension(() => {
    const api = (globalThis as any).browser || (globalThis as any).chrome;
    return api.runtime.getURL("welcome.html") as string;
  });
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
  const recording = await app.driver.wait(async () => {
    const videos = await app.driver.findElements(
      By.css(".welcome-choice video"),
    );
    return videos[0] || false;
  }, 15000);
  if (!recording) throw Error("The packaged welcome recording is unavailable.");
  expect(await recording.getAttribute("src")).toMatch(
    /\/media\/onboarding\/guidance.webm$/,
  );
  expect(
    await app.driver.executeScript(
      "return !arguments[0].controls && arguments[0].muted && arguments[0].loop",
      recording,
    ),
  ).toBe(true);
  // Native WebDriver windows can be short. Make the footage visible before
  // checking automatic playback, rather than bypassing its visibility gate.
  await app.driver.executeScript(
    "arguments[0].scrollIntoView({block:'center',behavior:'instant'})",
    recording,
  );
  const preferences = await app.driver.executeScript<{
    reduced: boolean;
    saveData: boolean;
  }>(
    "return {reduced:matchMedia('(prefers-reduced-motion: reduce)').matches,saveData:!!navigator.connection?.saveData}",
  );
  const posterOnly = preferences.reduced || preferences.saveData;
  let stage = posterOnly ? "poster" : "decode";
  let posterDimensions: number[] | null = null;
  try {
    if (posterOnly) {
      posterDimensions = await app.driver.executeAsyncScript<number[] | null>(
        function (
          video: HTMLVideoElement,
          done: (dimensions: number[] | null) => void,
        ) {
          const image = new Image();
          image.onload = () => done([image.naturalWidth, image.naturalHeight]);
          image.onerror = () => done(null);
          image.src = video.poster;
        },
        recording,
      );
      expect(posterDimensions).toEqual([1040, 800]);
      expect(await recording.getAttribute("preload")).toBe("none");
      expect(
        await app.driver.executeScript("return arguments[0].paused", recording),
      ).toBe(true);
    } else {
      // Autoplay is expected only when native preferences allow motion/data use.
      await app.driver.wait(
        async () =>
          await app.driver.executeScript(
            "return arguments[0].videoWidth === 1040 && arguments[0].videoHeight === 800",
            recording,
          ),
        15000,
        "The visible welcome recording decodes when motion is allowed",
      );
      stage = "playback";
      await app.driver.wait(
        async () =>
          await app.driver.executeScript(
            "return !arguments[0].paused",
            recording,
          ),
        15000,
        "The visible welcome recording plays when motion is allowed",
      );
    }
    stage = "verified";
  } finally {
    const state = await app.driver.executeScript(
      "const v=arguments[0],r=v.getBoundingClientRect();return {hidden:document.hidden,viewport:[innerWidth,innerHeight],frame:[r.width,r.height],decoded:[v.videoWidth,v.videoHeight],paused:v.paused,mediaError:v.error?.code??null}",
      recording,
    );
    await test.info().attach("welcome-playback", {
      contentType: "application/json",
      body: Buffer.from(
        JSON.stringify({
          preferences,
          mode: posterOnly ? "poster" : "playback",
          stage,
          posterDimensions,
          state,
        }),
      ),
    });
  }
  expect(
    await app.driver.findElements(
      By.css(
        ".welcome-choice .video-toolbar, .welcome-choice track, .welcome-choice .product-video a, .welcome-choice figcaption",
      ),
    ),
  ).toHaveLength(0);
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
