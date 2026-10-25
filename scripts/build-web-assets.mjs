import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { buildWebsiteBrand } from "./build-brand.mjs";

// Explicit local authoring command. Cloudflare builds copy the committed assets
// and never require a headless browser or font downloads.
await buildWebsiteBrand("apps/public");
const directory = "apps/public/media/social";
await mkdir(directory, { recursive: true });
const sources = {
  logo: "apps/public/media/tholi_brand_logo.png",
  mark: "apps/public/media/tholi_icon.png",
  display:
    "node_modules/@fontsource-variable/newsreader/files/newsreader-latin-wght-normal.woff2",
  body: "node_modules/@fontsource-variable/source-sans-3/files/source-sans-3-latin-wght-normal.woff2",
};
const bytes = Object.fromEntries(
  await Promise.all(
    Object.entries(sources).map(async ([key, file]) => [
      key,
      await readFile(file),
    ]),
  ),
);
const data = (key, mime) =>
  `data:${mime};base64,${bytes[key].toString("base64")}`;
const browser = await chromium.launch();
try {
  const page = await browser.newPage({
    viewport: { width: 1200, height: 630 },
    deviceScaleFactor: 1,
  });
  await page.setContent(`<!doctype html><html lang="en"><head><style>
    @font-face{font-family:Newsreader;src:url(${data("display", "font/woff2")})}
    @font-face{font-family:Source;src:url(${data("body", "font/woff2")})}
    *{box-sizing:border-box}body{margin:0;width:1200px;height:630px;background:#faf7f0;color:#101c17;font-family:Source,sans-serif;padding:64px 80px;position:relative}
    .logo{width:228px;height:auto}.mark{position:absolute;right:70px;top:212px;width:260px;height:260px}
    h1{font:500 86px/1.04 Newsreader,serif;letter-spacing:-2.2px;margin:48px 0 22px}
    p{font-size:28px;line-height:1.4;margin:0;color:#206654}.bottom{position:absolute;bottom:52px;left:80px;right:80px;display:flex;justify-content:space-between;align-items:center;border-top:1px solid #c8d5cb;padding-top:22px;font-size:22px;color:#206654}
  </style></head><body><img class="logo" src="${data("logo", "image/png")}" alt="Tholi"><h1>Your next step,<br>made clear.</h1><p>Local website guidance.<br>You stay in control.</p><img class="mark" src="${data("mark", "image/png")}" alt=""><div class="bottom"><span>Available on Chrome and Firefox</span><strong>tholi.io</strong></div></body></html>`);
  await page.evaluate(async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((image) => image.decode()));
  });
  await page.screenshot({
    path: `${directory}/tholi-social.png`,
    animations: "disabled",
  });
} finally {
  await browser.close();
}
await writeFile(
  `${directory}/provenance.json`,
  JSON.stringify(
    {
      dimensions: { width: 1200, height: 630 },
      sources: Object.fromEntries(
        Object.entries(sources).map(([key, path]) => [
          path,
          createHash("sha256").update(bytes[key]).digest("hex"),
        ]),
      ),
      generator: "scripts/build-web-assets.mjs",
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Generated website icons and 1200 x 630 social banner from the existing Tholi assets.",
);
