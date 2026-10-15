import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
for (const width of [375, 768, 1440])
  test(`Tholi website ${width}px onboarding and download integrity`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("/");
    await expect(
      page.getByRole("heading", { name: "Find your way forward." }),
    ).toBeVisible();
    const captures = page.locator(".product-capture .capture-open img");
    await expect(captures).toHaveCount(4);
    for (const capture of await captures.all()) {
      await capture.scrollIntoViewIfNeeded();
      await expect
        .poll(() =>
          capture.evaluate((image: HTMLImageElement) => image.naturalWidth),
        )
        .toBeGreaterThan(0);
    }
    const enlarge = page.getByRole("button", {
      name: "Enlarge screenshot: The next step, right where you need it.",
    });
    await enlarge.click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await expect(page.getByRole("dialog").locator("img")).toHaveJSProperty(
      "naturalWidth",
      1440,
    );
    await page.keyboard.press("Escape");
    await expect(enlarge).toBeFocused();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    if (width === 375) {
      const navigation = page.getByRole("button", { name: "Open navigation" });
      await navigation.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(navigation).toBeFocused();
    }
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Account settings", exact: true }),
    ).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`home-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/signup");
    await page.getByLabel("Name", { exact: true }).fill("Ada");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.com");
    await page.getByLabel("Demo password").fill("demo-only-password");
    await page
      .getByRole("button", { name: "Create demo account", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Make room for a guide." }),
    ).toBeVisible();
    expect(
      await page.evaluate(() => JSON.stringify({ ...sessionStorage })),
    ).not.toContain("demo-only-password");
    await page.getByRole("button", { name: "Skip onboarding" }).click();
    await expect(
      page.getByRole("heading", { name: "Hello, Ada." }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Replay onboarding" }).click();
    await page.getByRole("button", { name: "Try the demonstration" }).click();
    await page.getByRole("button", { name: "Finish onboarding" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    expect(
      await page.evaluate(() => sessionStorage.getItem("tholi-demo-account")),
    ).toBeNull();
    await page.goto("/download");
    const metadata = await page.request.get("/downloads/manifest.json");
    const manifest =
      metadata.ok() &&
      metadata.headers()["content-type"]?.includes("application/json")
        ? await metadata.json()
        : undefined;
    if (manifest) {
      await expect(
        page.getByRole("link", {
          name: "Download extension preview",
          exact: true,
        }),
      ).toHaveAttribute("href", manifest.url);
      if (width === 375) {
        const archive = await page.request.get(manifest.url);
        expect(
          createHash("sha256")
            .update(await archive.body())
            .digest("hex"),
        ).toBe(manifest.sha256);
      }
    } else {
      // A fresh checkout has no eligible release yet. Never fabricate one for CI.
      await expect(page.getByRole("status")).toContainText(
        "No packaged download is available",
      );
      await expect(
        page.getByRole("link", {
          name: "Download extension preview",
          exact: true,
        }),
      ).toHaveCount(0);
    }
    await page.screenshot({
      path: info.outputPath(`download-${width}.png`),
      fullPage: true,
    });
  });
test("reduced motion, dark theme, sign-in and long content", async ({
  page,
}, info) => {
  await page.emulateMedia({ colorScheme: "dark", reducedMotion: "reduce" });
  await page.goto("/signin");
  await page.getByLabel("Email", { exact: true }).fill("you@example.com");
  await page.getByLabel("Demo password").fill("short");
  await page.getByRole("button", { name: "Sign in to demo" }).click();
  await expect(page.getByRole("alert")).toContainText("at least 8 characters");
  await page.getByLabel("Demo password").fill("demo-only-password");
  await page.getByRole("button", { name: "Sign in to demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, you." }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("dark-welcome.png"),
    fullPage: true,
  });
});
