import { test, expect } from "../../support/browser-test";
import os from "node:os";

test("documentation entrances settle once and leave keyboard, search and reduced motion immediate", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 720 });
  await page.goto("/docs");
  await page
    .getByRole("button", { name: "Essential only", exact: true })
    .click();
  const lastCard = page.locator(".docs-index-card").last();
  // A block below the viewport waits for its first scroll, then stays settled.
  await expect(lastCard).toHaveCSS("opacity", "0.35");
  await lastCard.scrollIntoViewIfNeeded();
  await expect(lastCard).toHaveCSS("opacity", "1");
  await expect(lastCard).toHaveCSS("transform", "none");
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await lastCard.scrollIntoViewIfNeeded();
  await expect(lastCard).toHaveCSS("transform", "none");

  // Typing directly after pointer focus must cancel reveals too, without Tab.
  await page.goto("/docs");
  await expect(lastCard).toHaveCSS("opacity", "0.35");
  const search = page.getByRole("searchbox", { name: "Search documentation" });
  await search.click();
  await search.pressSequentially("widget");
  await search.clear();
  await expect(lastCard).toHaveCSS("opacity", "1");
  await expect(lastCard).toHaveCSS("transform", "none");

  const chapters = page.getByRole("navigation", {
    name: "Documentation chapters",
  });
  await chapters
    .getByRole("link", { name: "Getting started", exact: true })
    .click();
  const lastHeading = page.locator(".docs-prose .docs-heading").last();
  await expect(lastHeading).toHaveCSS("opacity", "0.35");
  await expect(chapters.locator("[aria-current='page']")).toHaveText(
    "Getting started",
  );
  await expect(chapters.locator("[aria-current='page']")).toHaveCSS(
    "background-color",
    "rgba(0, 0, 0, 0)",
  );
  // Keyboard scrolling/focus must reveal even the pending blocks immediately.
  await page.keyboard.press("Tab");
  await expect(lastHeading).toHaveCSS("opacity", "1");
  await expect(lastHeading).toHaveCSS("transform", "none");
  await search.fill("widget");
  const result = page
    .getByRole("navigation", { name: "Documentation search results" })
    .getByRole("link", { name: "Using Tholi", exact: true });
  await result.focus();
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/docs\/using-tholi$/);
  await expect(page.locator(".docs-prose .docs-heading").last()).toHaveCSS(
    "transform",
    "none",
  );
  await expect(page.locator(".docs-article-header")).toHaveCSS("opacity", "1");
  // Changing the OS preference also cancels pending entrances on the open page.
  await page.goto("/docs/getting-started");
  await expect(lastHeading).toHaveCSS("opacity", "0.35");
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect(lastHeading).toHaveCSS("opacity", "1");
  await expect(lastHeading).toHaveCSS("transform", "none");
  await chapters
    .getByRole("link", { name: "Using Tholi", exact: true })
    .click();
  await expect(page.locator(".docs-article-header")).toHaveCSS(
    "transform",
    "none",
  );
  await expect(page.locator(".docs-prose .docs-heading").last()).toHaveCSS(
    "opacity",
    "1",
  );
});

test("header returns on upward scroll and keyboard focus; download reveals respect preference changes", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Essential only", exact: true })
    .click();
  const header = page.locator(".web-header");
  const navigation = page.getByRole("navigation", { name: "Main navigation" });
  await expect(navigation.getByRole("link")).toHaveText([
    "About",
    "Get Tholi",
    "Docs",
  ]);
  await page.mouse.wheel(0, 700);
  await expect
    .poll(async () => {
      const box = (await header.boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(1);
  await page.mouse.wheel(0, -100);
  await expect
    .poll(async () => (await header.boundingBox())!.y)
    .toBeGreaterThanOrEqual(0);
  await page.mouse.wheel(0, 250);
  await expect
    .poll(async () => {
      const box = (await header.boundingBox())!;
      return box.y + box.height;
    })
    .toBeLessThanOrEqual(1);
  await navigation.getByRole("link", { name: "About", exact: true }).focus();
  await expect
    .poll(async () => (await header.boundingBox())!.y)
    .toBeGreaterThanOrEqual(0);
  await navigation.getByRole("link", { name: "About", exact: true }).click();
  const principle = page.locator(".about-ownership");
  const heading = principle.locator("h2");
  const body = principle.locator("p").last();
  await expect(heading).toHaveCSS("opacity", "0");
  await heading.evaluate((element) => {
    window.scrollTo({
      top: scrollY + element.getBoundingClientRect().top - innerHeight * 0.65,
      behavior: "instant",
    });
  });
  await expect
    .poll(() =>
      heading.evaluate((element) => Number(getComputedStyle(element).opacity)),
    )
    .toBeGreaterThan(0);
  const progress = await principle.evaluate((element) => ({
    heading: Number(getComputedStyle(element.querySelector("h2")!).opacity),
    body: Number(
      getComputedStyle(element.querySelector("p:last-of-type")!).opacity,
    ),
  }));
  expect(progress.heading).toBeLessThan(1);
  expect(progress.heading).toBeGreaterThan(progress.body);
  await expect(heading).toHaveCSS("opacity", "1");
  await expect(body).toHaveCSS("opacity", "1");
  // Reading back through a section must not restart its entrance.
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: "instant" }));
  await heading.scrollIntoViewIfNeeded();
  await expect(heading).toHaveCSS("transform", "none");
  await expect(heading).toHaveCSS("opacity", "1");
  // Changing the preference clears even the still-pending reveals.
  await page.emulateMedia({ reducedMotion: "reduce" });
  for (const part of await principle.locator("h2, p").all()) {
    await expect(part).toHaveCSS("transform", "none");
    await expect(part).toHaveCSS("opacity", "1");
  }
  await page.goto("/download");
  await expect(page.locator(".browser-install-card")).toHaveCount(2);
  for (const card of await page.locator(".browser-install-card").all()) {
    await expect(card).toHaveCSS("transform", "none");
    await expect(card).toHaveCSS("opacity", "1");
  }
});

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
