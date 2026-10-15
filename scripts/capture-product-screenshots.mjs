// Capture the shipped extension in a disposable profile, never a personal account.
// Requires Node 24, the built extension, and Playwright Chromium.
import { expect } from "@playwright/test";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { openNavigatorExtension } from "../tests/support/navigator-extension.ts";

const directory = "apps/public/media/screenshots";
await mkdir(directory, { recursive: true });
await mkdir("output/qa/product-sources", { recursive: true });
const app = await openNavigatorExtension(
  { width: 1440, height: 960 },
  [],
  false,
);
const captures = [];
const site = "https://en.wikipedia.org/wiki/Ada_Lovelace";
const goal = "Make the text larger";
const save = async (name, page, description) => {
  const png = await page.screenshot({ animations: "disabled" });
  await writeFile(`output/qa/product-sources/${name}.png`, png);
  const path = `${directory}/${name}.webp`;
  await sharp(png).webp({ quality: 92, effort: 6 }).toFile(path);
  const metadata = await sharp(path).metadata();
  captures.push({
    file: `${name}.webp`,
    width: metadata.width,
    height: metadata.height,
    sha256: createHash("sha256")
      .update(await readFile(path))
      .digest("hex"),
    description,
  });
};
try {
  await app.page.goto(site, { waitUntil: "networkidle" });
  await expect(
    app.page
      .getByRole("heading", { name: "Ada Lovelace", exact: true })
      .first(),
  ).toBeVisible();
  await app.start();
  await app.panel.evaluate(async () =>
    chrome.runtime.sendMessage({
      type: "UI_SAVE",
      preferences: { advanced: false },
    }),
  );
  await app.panel.getByLabel("Navigation goal").fill(goal);
  await app.page.bringToFront();
  for (let attempt = 0; attempt < 3; attempt++) {
    const result = await app.panel.evaluate(async (text) => {
      const context = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
      return chrome.runtime.sendMessage({
        type: "SET_GOAL",
        goal: text,
        revision: context.page.revision,
      });
    }, goal);
    console.log(
      "Planning attempt",
      attempt + 1,
      result?.error || result?.view?.goalPlan?.status || "submitted",
    );
    if ((await app.view())?.selectedControlId) break;
  }
  await expect
    .poll(async () => (await app.view())?.selectedControlId, { timeout: 15000 })
    .toBeTruthy();
  const guiding = await app.view();
  if (guiding.goalPlan.status !== "guiding")
    throw Error("Capture requires genuine grounded guidance");
  console.log(
    "Observed guidance:",
    guiding.controls.find((control) => control.id === guiding.selectedControlId)
      ?.label,
  );
  await app.panel.evaluate(async () => {
    await chrome.storage.local.set({
      tholiWidgetBounds: { width: 396, height: 560, x: 24, y: 320 },
    });
    await chrome.runtime.sendMessage({
      type: "UI_SAVE",
      preferences: { mode: "guide", surface: "widget", advanced: false },
    });
  });
  await expect
    .poll(() =>
      app.page
        .frames()
        .find((frame) => frame.url().includes("/widget.html?grant="))
        ?.url(),
    )
    .toBeTruthy();
  const widget = app.page
    .frames()
    .find((frame) => frame.url().includes("/widget.html?grant="));
  const widen = async () => {
    const cdp = await app.context.newCDPSession(app.page);
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    await cdp.send("Browser.setWindowBounds", {
      windowId,
      bounds: { width: 1600, height: 1100 },
    });
    await cdp.detach();
  };
  await widen();
  await expect(widget.getByLabel("Current guidance")).toBeVisible();
  await app.page.evaluate(() => document.fonts.ready);
  await widget.evaluate(() => document.fonts.ready);
  await save(
    "live-guidance",
    app.page,
    "The actual Tholi widget and page highlight guide a text-size request on public Wikipedia.",
  );
  await app.panel.setViewportSize({ width: 420, height: 760 });
  await app.panel.evaluate(() => document.fonts.ready);
  await save(
    "guide-panel",
    app.panel,
    "Actual extension Guide interface, captured from its extension page while the public page remains active.",
  );
  await widget
    .getByRole("button", { name: "Conversation", exact: true })
    .evaluate((element) => element.click());
  await widget.getByLabel("Navigation goal").fill("Why this step?");
  await widget
    .getByRole("button", { name: "Send", exact: true })
    .evaluate((element) => element.click());
  await expect(
    widget.getByLabel("Conversation", { exact: true }),
  ).toContainText(guiding.goalPlan.reason);
  await expect(
    app.panel.getByLabel("Conversation", { exact: true }),
  ).toContainText(guiding.goalPlan.reason);
  // Scroll to the actual question and response, keeping the fixed instruction visible.
  await app.panel.evaluate(() => {
    const body = document.querySelector(".tholi-body");
    const question = [...document.querySelectorAll(".tholi-message.user")].at(
      -1,
    );
    if (body && question) body.scrollTop = question.offsetTop - 12;
  });
  await save(
    "conversation-panel",
    app.panel,
    "Actual local Conversation interface answering Why this step from the current route evidence.",
  );
  await widget
    .getByRole("button", { name: "Guide", exact: true })
    .evaluate((element) => element.click());
  await app.page.bringToFront();
  await widen();
  const large = app.page.getByLabel("Large", { exact: true });
  if (!(await large.isVisible()))
    await app.page
      .getByRole("button", { name: /Appearance/ })
      .first()
      .click();
  await large.check();
  await expect
    .poll(async () => (await app.view())?.goalPlan?.status, { timeout: 20000 })
    .toBe("completed");
  await expect(
    widget.locator('.tholi-current[data-phase="arrived"]'),
  ).toBeVisible();
  await save(
    "verified-arrival",
    app.page,
    "After the text-size option is changed on Wikipedia, the actual extension reports a verified arrival.",
  );
  await writeFile(
    `${directory}/provenance.json`,
    JSON.stringify(
      {
        capturedAt: new Date().toISOString(),
        extensionVersion: JSON.parse(
          await readFile("dist/extension/manifest.json", "utf8"),
        ).version,
        source: site,
        request: goal,
        capture:
          "Disposable Chromium profile, public page, actual loaded extension. Viewports are captured without altered UI or invented overlays; PNG sources are retained under output/qa/product-sources.",
        captures,
      },
      null,
      2,
    ) + "\n",
  );
  console.log("Saved", captures.length, "actual extension screenshots");
} finally {
  await app.close();
}
