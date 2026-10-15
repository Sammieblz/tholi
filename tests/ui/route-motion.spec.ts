import { test, expect } from "@playwright/test";
import { wayfinderMarkup, wayfinderStyles } from "../../packages/ui/wayfinder";

test("continuous route motion follows verified practice steps and settles on arrival", async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto("/");
  const demo = page.getByLabel("Interactive Tholi demonstration");
  await demo
    .getByRole("button", { name: "Switch to Spanish", exact: true })
    .click();
  const path = demo.getByLabel("Journey steps", { exact: true });
  await expect(path).toContainText("Step 1 of 5 estimated");
  const orbit = demo.locator(
    '.tholi-wayfinder[data-state="guiding"] .wf-route-orbit',
  );
  await orbit.scrollIntoViewIfNeeded();
  await expect
    .poll(() => orbit.evaluate((e) => e.getAnimations().length))
    .toBe(1);
  const initial = await orbit.evaluate((e) =>
    Number(e.getAnimations()[0].currentTime),
  );
  await expect
    .poll(() => orbit.evaluate((e) => Number(e.getAnimations()[0].currentTime)))
    .toBeGreaterThan(initial + 200);
  await demo.getByRole("button", { name: "Account menu", exact: true }).click();
  await expect(path).toContainText("Step 2 of 5 estimated");
  await expect(path.locator('[data-state="verified"]')).toHaveCount(1);
  await demo
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await demo
    .getByRole("button", { name: "Language: English", exact: true })
    .click();
  await page.getByRole("button", { name: "Español", exact: true }).click();
  await expect(path).toContainText("Step 5 of 5 estimated");
  await expect(path.locator('[data-state="destination"]')).toHaveAttribute(
    "data-checked",
    "false",
  );
  await expect
    .poll(() =>
      demo.locator(".tholi-instruction").evaluate((e) => {
        const body = e.closest(".tholi-body")!.getBoundingClientRect();
        return e.getBoundingClientRect().bottom <= body.bottom;
      }),
    )
    .toBe(true);
  await demo.screenshot({ path: info.outputPath("route-before-arrival.png") });
  await demo.getByRole("button", { name: "Save changes", exact: true }).click();
  await expect(path).toHaveAttribute("data-arrived", "true");
  await expect(path.locator('[data-state="destination"]')).toHaveAttribute(
    "data-checked",
    "true",
  );
  await expect(path).toContainText("5 verified");
  await expect(path).toHaveAttribute("data-moving", "false");
  const marker = demo.locator('.tholi-wayfinder[data-state="arrived"]');
  await expect(marker).toHaveAttribute("data-morph", "true");
  await expect
    .poll(() =>
      marker.locator(".wf-seed").evaluate((e) => getComputedStyle(e).opacity),
    )
    .toBe("0");
  await expect
    .poll(() =>
      marker.locator(".wf-shadow").evaluate((e) => getComputedStyle(e).opacity),
    )
    .toBe("0");
  await expect(marker.locator(".wf-terminal .wf-piece")).toHaveCount(2);
  for (const piece of await marker.locator(".wf-terminal rect").all())
    await expect(piece).toHaveAttribute("fill", /^url\(#tholi-wayfinder-/);
  await expect(
    marker.locator('linearGradient stop[offset=".48"]'),
  ).toHaveAttribute("stop-color", "#e6af57");
  const svg = await marker.locator("svg").elementHandle();
  const morph = await marker
    .locator(".wf-piece-a")
    .evaluateHandle((e) => e.getAnimations()[0]);
  await expect.poll(() => morph.evaluate((a) => a.playState)).toBe("finished");
  expect(await morph.evaluate((a) => a.effect?.getTiming().duration)).toBe(420);
  expect(await morph.evaluate((a) => a.effect?.getTiming().iterations)).toBe(1);
  await demo.getByRole("button", { name: "Conversation", exact: true }).click();
  await demo.getByRole("button", { name: "Guide", exact: true }).click();
  await page.evaluate(() => scrollTo(0, 0));
  await expect(marker).toHaveAttribute("data-animate", "false");
  await marker.scrollIntoViewIfNeeded();
  await expect(marker).toHaveAttribute("data-animate", "true");
  expect(
    await marker.evaluate(
      (e, original) => e.querySelector("svg") === original,
      svg,
    ),
  ).toBe(true);
  expect(
    await marker
      .locator(".wf-piece-a")
      .evaluate((e, original) => e.getAnimations()[0] === original, morph),
  ).toBe(true);
  expect(await morph.evaluate((a) => a.playState)).toBe("finished");
  expect(
    await demo
      .locator(".tholi-app")
      .evaluate(
        (e) =>
          e
            .getAnimations({ subtree: true })
            .filter((a) => a.effect?.getTiming().iterations === Infinity)
            .length,
      ),
  ).toBe(0);
  await demo.screenshot({ path: info.outputPath("route-arrived.png") });
});

test("route activity survives keyboard use, pauses offscreen, and respects reduced motion", async ({
  page,
}, info) => {
  await page.goto("/");
  const demo = page.getByLabel("Interactive Tholi demonstration");
  await demo
    .getByRole("button", { name: "Find account settings", exact: true })
    .click();
  const orbit = demo.locator(".wf-route-orbit");
  await orbit.scrollIntoViewIfNeeded();
  await demo.getByLabel("Navigation goal").focus();
  await page.keyboard.press("Tab");
  await expect
    .poll(() => orbit.evaluate((e) => e.getAnimations().length))
    .toBe(1);
  expect(
    await orbit.evaluate(
      (e) => e.getAnimations()[0].effect?.getTiming().iterations,
    ),
  ).toBe(Infinity);
  await demo
    .getByRole("button", { name: "Pause navigation", exact: true })
    .click();
  await expect(
    demo.getByLabel("Journey steps", { exact: true }),
  ).toHaveAttribute("data-moving", "false");
  await expect
    .poll(() => orbit.evaluate((e) => e.getAnimations().length))
    .toBe(0);
  await demo
    .getByRole("button", { name: "Resume navigation", exact: true })
    .click();
  await orbit.scrollIntoViewIfNeeded();
  await expect
    .poll(() => orbit.evaluate((e) => e.getAnimations().length))
    .toBe(1);
  const frames = await demo.locator(".tholi-app").evaluate(async () => {
    const samples: number[] = [];
    let previous = performance.now();
    for (let i = 0; i < 60; i++) {
      const at = await new Promise<number>(requestAnimationFrame);
      if (i) samples.push(at - previous);
      previous = at;
      // Bounded dashboard scripting; no layout/paint churn from the animation.
      const until = performance.now() + 4;
      while (performance.now() < until) {
        /* deliberate fixture work */
      }
    }
    return samples.sort((a, b) => a - b)[Math.floor(samples.length * 0.95)];
  });
  await info.attach("route-motion-timing", {
    body: JSON.stringify({
      workload: "4 ms scripting per frame",
      frameP95Ms: frames,
    }),
    contentType: "application/json",
  });
  console.log(
    "ROUTE_MOTION_BENCHMARK",
    JSON.stringify({
      workload: "4 ms scripting per frame",
      frameP95Ms: frames,
    }),
  );
  await page.emulateMedia({ reducedMotion: "reduce" });
  await expect
    .poll(() => orbit.evaluate((e) => e.getAnimations().length))
    .toBe(0);
  const moving = demo.locator(".tholi-route-signal");
  for (const signal of await moving.all())
    expect(await signal.evaluate((e) => e.getAnimations().length)).toBe(0);
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await page.evaluate(() => scrollTo(0, 0));
  await expect
    .poll(() => demo.locator(".tholi-wayfinder").getAttribute("data-animate"))
    .toBe("false");
  await orbit.scrollIntoViewIfNeeded();
  await expect
    .poll(() => demo.locator(".tholi-wayfinder").getAttribute("data-animate"))
    .toBe("true");

  // Isolated visual samples exercise terminal shapes, not navigation outcomes.
  const samples = (["arrived", "unresolved"] as const)
    .flatMap((state) =>
      [0, 100, 240, 420].map(
        (at) =>
          `<figure data-at="${at}"><div>${wayfinderMarkup({ state, instance: `${state}-${at}` })}</div><figcaption>${state === "arrived" ? "Check" : "X"} · ${at} ms</figcaption></figure>`,
      ),
    )
    .join("");
  await page.evaluate(
    ({ samples, styles }) => {
      const gallery = document.createElement("section");
      gallery.id = "terminal-motion-gallery";
      gallery.setAttribute("aria-label", "Isolated terminal animation stages");
      gallery.innerHTML = `<style>${styles}#terminal-motion-gallery{display:grid;grid-template-columns:repeat(4,140px);gap:16px;padding:24px;background:#faf7f0;color:#1c2522;width:max-content;font:14px sans-serif}#terminal-motion-gallery figure{margin:0;text-align:center}#terminal-motion-gallery .tholi-wayfinder{width:96px;height:96px}</style>${samples}`;
      document.body.append(gallery);
      for (const sample of gallery.querySelectorAll<HTMLElement>("figure")) {
        const marker = sample.querySelector<HTMLElement>(".tholi-wayfinder")!;
        marker.dataset.morph = "true";
        for (const animation of marker.getAnimations({ subtree: true })) {
          animation.pause();
          animation.currentTime = Number(sample.dataset.at);
        }
      }
    },
    { samples, styles: wayfinderStyles },
  );
  const gallery = page.getByLabel("Isolated terminal animation stages");
  await gallery.screenshot({
    path: info.outputPath("terminal-morph-stages.png"),
  });
  const cross = gallery.locator(
    'figure[data-at="420"] .tholi-wayfinder[data-state="unresolved"]',
  );
  expect(
    await cross
      .locator(".wf-seed")
      .evaluate((e) => getComputedStyle(e).opacity),
  ).toBe("0");
  expect(
    await cross
      .locator(".wf-shadow")
      .evaluate((e) => getComputedStyle(e).opacity),
  ).toBe("0");
  await expect(cross.locator(".wf-terminal .wf-piece")).toHaveCount(2);
  expect(
    await cross
      .locator(".wf-terminal")
      .evaluate((e) => getComputedStyle(e).opacity),
  ).toBe("1");
  await page.emulateMedia({ reducedMotion: "reduce" });
  expect(
    await cross.evaluate((e) => e.getAnimations({ subtree: true }).length),
  ).toBe(0);
  expect(
    await cross
      .locator(".wf-seed")
      .evaluate((e) => getComputedStyle(e).opacity),
  ).toBe("0");
  expect(
    await cross
      .locator(".wf-terminal")
      .evaluate((e) => getComputedStyle(e).opacity),
  ).toBe("1");
});
