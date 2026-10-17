import { chromium } from "playwright";
import { mkdir, writeFile, access } from "node:fs/promises";
import { createHash } from "node:crypto";
const root = "tests/fixtures/reliability-vision";
if (
  await access(root + "/corpus.json").then(
    () => true,
    () => false,
  )
)
  throw Error("Frozen corpus already exists; do not regenerate it.");
await mkdir(root, { recursive: true });
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 960, height: 600 } });
const targets = [
  "Manage Membership",
  "Continue to cancel",
  "Privacy policy",
  "Deploy website",
];
const cases = [];
try {
  for (let i = 0; i < 32; i++) {
    const target = targets[i % 4],
      dark = i % 2 === 1,
      category = i < 20 ? "supported" : i < 26 ? "ambiguous" : "absent";
    await page.setContent('<canvas width="960" height="600"></canvas>');
    await page.evaluate(
      ({ target, dark, category, i }) => {
        const c = document.querySelector("canvas").getContext("2d");
        c.fillStyle = dark ? "#131820" : "#ffffff";
        c.fillRect(0, 0, 960, 600);
        c.fillStyle = dark ? "#e6edf3" : "#14212e";
        c.font = "24px Arial";
        c.fillText("Your account", 35, 55);
        c.font = `${i % 3 === 0 ? 16 : 22}px Arial`;
        c.fillText("Account settings", 35, 115);
        c.fillText("Orders", 35, 160);
        c.fillText(
          category === "absent" ? "Contact support" : target,
          315,
          220,
        );
        if (category === "ambiguous") c.fillText(target, 315, 365);
        c.font = "14px Arial";
        c.fillText("You make every click on the website.", 35, 540);
      },
      { target, dark, category, i },
    );
    const bytes = await page.locator("canvas").screenshot();
    const file = `ui-${String(i + 1).padStart(2, "0")}.png`;
    await writeFile(root + "/" + file, bytes);
    cases.push({
      id: i + 1,
      file,
      sha256: createHash("sha256").update(bytes).digest("hex"),
      split: i % 4 === 0 ? "calibration" : "held-out",
      category,
      target,
      expectedBox:
        category === "absent"
          ? null
          : { x: 300, y: 190, width: 300, height: 45 },
      theme: dark ? "dark" : "light",
      width: 960,
      height: 600,
      canvas: true,
    });
  }
  const bytes =
    JSON.stringify(
      {
        version: 1,
        description: "Authored UI fixtures; no authenticated screenshots.",
        cases,
      },
      null,
      2,
    ) + "\n";
  await writeFile(root + "/corpus.json", bytes);
  await writeFile(
    root + "/corpus.sha256",
    createHash("sha256").update(bytes).digest("hex") + "\n",
  );
} finally {
  await browser.close();
}
