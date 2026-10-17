import { test, expect } from "../../support/browser-test";

test("website starts dark on a light OS and persists appearance only after consent", async ({
  page,
  context,
}) => {
  await page.emulateMedia({ colorScheme: "light" });
  await page.goto("/download");
  await expect(page.locator("html")).toHaveAttribute(
    "data-tholi-theme",
    "dark",
  );
  await expect(
    page.getByRole("region", { name: "Cookie choices" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Allow preferences", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  const stored = await context.cookies();
  expect(stored.find((cookie) => cookie.name === "tholi_theme")?.value).toBe(
    "light",
  );
  const consent = stored.find((cookie) => cookie.name === "tholi_consent")!;
  expect(consent.sameSite).toBe("Lax");
  expect(consent.path).toBe("/");
  expect(consent.domain).not.toMatch(/^\./);
  expect(consent.expires - Date.now() / 1000).toBeGreaterThan(179 * 86400);
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-tholi-theme",
    "light",
  );
  await expect(
    page.getByRole("region", { name: "Cookie choices" }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Cookie settings", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Essential only", exact: true })
    .click();
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "tholi_theme"),
  ).toBe(false);
  // Withdrawing storage preserves the chosen appearance on the open page.
  await expect(page.locator("html")).toHaveAttribute(
    "data-tholi-theme",
    "light",
  );
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-tholi-theme",
    "dark",
  );
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "tholi_theme"),
  ).toBe(false);
});

test("malformed, expired and unknown cookie records grant no preference storage", async ({
  page,
  context,
  baseURL,
}) => {
  const now = Date.now();
  const current = {
    version: 1,
    savedAt: now - 1000,
    expiresAt: now + 86400_000,
    preferences: true,
    analytics: null,
  };
  for (const value of [
    "%E0%A4%A",
    encodeURIComponent(JSON.stringify({ ...current, expiresAt: now - 1 })),
    encodeURIComponent(JSON.stringify({ ...current, version: 2 })),
  ]) {
    await context.clearCookies();
    await context.addCookies([
      { name: "tholi_consent", value, url: baseURL! },
      { name: "tholi_theme", value: "light", url: baseURL! },
    ]);
    await page.goto("/download");
    await expect(page.locator("html")).toHaveAttribute(
      "data-tholi-theme",
      "dark",
    );
    await expect(
      page.getByRole("region", { name: "Cookie choices" }),
    ).toBeVisible();
    await expect
      .poll(async () =>
        (await context.cookies()).some(
          (cookie) => cookie.name === "tholi_theme",
        ),
      )
      .toBe(false);
  }
  await page
    .getByRole("button", { name: "Essential only", exact: true })
    .click();
  await expect(
    page.getByRole("region", { name: "Cookie choices" }),
  ).toHaveCount(0);
});

test("blocked browser storage keeps theme and cookie choices usable in memory", async ({
  page,
}) => {
  await page.addInitScript(() => {
    Object.defineProperty(Document.prototype, "cookie", {
      configurable: true,
      get() {
        throw new DOMException("Cookies blocked", "SecurityError");
      },
      set() {
        throw new DOMException("Cookies blocked", "SecurityError");
      },
    });
  });
  await page.goto("/download");
  await page
    .getByRole("button", { name: "Allow preferences", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Switch to light mode", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute(
    "data-tholi-theme",
    "light",
  );
  await page
    .getByRole("button", { name: "Cookie settings", exact: true })
    .click();
  await expect(page.getByRole("dialog").getByRole("status")).toContainText(
    "blocking cookie storage",
  );
  await page.keyboard.press("Escape");
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute(
    "data-tholi-theme",
    "dark",
  );
  await expect(
    page.getByRole("region", { name: "Cookie choices" }),
  ).toBeVisible();
});

test("cookie settings are keyboard accessible at narrow widths with inactive analytics", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.emulateMedia({ reducedMotion: "reduce" });
  const analyticsRequests: string[] = [];
  page.on("request", (request) => {
    if (
      /\/analytics(?:[/?]|$)|google-analytics|plausible|segment\.com/.test(
        request.url(),
      )
    )
      analyticsRequests.push(request.url());
  });
  await page.goto("/download");
  const banner = page.getByRole("region", { name: "Cookie choices" });
  // The Download route is lazy. Wait for its real content before measuring
  // the footer, otherwise the loading placeholder can move it after scrolling.
  await expect(page.locator(".install-grid")).toBeVisible();
  await expect(page.locator("main h1")).toBeFocused();
  await expect(
    page.getByText("Finding the packaged preview…", { exact: true }),
  ).toHaveCount(0);
  await page.evaluate(() => document.fonts.ready);
  for (const button of await banner.getByRole("button").all()) {
    const box = await button.boundingBox();
    expect(box!.height).toBeGreaterThanOrEqual(44);
    expect(box!.width).toBeGreaterThanOrEqual(44);
  }
  const footerBeforeChoice = page.getByRole("button", {
    name: "Cookie settings",
    exact: true,
  });
  await footerBeforeChoice.scrollIntoViewIfNeeded();
  await expect(footerBeforeChoice).toBeInViewport();
  const footerBox = await footerBeforeChoice.boundingBox();
  const bannerBox = await banner.boundingBox();
  expect(footerBox!.y + footerBox!.height).toBeLessThan(bannerBox!.y);
  await banner.getByRole("button", { name: "Settings", exact: true }).click();
  const dialog = page.getByRole("dialog", {
    name: "Cookie settings",
    exact: true,
  });
  await expect(dialog).toBeVisible();
  await expect(
    dialog.getByRole("button", { name: "Close cookie settings", exact: true }),
  ).toBeFocused();
  await expect(dialog).toContainText("No provider is configured");
  await expect(dialog.getByRole("checkbox")).toHaveCount(1);
  const preference = dialog.getByRole("checkbox", {
    name: /Appearance preferences/,
  });
  await preference.focus();
  await page.keyboard.press("Space");
  await expect(preference).toBeChecked();
  const focusOrder = [
    dialog.getByRole("link", { name: "Cookie details", exact: true }),
    dialog.getByRole("link", { name: "Privacy draft", exact: true }),
    dialog.getByRole("button", { name: "Essential only", exact: true }),
    dialog.getByRole("button", { name: "Save choices", exact: true }),
    dialog.getByRole("button", { name: "Close cookie settings", exact: true }),
    preference,
  ];
  for (let i = 0; i < 9; i++) {
    await page.keyboard.press("Tab");
    // Base UI wraps focus through a guard on the next animation frame.
    await expect(focusOrder[i % focusOrder.length]).toBeFocused();
  }
  await dialog
    .getByRole("button", { name: "Save choices", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  await expect
    .poll(() =>
      page
        .locator("html")
        .evaluate((element) =>
          element.style.getPropertyValue("--web-cookie-space"),
        ),
    )
    .toBe("");
  const footer = page.getByRole("button", {
    name: "Cookie settings",
    exact: true,
  });
  await footer.click();
  await expect(preference).toBeChecked();
  await page.keyboard.press("Escape");
  await expect(footer).toBeFocused();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(analyticsRequests).toEqual([]);
});
