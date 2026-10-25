import { test, expect, deterministicNetwork } from "../../support/browser-test";
import { readFile } from "node:fs/promises";
import sharp from "sharp";
import {
  publicPages,
  absoluteUrl,
} from "../../../apps/web/src/features/seo/metadata";

test("search metadata and documentation are present in production HTML without JavaScript", async ({
  browser,
  baseURL,
}) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  await deterministicNetwork(context);
  try {
    const page = await context.newPage();
    for (const route of publicPages) {
      // Explicit .html files also verify Cloudflare's slashless asset convention.
      const file = route.path === "/" ? "/" : route.path + ".html";
      const response = await page.goto(baseURL + file);
      expect(response!.ok()).toBe(true);
      await expect(page.locator("main h1")).toBeVisible();
      await expect(page).toHaveTitle(route.title);
      const head = page.locator("head");
      await expect(
        head.locator('meta[name="apple-mobile-web-app-title"]'),
      ).toHaveAttribute("content", "Tholi");
      await expect(head.locator('link[rel="canonical"]')).toHaveAttribute(
        "href",
        absoluteUrl(route.path),
      );
      await expect(head.locator('meta[name="description"]')).toHaveAttribute(
        "content",
        route.description,
      );
      await expect(head.locator('meta[name="robots"]')).toHaveAttribute(
        "content",
        route.index
          ? "index, follow, max-image-preview:large"
          : "noindex, follow",
      );
      expect(await page.locator("main").textContent()).not.toContain(
        "Opening this page",
      );
      expect(
        JSON.parse(
          (await head
            .locator('script[type="application/ld+json"]')
            .textContent()) || "{}",
        )["@graph"].length,
      ).toBeGreaterThan(2);
      if (route.path === "/contact") {
        await expect(page.locator(".contact-form-area form")).toBeHidden();
        await expect(
          page.locator('.contact-form-area button[type="submit"]'),
        ).toBeDisabled();
      }
    }
    await page.goto(baseURL + "/download.html");
    for (const [name, url] of [
      [
        "Chrome",
        "https://chromewebstore.google.com/detail/tholi/pliafmeneaalhbecphnodbifdfcajngk",
      ],
      ["Firefox", "https://addons.mozilla.org/en-US/firefox/addon/tholi/"],
    ]) {
      const link = page
        .locator(".browser-install-options")
        .getByRole("link", { name: `Add to ${name}`, exact: true });
      await page.route(url, (route) =>
        route.fulfill({ contentType: "text/html", body: "Store fixture" }),
      );
      await link.click();
      await expect(page).toHaveURL(url);
      await page.goBack();
    }
  } finally {
    await context.close();
  }
});

test("documentation SEO follows client navigation and Back without duplicate metadata or stale canonicals", async ({
  page,
}) => {
  await page.goto("/download?browser=firefox#installation-firefox");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://tholi.io/download",
  );
  await page
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("link", { name: "Docs", exact: true })
    .click();
  await page
    .getByRole("navigation", { name: "Documentation chapters" })
    .getByRole("link", { name: "Getting started", exact: true })
    .click();
  await expect(page).toHaveTitle("Getting started | Tholi documentation");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://tholi.io/docs/getting-started",
  );
  await expect(
    page.locator('link[rel="alternate"][type="text/markdown"]'),
  ).toHaveAttribute("href", "https://tholi.io/docs/getting-started.md");
  await page.goBack();
  await expect(page).toHaveTitle(
    "Tholi documentation | Setup, guidance and privacy",
  );
  await expect(
    page.locator('link[rel="alternate"][type="text/markdown"]'),
  ).toHaveCount(0);
  await expect(page.locator('link[rel="canonical"]')).toHaveCount(1);
  await expect(page.locator('script[type="application/ld+json"]')).toHaveCount(
    1,
  );
  await page.goto("/unknown-public-route");
  await expect(page.locator('meta[name="robots"]')).toHaveAttribute(
    "content",
    "noindex, follow",
  );
  await page.goto("/about/");
  await expect(page.locator("main h1")).toContainText("A patient guide");
  await expect(page.locator('link[rel="canonical"]')).toHaveAttribute(
    "href",
    "https://tholi.io/about",
  );
});

test("documentation sitemap, crawler guidance and brand assets have real content and correct formats", async ({
  page,
}) => {
  const sitemap = await page.request.get("/sitemap.xml");
  expect(sitemap.headers()["content-type"]).toContain("xml");
  const locations = await page.evaluate(
    (xml) =>
      [
        ...new DOMParser()
          .parseFromString(xml, "text/xml")
          .querySelectorAll("loc"),
      ].map((element) => element.textContent),
    await sitemap.text(),
  );
  expect(locations).toEqual(
    publicPages
      .filter((page) => page.index)
      .map((page) => absoluteUrl(page.path)),
  );
  const robots = await page.request.get("/robots.txt");
  expect(await robots.text()).toContain("User-agent: *\nAllow: /");
  expect(await robots.text()).toContain(
    "Sitemap: https://tholi.io/sitemap.xml",
  );
  for (const path of [
    "/llms.txt",
    "/llms-full.txt",
    "/docs/getting-started.md",
  ]) {
    const response = await page.request.get(path);
    expect(response.ok()).toBe(true);
    expect(await response.text()).not.toMatch(/<!doctype html>/i);
    expect(await response.text()).not.toContain("\u2014");
  }
  expect(
    await (await page.request.get("/docs/using-tholi.md")).text(),
  ).toContain("https://tholi.io/docs/appearance");
  for (const [path, size] of [
    ["/icons/favicon-32.png", 32],
    ["/icons/favicon-96.png", 96],
    ["/apple-touch-icon.png", 180],
    ["/icons/icon-192.png", 192],
    ["/icons/icon-512.png", 512],
    ["/icons/maskable-512.png", 512],
  ] as const) {
    const response = await page.request.get(path);
    expect(response.headers()["content-type"]).toContain("image/png");
    const metadata = await sharp(await response.body()).metadata();
    expect([metadata.width, metadata.height]).toEqual([size, size]);
    expect(metadata.hasAlpha).toBe(false);
  }
  const image = await page.request.get("/media/social/tholi-social.png");
  const dimensions = await sharp(await image.body()).metadata();
  expect([dimensions.width, dimensions.height]).toEqual([1200, 630]);
  const ico = await (await page.request.get("/favicon.ico")).body();
  expect(ico.readUInt16LE(2)).toBe(1);
  expect(ico.readUInt16LE(4)).toBe(3);
  const manifest = await (await page.request.get("/site.webmanifest")).json();
  expect(manifest.display).toBe("browser");
  expect(manifest.icons.map((icon: { sizes: string }) => icon.sizes)).toEqual([
    "192x192",
    "512x512",
    "512x512",
  ]);
  const redirects = await readFile("dist/web/_redirects", "utf8");
  for (const path of ["signin", "signup", "welcome"])
    expect(redirects).toContain(`/${path} /download 301`);
  const notFoundRobots = await page.evaluate(
    (html) =>
      new DOMParser()
        .parseFromString(html, "text/html")
        .querySelector('meta[name="robots"]')
        ?.getAttribute("content"),
    await readFile("dist/web/404.html", "utf8"),
  );
  expect(notFoundRobots).toBe("noindex, follow");
});
