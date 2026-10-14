import { test, expect } from "@playwright/test";
import { createHash } from "node:crypto";
for (const width of [375, 768, 1440])
  test(`Tholi website ${width}px onboarding and download integrity`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto("http://127.0.0.1:5174/");
    await expect(
      page.getByRole("heading", { name: "Find your way forward." }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
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
    });
    await page.goto("http://127.0.0.1:5174/signup");
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
    await page.goto("http://127.0.0.1:5174/download");
    const metadata = await page.request.get(
      "http://127.0.0.1:5174/downloads/manifest.json",
    );
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
        const archive = await page.request.get(
          "http://127.0.0.1:5174" + manifest.url,
        );
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
  await page.goto("http://127.0.0.1:5174/signin");
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
