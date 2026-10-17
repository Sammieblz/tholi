import { test, expect } from "../../support/browser-test";
import { createHash } from "node:crypto";
for (const width of [375])
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
      .getByRole("button", { name: "Find account settings", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Account menu", exact: true })
      .click();
    await page
      .getByRole("button", { name: "Account settings", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Account settings", exact: true }),
    ).toBeVisible();
    const demo = page.locator(".demo");
    await expect(demo.locator(".tholi-app[data-phase=arrived]")).toBeVisible();
    await demo
      .getByRole("button", { name: "Switch to Spanish", exact: true })
      .click();
    await demo
      .getByRole("button", { name: "Language: English", exact: true })
      .click();
    await demo.getByRole("button", { name: "Español", exact: true }).click();
    await expect(demo.locator(".tholi-app[data-phase=arrived]")).toHaveCount(0);
    await demo
      .getByRole("button", { name: "Save changes", exact: true })
      .click();
    await expect(demo.getByTestId("saved-language")).toHaveText("Español");
    await expect(demo.locator(".tholi-app[data-phase=arrived]")).toBeVisible();
    await page.screenshot({
      path: info.outputPath(`home-${width}.png`),
      fullPage: true,
      animations: "disabled",
    });
    await page.goto("/signup");
    await page.getByLabel("Name", { exact: true }).fill("Ada");
    await page.getByLabel("Email", { exact: true }).fill("ada@example.com");
    await page
      .getByLabel("Demo password", { exact: true })
      .fill("demo-only-password");
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
    await page
      .getByRole("radio", { name: "Conversation", exact: true })
      .check();
    await expect(
      page
        .locator(".demo")
        .getByRole("button", { name: "Conversation", exact: true }),
    ).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Finish onboarding" }).click();
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    expect(
      await page.evaluate(() => sessionStorage.getItem("tholi-demo-account")),
    ).toBeNull();
    await page.goto("/download");
    if (width === 375)
      expect(
        await page
          .locator(".install-grid")
          .evaluate(
            (grid) =>
              getComputedStyle(grid).gridTemplateColumns.split(" ").length,
          ),
      ).toBe(1);
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
  await page.getByLabel("Demo password", { exact: true }).fill("short");
  await page.getByRole("button", { name: "Sign in to demo" }).click();
  await expect(page.getByRole("alert")).toContainText("at least 8 characters");
  await page
    .getByLabel("Demo password", { exact: true })
    .fill("demo-only-password");
  await page.getByRole("button", { name: "Sign in to demo" }).click();
  await expect(
    page.getByRole("heading", { name: "Hello, you." }),
  ).toBeVisible();
  await page.screenshot({
    path: info.outputPath("dark-welcome.png"),
    fullPage: true,
  });
});

test("practice conversation retains context and verifies manual outcomes", async ({
  page,
}) => {
  await page.goto("/");
  const demo = page.locator(".demo");
  await demo
    .getByRole("button", { name: "Find account settings", exact: true })
    .click();
  await demo.getByRole("button", { name: "Conversation", exact: true }).click();
  const composer = demo.getByRole("textbox", { name: "Navigation goal" });
  await composer.fill("Why this step?");
  await demo.getByRole("button", { name: "Send", exact: true }).click();
  await expect(
    demo.getByRole("region", { name: "Conversation" }),
  ).toContainText("visible control in the sample website");
  await demo.getByRole("button", { name: "Guide", exact: true }).click();
  await demo
    .getByRole("button", { name: "Pause navigation", exact: true })
    .click();
  await demo.getByRole("button", { name: "Account menu", exact: true }).click();
  await demo
    .getByRole("button", { name: "Account settings", exact: true })
    .click();
  await expect(demo.locator(".tholi-app[data-phase=arrived]")).toHaveCount(0);
  await demo
    .getByRole("button", { name: "Resume navigation", exact: true })
    .click();
  await expect(demo.locator(".tholi-app[data-phase=arrived]")).toBeVisible();
  await expect(page.locator("main")).toHaveCount(1);
  await demo
    .getByRole("textbox", { name: "Navigation goal" })
    .fill("Do not change the language to Spanish");
  await demo.getByRole("button", { name: "Guide me", exact: true }).click();
  await expect(
    demo.locator(".tholi-app[data-phase=clarification]"),
  ).toBeVisible();
  await expect(demo.getByTestId("saved-language")).toHaveText("English");
  await expect(demo.locator(".demo-target")).toHaveCount(0);
});

test("mock form errors identify fields and focus the first invalid input", async ({
  page,
}) => {
  await page.goto("/signup");
  await page
    .getByRole("button", { name: "Create demo account", exact: true })
    .click();
  const email = page.getByLabel("Email", { exact: true });
  await expect(email).toBeFocused();
  await expect(email).toHaveAttribute("aria-invalid", "true");
  await expect(email).toHaveAttribute("aria-describedby", "demo-email-error");
  await email.fill("ada@example.com");
  await page
    .getByRole("button", { name: "Create demo account", exact: true })
    .click();
  await expect(page.getByLabel("Demo password", { exact: true })).toBeFocused();
  await expect(page.locator("#demo-password-error")).toContainText(
    "at least 8 characters",
  );
});

test("download loading and failed requests remain distinct from unavailable releases", async ({
  page,
}) => {
  let resolveRequest: (() => void) | undefined;
  const ready = new Promise<void>((resolve) => {
    resolveRequest = resolve;
  });
  let requests = 0;
  await page.route("**/downloads/manifest.json", async (route) => {
    requests++;
    if (requests === 1) {
      await ready;
      await route.fulfill({ status: 503, body: "Unavailable" });
    } else await route.fulfill({ status: 404, body: "Not found" });
  });
  await page.goto("/download");
  await expect(page.getByRole("status")).toContainText(
    "Finding the packaged preview",
  );
  await expect(
    page.getByText("No packaged download is available", { exact: false }),
  ).toHaveCount(0);
  resolveRequest?.();
  await expect(page.getByRole("status")).toContainText("could not be loaded");
  await page.getByRole("button", { name: "Try again", exact: true }).click();
  await expect(page.getByRole("status")).toContainText(
    "No packaged download is available",
  );
});
