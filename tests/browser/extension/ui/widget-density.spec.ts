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
