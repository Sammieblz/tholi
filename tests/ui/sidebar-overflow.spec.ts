import { expect, test } from "@playwright/test";
import { resolve } from "node:path";

test("sidebar decisions and long instructions cannot overlap the composer", async ({
  page,
}, info) => {
  await page.goto("/");
  await page.addScriptTag({
    type: "module",
    url:
      "/@fs/" +
      resolve("tests/ui/fixtures/sidebar-presentation.tsx").replaceAll(
        "\\",
        "/",
      ),
  });
  const input = page.getByLabel("Navigation goal");
  await expect(input).toBeVisible();
  await input.fill("Find comments in this video");
  const original = await input.elementHandle();
  for (const theme of ["light", "dark"]) {
    await page.locator("html").evaluate((root, value) => {
      root.dataset.tholiTheme = value;
    }, theme);
    for (const [width, height] of [
      [480, 868],
      [360, 620],
      [280, 480],
      [220, 420],
    ]) {
      await page.setViewportSize({ width, height });
      await page.evaluate(() => window.sidebarFixture.phase("clarification"));
      const attention = page.getByRole("region", {
        name: "Important guidance",
        exact: true,
      });
      await expect(attention).toBeVisible();
      const dock = page.locator(".tholi-compose-dock");
      const bounds = await attention.boundingBox(),
        bottom = await dock.boundingBox();
      expect(bounds!.y + bounds!.height).toBeLessThanOrEqual(bottom!.y);
      await expect(
        page.getByRole("button", { name: "Journey summary and details" }),
      ).toBeHidden();
      const choices = attention.getByRole("button");
      for (let i = 0; i < 3; i++) {
        await choices.nth(i).focus();
        const choice = await choices.nth(i).boundingBox();
        expect(choice!.y).toBeGreaterThanOrEqual(bounds!.y);
        expect(choice!.y + choice!.height).toBeLessThanOrEqual(
          bounds!.y + bounds!.height,
        );
      }
      const field = await input.boundingBox();
      expect(field!.y + field!.height).toBeLessThanOrEqual(height);
      expect(
        await page.evaluate(
          () => document.documentElement.scrollWidth <= innerWidth,
        ),
      ).toBe(true);
      await page.screenshot({
        path: info.outputPath(`question-${width}-${height}-${theme}.png`),
        animations: "disabled",
      });
    }
  }
  await expect(input).toHaveValue("Find comments in this video");
  expect(
    await input.evaluate((node, initial) => node === initial, original),
  ).toBe(true);
  await page.setViewportSize({ width: 360, height: 620 });
  for (const phase of ["review", "authentication"] as const) {
    await page.evaluate((value) => window.sidebarFixture.phase(value), phase);
    await expect(
      page.getByRole("region", { name: "Important guidance", exact: true }),
    ).toContainText(
      phase === "review"
        ? "Review the website action"
        : "Sign in on the website",
    );
  }
  await page.evaluate(() => {
    window.sidebarFixture.phase("guiding");
    window.sidebarFixture.long(true);
  });
  await expect(page.locator(".tholi-attention")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Journey summary and details" }),
  ).toBeVisible();
  const layout = await page.evaluate(() => {
    const rect = (selector: string) =>
      document.querySelector(selector)!.getBoundingClientRect();
    return {
      bodyBottom: rect(".tholi-body").bottom,
      workspaceBottom: rect(".tholi-workspace").bottom,
      dockTop: rect(".tholi-compose-dock").top,
    };
  });
  expect(layout.bodyBottom).toBeLessThanOrEqual(layout.workspaceBottom);
  expect(layout.workspaceBottom).toBeLessThanOrEqual(layout.dockTop);
  await page.getByRole("button", { name: "Conversation", exact: true }).click();
  await expect(input).toHaveValue("Find comments in this video");
  await page.evaluate(() => window.sidebarFixture.phase("clarification"));
  await expect(
    page.getByRole("heading", { name: "Which “comments” do you mean?" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Sort comments", exact: true })
    .click();
  await expect(page.getByLabel("Conversation", { exact: true })).toContainText(
    "Your destination remains Find comments.",
  );
});
