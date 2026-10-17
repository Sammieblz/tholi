import { expect, test } from "@playwright/test";
import { createConsent } from "../../apps/web/src/features/preferences/cookies";

test("documentation search, fragments, source links and browser Back stay usable", async ({
  page,
}) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await page.goto("/docs");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Make yourself at home.",
  );
  const search = page.getByRole("searchbox", { name: "Search documentation" });
  await search.fill("Widget menu");
  const results = page.getByRole("navigation", {
    name: "Documentation search results",
  });
  await expect(results.getByRole("status")).toContainText(/articles? found/);
  await results.getByRole("link", { name: "Using Tholi", exact: true }).click();
  await expect(page).toHaveURL(/\/docs\/using-tholi$/);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Using Tholi",
  );
  await search.clear();
  const contents = page.getByRole("navigation", { name: "On this page" });
  await contents
    .getByRole("link", { name: "Widget and continuity", exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/using-tholi#widget-and-continuity$/);
  await expect(page.locator("#widget-and-continuity")).toBeFocused();
  await expect(page.locator(".docs-content")).toContainText("Widget menu");
  await expect(
    page.getByRole("link", { name: "Read the Markdown source" }),
  ).toHaveAttribute(
    "href",
    "https://github.com/Sammieblz/web-navigator/blob/main/docs/tholi-ui.md",
  );
  await page
    .getByRole("navigation", { name: "Documentation chapters" })
    .getByRole("link", { name: "Security and boundaries", exact: true })
    .click();
  await expect(page).toHaveURL(/\/docs\/security$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/docs\/using-tholi#widget-and-continuity$/);
  await expect(page.locator("#widget-and-continuity")).toBeFocused();
  await page.goto("/docs/journeys#context-and-continuity");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Continuous journeys",
  );
  await expect(page.locator("#context-and-continuity")).toBeFocused();
  await expect(page.locator("main")).toHaveCount(1);
  await expect(page.locator(".docs-prose img")).toHaveCount(0);
  await search.fill("a-phrase-that-does-not-exist");
  await expect(
    page
      .getByRole("navigation", { name: "Documentation search results" })
      .getByRole("status"),
  ).toHaveText("0 articles found");
  await expect(
    page.getByText("Try a shorter phrase, such as permissions or widget."),
  ).toBeVisible();
});

test("launch drafts disclose the operator and open working cookie choices", async ({
  page,
  context,
}) => {
  await page.goto("/privacy");
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Your information, in plain sight.",
  );
  await expect(page.locator(".legal-draft-note")).toContainText(
    "Launch-review draft",
  );
  await expect(page.locator(".legal-prose")).toContainText("ILUNỌNSEN LLC");
  await expect(page.locator(".legal-prose")).toContainText(
    "Ohio, United States",
  );
  await expect(
    page
      .locator(".legal-prose")
      .getByRole("link", { name: "info@ilunonsen.com" })
      .first(),
  ).toHaveAttribute("href", "mailto:info@ilunonsen.com");
  await page
    .getByRole("button", { name: "Essential only", exact: true })
    .click();
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "tholi_theme"),
  ).toBe(false);
  await page
    .getByRole("navigation", { name: "Privacy notice contents" })
    .getByRole("link", { name: "Terms", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "A clear understanding.",
  );
  await expect(
    page
      .locator(".legal-prose")
      .getByRole("link", { name: "MIT License", exact: true }),
  ).toHaveAttribute(
    "href",
    "https://github.com/Sammieblz/web-navigator/blob/main/LICENSE",
  );
  await page
    .getByRole("navigation", { name: "Terms of use contents" })
    .getByRole("link", { name: "Cookies", exact: true })
    .click();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(
    "Small files. Clear choices.",
  );
  await expect(page.getByRole("table")).toContainText("tholi_consent");
  await expect(page.getByRole("table")).toContainText("180 days");
  await page
    .locator(".legal-prose")
    .getByRole("button", { name: "Cookie settings", exact: true })
    .click();
  const dialog = page.getByRole("dialog", { name: "Cookie settings" });
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("No provider is configured");
  await dialog
    .getByRole("checkbox", { name: /Appearance preferences/ })
    .check();
  await dialog
    .getByRole("button", { name: "Save choices", exact: true })
    .click();
  await expect(dialog).toHaveCount(0);
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "tholi_theme"),
  ).toBe(true);
  await page
    .locator("footer")
    .getByRole("button", { name: "Cookie settings", exact: true })
    .click();
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole("button", { name: "Essential only", exact: true })
    .click();
  expect(
    (await context.cookies()).some((cookie) => cookie.name === "tholi_theme"),
  ).toBe(false);
  await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
});

test("all website routes reflow at four widths in both deliberate appearances", async ({
  context,
  baseURL,
}, info) => {
  test.setTimeout(180_000);
  const routes = [
    "/",
    "/about",
    "/download",
    "/signup",
    "/signin",
    "/onboarding",
    "/welcome",
    "/docs",
    "/docs/security",
    "/privacy",
    "/terms",
    "/cookies",
  ];
  const measurements: {
    route: string;
    theme: string;
    width: number;
    contentWidth: number;
  }[] = [];
  for (const theme of ["dark", "light"] as const) {
    await context.addCookies([
      {
        name: "tholi_consent",
        value: encodeURIComponent(JSON.stringify(createConsent(true))),
        url: baseURL!,
        sameSite: "Lax",
      },
      { name: "tholi_theme", value: theme, url: baseURL!, sameSite: "Lax" },
    ]);
    for (const width of [320, 375, 768, 1440]) {
      // A fresh renderer per layout group releases Vite's development-module
      // connections. Ninety-six document reloads in one renderer can otherwise
      // hit Chromium ERR_INSUFFICIENT_RESOURCES before a lazy article mounts.
      const page = await context.newPage();
      await page.emulateMedia({
        reducedMotion: "reduce",
        colorScheme: "light",
      });
      await page.setViewportSize({ width, height: 960 });
      for (const route of routes) {
        await page.goto(route, { waitUntil: "domcontentloaded" });
        await expect(page.locator("html")).toHaveAttribute(
          "data-tholi-theme",
          theme,
        );
        await expect(page.locator("main h1")).toHaveCount(1);
        await expect(page.locator("main h1")).toBeVisible();
        await page.evaluate(() => document.fonts.ready);
        const contentWidth = await page.evaluate(() =>
          Math.max(
            document.documentElement.scrollWidth,
            document.body.scrollWidth,
          ),
        );
        expect(
          contentWidth,
          `${theme} ${width}px ${route} horizontal overflow`,
        ).toBeLessThanOrEqual(width + 1);
        measurements.push({ route, theme, width, contentWidth });
        const selected =
          (theme === "dark" && width === 320 && route === "/docs/security") ||
          (theme === "light" && width === 320 && route === "/cookies") ||
          (theme === "dark" && width === 1440 && route === "/") ||
          (theme === "light" && width === 768 && route === "/about");
        if (selected)
          await page.screenshot({
            path: info.outputPath(
              `${theme}-${width}-${route.replace(/\//g, "-") || "home"}.png`,
            ),
            animations: "disabled",
          });
      }
      await page.close();
    }
  }
  expect(measurements).toHaveLength(96);
  await info.attach("website-route-layouts", {
    body: JSON.stringify(measurements),
    contentType: "application/json",
  });
});
