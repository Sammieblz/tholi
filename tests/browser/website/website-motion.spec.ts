import { test, expect } from "../../support/browser-test";
import os from "node:os";

test("real recording loops with one control, both appearances and deliberate pause", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Essential only", exact: true })
    .click();
  const manifest = await (
    await page.request.get("/media/video/manifest.json")
  ).json();
  const video = page.locator(".product-video video");
  await video.scrollIntoViewIfNeeded();
  await expect(video).toHaveAttribute("src", manifest.variants.dark.src);
  await expect(video).toHaveJSProperty("controls", false);
  await expect(video).toHaveJSProperty("loop", true);
  await expect(page.locator(".video-playback button")).toHaveCount(1);
  await expect(page.locator(".video-play")).toHaveCount(0);
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.readyState),
    )
    .toBeGreaterThanOrEqual(1);
  expect(
    await video.evaluate((element: HTMLVideoElement) => [
      element.videoWidth,
      element.videoHeight,
    ]),
  ).toEqual([1440, 960]);
  await expect(
    page
      .locator(".video-playback")
      .getByRole("button", { name: "Pause", exact: true }),
  ).toBeVisible();
  await page
    .locator(".video-playback")
    .getByRole("button", { name: "Pause", exact: true })
    .click();
  await page.locator(".closing").scrollIntoViewIfNeeded();
  await video.scrollIntoViewIfNeeded();
  expect(
    await video.evaluate((element: HTMLVideoElement) => element.paused),
  ).toBe(true);
  await page
    .locator(".video-playback")
    .getByRole("button", { name: "Resume", exact: true })
    .click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(false);
  await page.locator(".closing").scrollIntoViewIfNeeded();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(true);
  await video.scrollIntoViewIfNeeded();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(false);
  await video.evaluate((element: HTMLVideoElement) => {
    element.currentTime = element.duration - 0.15;
  });
  await expect
    .poll(() =>
      video.evaluate((element: HTMLVideoElement) => element.currentTime),
    )
    .toBeLessThan(2);
  await expect(video).toHaveJSProperty("paused", false);
  await page
    .locator(".video-playback")
    .getByRole("button", { name: "Pause", exact: true })
    .click();
  await page.getByRole("button", { name: "Switch to light mode" }).click();
  await expect(video).toHaveAttribute("src", manifest.variants.light.src);
  await expect(video).toHaveAttribute("poster", manifest.variants.light.poster);
  await expect(video.locator("track")).toHaveCount(0);
  await expect(video).toHaveJSProperty("paused", true);
  await page.setViewportSize({ width: 375, height: 850 });
  await page.reload();
  await video.scrollIntoViewIfNeeded();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(false);
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.reload();
  await video.scrollIntoViewIfNeeded();
  await expect(video).toHaveJSProperty("paused", true);
  await page
    .locator(".video-playback")
    .getByRole("button", { name: "Resume", exact: true })
    .click();
  await expect
    .poll(() => video.evaluate((element: HTMLVideoElement) => element.paused))
    .toBe(false);
  await page.route("**/media/video/manifest.json", (route) =>
    route.fulfill({ status: 503, body: "Unavailable" }),
  );
  await page.reload();
  await expect(page.locator(".video-unavailable")).toContainText(
    "could not be loaded",
  );
  await expect(page.locator(".demo")).toBeVisible();
});

test("transparent Wayfinder sequence pauses offscreen and provides static reduced-motion states", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/about");
  await page
    .getByRole("button", { name: "Essential only", exact: true })
    .click();
  const stage = page.locator(".wayfinder-stage");
  await expect(stage).toHaveAttribute("data-playing", "true");
  await expect(stage.locator("button, select, input")).toHaveCount(0);
  await page.clock.install();
  const states = [
    "Waiting",
    "Finding a way",
    "On your way",
    "Checking",
    "A moment for you",
    "Taking a pause",
    "Arrived",
    "No clear route yet",
  ];
  for (const state of [...states, states[0]]) {
    await expect(stage.locator(".wayfinder-stage-caption strong")).toHaveText(
      state,
    );
    await page.clock.fastForward(3600);
  }
  expect(
    await stage.evaluate(
      (element) => getComputedStyle(element).backgroundColor,
    ),
  ).toBe("rgba(0, 0, 0, 0)");
  await expect(stage).toHaveAttribute("data-playing", "true");
  await page.locator(".web-footer").scrollIntoViewIfNeeded();
  await expect(stage).toHaveAttribute("data-playing", "false");
  const stoppedState = await stage
    .locator(".tholi-wayfinder")
    .getAttribute("data-state");
  await page.clock.fastForward(7200);
  await expect(stage.locator(".tholi-wayfinder")).toHaveAttribute(
    "data-state",
    stoppedState!,
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await stage.scrollIntoViewIfNeeded();
  await expect(stage).toHaveAttribute("data-playing", "false");
  await page.clock.fastForward(7200);
  await expect(stage.locator(".tholi-wayfinder")).toHaveAttribute(
    "data-state",
    stoppedState!,
  );
  await page.screenshot({
    path: info.outputPath("about-reduced.png"),
    fullPage: true,
  });
});

test("scroll companion stays in its gutter and motion timing is measured on normal and busy pages", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Essential only", exact: true })
    .click();
  const point = page.locator(".scroll-companion");
  await expect(point).toBeVisible();
  const before = await point.boundingBox();
  await page.evaluate(() =>
    scrollTo(0, document.documentElement.scrollHeight * 0.5),
  );
  await expect
    .poll(async () => (await point.boundingBox())!.y)
    .toBeGreaterThan(before!.y);
  const box = (await point.boundingBox())!;
  expect(box.x).toBeGreaterThanOrEqual(0);
  const contentLeft = (await page.locator(".hero-heading").boundingBox())!.x;
  expect(box.x + box.width).toBeLessThanOrEqual(contentLeft - 16);
  await page.evaluate(() => scrollTo(0, document.documentElement.scrollHeight));
  await expect
    .poll(() =>
      point.evaluate((element) => Number(getComputedStyle(element).opacity)),
    )
    .toBeLessThan(0.05);
  await page
    .getByRole("button", { name: "Find account settings", exact: true })
    .click();
  const activeOrbit = page.locator(".demo .wf-route-orbit");
  await activeOrbit.scrollIntoViewIfNeeded();
  await expect
    .poll(() =>
      activeOrbit.evaluate(
        (element) =>
          element
            .getAnimations()
            .filter((animation) => animation.playState === "running").length,
      ),
    )
    .toBeGreaterThan(0);
  const measurements = await page.evaluate(async () => {
    const measure = async (busy: boolean) => {
      const intervals: number[] = [];
      let previous = performance.now();
      for (let i = 0; i < 90; i++) {
        await new Promise<void>((resolve) =>
          requestAnimationFrame((now) => {
            intervals.push(now - previous);
            previous = now;
            resolve();
          }),
        );
        if (busy && i % 6 === 0) {
          const end = performance.now() + 12;
          while (performance.now() < end) {
            Math.sqrt(Math.random());
          }
        }
      }
      intervals.sort((a, b) => a - b);
      return {
        p95Ms: intervals[Math.ceil(intervals.length * 0.95) - 1],
        frames: intervals.length,
      };
    };
    return { normal: await measure(false), syntheticBusy: await measure(true) };
  });
  await info.attach("website-motion-timing", {
    body: JSON.stringify({
      cpu: os.cpus()[0]?.model,
      logicalCpus: os.cpus().length,
      platform: os.platform(),
      workload:
        "Active shared guidance orbit; synthetic busy pass blocks 12 ms every sixth frame",
      viewport: [1440, 1000],
      ...measurements,
    }),
    contentType: "application/json",
  });
  // Observational timings are reported, not converted into a universal device claim.
  await page.goto("/about");
  await expect(point).toHaveCount(0);
  await page.setViewportSize({ width: 375, height: 850 });
  await page.goto("/");
  await expect(point).toBeHidden();
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(page.locator(".hero-heading")).toHaveCSS(
    "animation-name",
    "none",
  );
});
