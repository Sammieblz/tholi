import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Page } from "@playwright/test";

/** Mount actual shared components without marketing styles or a dev server. */
export async function mountPresentationFixture(
  page: Page,
  name: "sidebar" | "widget",
) {
  await page.route("**/__tholi_fixtures/*", async (route) => {
    const file = new URL(route.request().url()).pathname.split("/").pop()!;
    if (file === "shell")
      return route.fulfill({
        contentType: "text/html",
        body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body></body></html>',
      });
    const contentType = file.endsWith(".js")
      ? "text/javascript"
      : file.endsWith(".css")
        ? "text/css"
        : file.endsWith(".woff2")
          ? "font/woff2"
          : undefined;
    if (!contentType || !/^[\w.-]+$/.test(file))
      return route.fulfill({ status: 404, body: "Unknown fixture asset" });
    await route.fulfill({
      contentType,
      body: await readFile(join("dist/test-fixtures", file)),
    });
  });
  await page.goto("/__tholi_fixtures/shell");
  await page.addStyleTag({
    url: `/__tholi_fixtures/${name}-presentation.css`,
  });
  await page.addScriptTag({
    url: `/__tholi_fixtures/${name}-presentation.js`,
  });
}
