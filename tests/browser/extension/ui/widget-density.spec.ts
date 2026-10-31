import { expect, test } from "../../../support/browser-test";
import { mountPresentationFixture } from "../../../support/presentation-fixture";

test("widget size tiers protect the composer, selection and required decisions", async ({
  page,
}, info) => {
  await mountPresentationFixture(page, "widget");
  const input = page.getByLabel("Navigation goal");
  await expect(input).toBeVisible();
  await input.fill("Deploy my chosen website");
  const original = await input.elementHandle();
  await input.evaluate((field: HTMLTextAreaElement) => {
    field.focus();
    field.setSelectionRange(4, 12);
  });
  for (const [width, height, tier] of [
    [420, 590, "expanded"],
    [360, 392, "standard"],
    [300, 272, "compact"],
    [240, 152, "minimal"],
    [500, 192, "minimal"],
    [360, 392, "standard"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await expect(page.locator(".tholi-app")).toHaveAttribute(
      "data-density",
      tier,
    );
    expect(
      await input.evaluate((field, initial) => field === initial, original),
    ).toBe(true);
    await expect(input).toBeFocused();
    expect(
      await input.evaluate((field: HTMLTextAreaElement) => [
        field.selectionStart,
        field.selectionEnd,
      ]),
    ).toEqual([4, 12]);
    await expect(input).toHaveValue("Deploy my chosen website");
    const bounds = await input.boundingBox();
    expect(bounds!.y).toBeGreaterThanOrEqual(0);
    expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await expect(
      page.getByRole("button", { name: "Widget menu", exact: true }),
    ).toBeVisible();
    if (tier === "compact" || tier === "minimal") {
      await expect(
        page.getByRole("button", { name: "Pause navigation", exact: true }),
      ).toBeHidden();
      await expect(page.locator(".tholi-route-steps")).toBeHidden();
      await expect(
        page.getByRole("button", { name: "Send", exact: true }),
      ).toBeVisible();
    }
    await page.screenshot({
      path: info.outputPath(`widget-${width}-${height}.png`),
    });
  }
  for (const [width, height, tier] of [
    [240, 152, "minimal"],
    [360, 392, "standard"],
    [420, 590, "expanded"],
  ] as const) {
    await page.setViewportSize({ width, height });
    await page.evaluate(() =>
      window.widgetFixture.processing({
        state: "error",
        title: "Connected service is unavailable",
        detail: "Check your connection before trying again, or choose Local.",
        recovery: "retry",
      }),
    );
    await expect(page.locator(".tholi-app")).toHaveAttribute(
      "data-density",
      tier,
    );
    const retry = page.getByRole("button", { name: "Try again", exact: true });
    await retry.focus();
    await expect(retry).toBeFocused();
    // Keyboard focus must scroll recovery fully into the existing body, while
    // the composer remains available outside that scrolling region.
    await expect(retry).toBeInViewport({ ratio: 1 });
    const recovery = await retry.boundingBox();
    const body = await page.locator(".tholi-body").boundingBox();
    const composer = await input.boundingBox();
    const dock = await page.locator(".tholi-compose-dock").boundingBox();
    expect(recovery!.height).toBeGreaterThanOrEqual(44);
    expect(recovery!.y).toBeGreaterThanOrEqual(body!.y);
    expect(recovery!.y + recovery!.height).toBeLessThanOrEqual(
      Math.min(body!.y + body!.height, dock!.y),
    );
    expect(composer!.y).toBeGreaterThanOrEqual(0);
    expect(composer!.y + composer!.height).toBeLessThanOrEqual(height);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`widget-processing-${tier}.png`),
      animations: "disabled",
    });
    const before = await page.evaluate(() => window.widgetFixture.retries);
    await page.keyboard.press("Enter");
    expect(await page.evaluate(() => window.widgetFixture.retries)).toBe(
      before + 1,
    );
    await page.evaluate(() =>
      window.widgetFixture.processing({
        state: "pending",
        title: "Connected guidance is checking this page",
        detail:
          "This request uses the development service. Pause and Stop remain available.",
      }),
    );
    await expect(
      page.getByRole("status", { name: "Processing" }),
    ).toContainText("Connected guidance is checking this page");
    await expect(retry).toHaveCount(0);
    await expect(input).toHaveValue("Deploy my chosen website");
  }
  await page.evaluate(() => window.widgetFixture.processing(undefined));
  await page.setViewportSize({ width: 240, height: 152 });
  await page.evaluate(() => window.widgetFixture.blocking(true));
  await expect(page.locator(".tholi-attention-trigger")).toBeVisible();
  await expect(input).toBeVisible();
  expect(await page.evaluate(() => window.widgetFixture.expansions)).toBe(0);
  await page.locator(".tholi-attention-trigger").click();
  expect(await page.evaluate(() => window.widgetFixture.expansions)).toBe(1);
  await page.setViewportSize({ width: 420, height: 590 });
  const answer = page.getByLabel("Account name", { exact: true });
  await answer.fill("My account");
  await page.setViewportSize({ width: 360, height: 392 });
  await expect(answer).toHaveValue("My account");
  await page.keyboard.press("Escape");
  await expect(input).toHaveValue("Deploy my chosen website");
  await page.evaluate(() => {
    window.widgetFixture.blocking(false);
    window.widgetFixture.phase("idle");
  });
  await expect(page.locator(".tholi-current")).toContainText(
    "Navigation stopped.",
  );
  await expect(page.locator(".tholi-journey-summary")).toBeHidden();
  await expect(page.locator(".tholi-route-steps")).toBeHidden();
  await expect(input).toBeVisible();
  await page.screenshot({ path: info.outputPath("widget-stopped.png") });
});
