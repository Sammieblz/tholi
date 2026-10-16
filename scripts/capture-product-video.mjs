// Record public pages with the actual built extension in a disposable profile.
// Nothing in this script writes journey state or creates outcome evidence.
// Requires Node 24, Playwright Chromium and a current dist/extension build.
import { expect } from "@playwright/test";
import { mkdir, readFile, writeFile, copyFile, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import sharp from "sharp";
import { openNavigatorExtension } from "../tests/support/navigator-extension.ts";
import { artifactFiles } from "./artifact-files.mjs";

const output = "apps/public/media/video";
const raw = "output/qa/product-video";
const size = { width: 1440, height: 960 };
const fps = 30;
const maxBytes = 5 * 1024 * 1024;
const requested =
  process.argv.find((arg) => arg.startsWith("--workflow="))?.split("=")[1] ||
  "auto";
if (!["auto", "github", "wikipedia"].includes(requested))
  throw Error("Use --workflow=auto, github or wikipedia");
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const beforeFiles = await artifactFiles("dist/extension");
const extensionVersion = JSON.parse(
  await readFile("dist/extension/manifest.json", "utf8"),
).version;
const workflows = {
  github: {
    source: "https://github.com/microsoft/playwright",
    request: "Open this repository’s pull requests.",
    label: "Opening pull requests on public GitHub",
    interaction: "Open the live Pull requests repository link.",
  },
  wikipedia: {
    source: "https://en.wikipedia.org/wiki/Ada_Lovelace",
    request: "Make the text larger",
    label: "Changing text size on Wikipedia",
    interaction: "Choose Large in Wikipedia’s Appearance controls.",
  },
};
await mkdir(output, { recursive: true });
await mkdir(raw, { recursive: true });
const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const stamp = (seconds) => {
  const ms = Math.max(0, Math.round(seconds * 1000));
  return `00:${String(Math.floor(ms / 60000)).padStart(2, "0")}:${String(Math.floor(ms / 1000) % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
};
async function widenWindow(app) {
  const cdp = await app.context.newCDPSession(app.page);
  try {
    const { windowId } = await cdp.send("Browser.getWindowForTarget");
    const actual = await app.page.evaluate(() => ({
      width: innerWidth,
      height: innerHeight,
    }));
    if (actual.width !== size.width || actual.height !== size.height) {
      const { bounds } = await cdp.send("Browser.getWindowBounds", {
        windowId,
      });
      await cdp.send("Browser.setWindowBounds", {
        windowId,
        bounds: {
          width: bounds.width + size.width - actual.width,
          height: bounds.height + size.height - actual.height,
        },
      });
    }
    await expect
      .poll(() =>
        app.page.evaluate(() => ({ width: innerWidth, height: innerHeight })),
      )
      .toEqual(size);
  } finally {
    await cdp.detach();
  }
}
async function checkFrame(data) {
  const { data: pixels, info } = await sharp(data)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  // Chromium pads an unexpectedly shrunken native window with flat #808080.
  // These public workflows have no legitimate large area in that exact tone.
  let padded = 0;
  let sampled = 0;
  for (let index = 0; index < pixels.length; index += info.channels * 16) {
    sampled++;
    if ([0, 1, 2].every((offset) => Math.abs(pixels[index + offset] - 128) < 3))
      padded++;
  }
  const uniformGrayFraction = padded / sampled;
  if (
    info.width !== size.width ||
    info.height !== size.height ||
    uniformGrayFraction > 0.15
  )
    throw Error(
      `Clipped screencast frame rejected: ${info.width}×${info.height}, ${Math.round(uniformGrayFraction * 100)}% Chromium padding`,
    );
  return { width: info.width, height: info.height, uniformGrayFraction };
}
async function submit(app, goal) {
  const reply = await app.panel.evaluate(async (goal) => {
    const current = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
    if (current.error) return current;
    return chrome.runtime.sendMessage({
      type: "SET_GOAL",
      goal,
      revision: current.page.revision,
    });
  }, goal);
  if (reply?.error) throw Error(reply.error);
}
async function waitForBinding(app) {
  await expect
    .poll(
      async () => {
        const state = await app.view();
        return (
          state?.goalPlan?.status === "guiding" && !!state.selectedControlId
        );
      },
      {
        timeout: 16000,
        message: "Fresh live discovery must bind the requested target",
      },
    )
    .toBe(true);
  const state = await app.view();
  return {
    state,
    control: state.controls.find(
      (control) => control.id === state.selectedControlId,
    ),
  };
}
async function setSiteTheme(app, workflow, theme) {
  // Use a real website preference, never recolor the captured DOM.
  await app.page.emulateMedia({ colorScheme: theme });
  if (workflow === "wikipedia") {
    // Wikipedia mounts its preference radios after its first HTML paint. A
    // premature visibility check can click Hide Appearance while it hydrates.
    await app.page.waitForLoadState("networkidle");
    const appearance = app.page
      .getByRole("button", { name: /Appearance/ })
      .first();
    const option = app.page.getByLabel(theme === "dark" ? "Dark" : "Light", {
      exact: true,
    });
    await option.waitFor({ state: "attached" });
    // A late banner or hydration can temporarily move the pinned appearance
    // panel. Retry its real control rather than force-clicking a hidden field.
    for (let attempt = 0; attempt < 3; attempt++) {
      if (!(await option.isVisible()) && (await appearance.isVisible()))
        await appearance.click();
      try {
        await option.check({ timeout: 5000 });
        break;
      } catch (error) {
        if (attempt === 2) throw error;
        await wait(500);
      }
    }
    // Keep the real preference surface mounted. This is the existing verified
    // Wikipedia benchmark: guide the requested preference, then verify its
    // changed state, rather than racing a second click against a menu replan.
    const pin = app.page.getByRole("button", {
      name: "move to sidebar",
      exact: true,
    });
    if (await pin.isVisible()) await pin.click();
  } else {
    const colorMode = await app.page
      .locator("html")
      .getAttribute("data-color-mode");
    if (colorMode !== "auto" && colorMode !== theme) {
      await app.page
        .getByRole("button", { name: "Appearance settings", exact: true })
        .click();
      await app.page
        .getByRole("menuitemradio", { name: new RegExp(`^${theme}`, "i") })
        .click();
    }
  }
}
async function capture(workflow, theme) {
  const definition = workflows[workflow];
  console.log(`Preparing ${workflow}/${theme} from the built extension`);
  const app = await openNavigatorExtension(
    size,
    workflow === "github" ? ["https://github.com/*"] : [],
    false,
    { nativeViewport: true },
  );
  const events = [];
  const path = `${raw}/${workflow}-${theme}.webm`;
  let latestFrame;
  let frameCount = 0;
  const sourceViewports = new Set();
  let recording = false;
  let start = 0;
  const event = (kind, text) =>
    events.push({ kind, at: (Date.now() - start) / 1000, text });
  try {
    await app.page.emulateMedia({ colorScheme: theme });
    await app.page.goto(definition.source, {
      waitUntil: "domcontentloaded",
      timeout: 30000,
    });
    if (workflow === "github")
      await expect(
        app.page.getByRole("navigation", { name: "Repository", exact: true }),
      ).toBeVisible();
    else
      await expect(
        app.page
          .getByRole("heading", { name: "Ada Lovelace", exact: true })
          .first(),
      ).toBeVisible();
    await setSiteTheme(app, workflow, theme);
    console.log(`${workflow}/${theme}: source ready, warming live discovery`);
    await app.start();
    await submit(app, definition.request);
    const warm = await waitForBinding(app);
    console.log(
      `${workflow}/${theme}: grounded warm target ${warm.control?.label}`,
    );
    if (
      !warm.control ||
      !(
        workflow === "github" ? /pull requests/i : /^(?:text:\s*)?large$/i
      ).test(warm.control.label)
    )
      throw Error(
        `Discovery bound an unexpected target: ${warm.control?.label || "none"}`,
      );
    // Model setup and priority discovery finish before recording. Reset only
    // through the same trusted session command available in the real interface.
    await app.panel.evaluate(() =>
      chrome.runtime.sendMessage({ type: "UI_RESET_SESSION" }),
    );
    await app.start();
    await app.panel.evaluate(
      async (bounds) => {
        await chrome.storage.local.set({ tholiWidgetBounds: bounds });
        await chrome.runtime.sendMessage({
          type: "UI_SAVE",
          preferences: { mode: "guide", surface: "widget", advanced: false },
          draft: "",
        });
      },
      { width: 420, height: 600, x: workflow === "github" ? 996 : 24, y: 324 },
    );
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
    await expect(widget.getByLabel("Navigation goal")).toBeVisible();
    await app.page.bringToFront();
    await app.page.evaluate(() => document.fonts.ready);
    await widget.evaluate(() => document.fonts.ready);
    await widenWindow(app);
    await app.page.screencast.start({
      path,
      size,
      fps,
      quality: 85,
      onFrame: ({ data, viewportWidth, viewportHeight }) => {
        latestFrame = data;
        frameCount++;
        sourceViewports.add(`${viewportWidth}x${viewportHeight}`);
      },
    });
    console.log(`${workflow}/${theme}: recording actual interactions`);
    recording = true;
    start = Date.now();
    event(
      "destination",
      `A real Tholi widget is open on ${workflow === "github" ? "a public GitHub repository" : "Wikipedia"}. Enter a destination once.`,
    );
    await wait(600);
    await widget
      .getByLabel("Navigation goal")
      .pressSequentially(definition.request, { delay: 45 });
    await wait(500);
    await widget.getByRole("button", { name: "Guide me", exact: true }).click();
    const { state, control } = await waitForBinding(app);
    event(
      "guidance",
      `Tholi highlights the live ${control.label} control and explains the next step.`,
    );
    await expect(
      widget.locator('.tholi-app[data-phase="guiding"]'),
    ).toBeVisible();
    await wait(1600);
    if (!latestFrame)
      throw Error("No genuine screencast frame is available for the poster");
    await checkFrame(latestFrame);
    // Derive the poster from the unaltered screencast. Taking a screenshot here
    // can restore Chromium's shared window to the narrow panel's native bounds.
    await sharp(latestFrame)
      .webp({ quality: 88 })
      .toFile(`${raw}/${workflow}-${theme}-poster.webp`);
    event("interaction", definition.interaction);
    await widenWindow(app);
    if (workflow === "github") {
      if (!/pull requests/i.test(control.label))
        throw Error("Only a grounded Pull requests link can be used");
      await app.page
        .getByRole("navigation", { name: "Repository", exact: true })
        .getByRole("link", { name: /^Pull requests/ })
        .click();
      await expect(app.page).toHaveURL(
        /\/microsoft\/playwright\/pulls(?:[?#].*)?$/,
      );
    } else {
      const large = app.page.getByLabel("Large", { exact: true });
      if (!(await large.isVisible())) {
        if (!/appearance/i.test(control.label))
          throw Error("The Large preference is not currently visible or bound");
        await app.page
          .getByRole("button", { name: /Appearance/ })
          .first()
          .click();
        await wait(700);
      }
      await large.check();
      await expect(large).toBeChecked();
    }
    // Website state AND worker completion are required. A click is not proof.
    await expect
      .poll(async () => (await app.view())?.goalPlan?.status, {
        timeout: 20000,
        message: "Worker must verify the requested outcome",
      })
      .toBe("completed");
    const final = await app.view();
    if (final.journey?.status !== "completed" || final.verifiedSteps < 1)
      throw Error("Arrival lacks a verified journey transition");
    await expect
      .poll(
        () =>
          app.page
            .frames()
            .find((frame) => frame.url().includes("/widget.html?grant="))
            ?.locator('.tholi-app[data-phase="arrived"]')
            .isVisible() || false,
      )
      .toBe(true);
    const arrivalWidget = app.page
      .frames()
      .find((frame) => frame.url().includes("/widget.html?grant="));
    await expect(
      arrivalWidget.locator('.tholi-current[data-phase="arrived"]'),
    ).toBeVisible();
    await expect(
      arrivalWidget.locator(
        '.tholi-current .tholi-wayfinder[data-state="arrived"]',
      ),
    ).toBeVisible();
    event(
      "arrival",
      workflow === "github"
        ? "The requested Pull requests destination is visible. Tholi reports verified arrival."
        : "Wikipedia’s Large text preference is selected. Tholi verifies the preference change and shows a completion check.",
    );
    await wait(2400);
    if (!latestFrame) throw Error("Arrival frame is missing");
    const arrivalFrame = await checkFrame(latestFrame);
    if (sourceViewports.size !== 1 || !sourceViewports.has("1440x960"))
      throw Error(
        `Source viewport changed during recording: ${[...sourceViewports].join(", ")}`,
      );
    const duration = (Date.now() - start) / 1000;
    await app.page.screencast.stop();
    recording = false;
    const bytes = (await stat(path)).size;
    if (bytes > maxBytes) throw Error(`Recording exceeds 5 MB: ${bytes}`);
    const base = `tholi-${workflow}-${theme}`;
    // Stage successful takes away from public assets. A later failed variant
    // must not leave a previously published manifest pointing at new bytes.
    await copyFile(path, `${raw}/${base}.webm`);
    await copyFile(
      `${raw}/${workflow}-${theme}-poster.webp`,
      `${raw}/${base}-poster.webp`,
    );
    const captions =
      "WEBVTT\n\n" +
      events
        .map(
          (entry, index) =>
            `${index + 1}\n${stamp(entry.at)} --> ${stamp(events[index + 1]?.at || duration)}\n${entry.text}\n`,
        )
        .join("\n");
    await writeFile(`${raw}/${base}.vtt`, captions);
    const assets = {};
    for (const [kind, name] of Object.entries({
      src: `${base}.webm`,
      poster: `${base}-poster.webp`,
      captions: `${base}.vtt`,
    })) {
      const data = await readFile(`${raw}/${name}`);
      assets[kind] = { file: name, bytes: data.length, sha256: sha(data) };
    }
    console.log(
      `${workflow}/${theme}: verified ${final.verifiedSteps} interaction(s), ${duration.toFixed(1)} seconds, ${bytes} bytes`,
    );
    return {
      theme,
      src: `/media/video/${base}.webm`,
      poster: `/media/video/${base}-poster.webp`,
      captions: `/media/video/${base}.vtt`,
      width: size.width,
      height: size.height,
      fps,
      durationSeconds: duration,
      bytes,
      sha256: assets.src.sha256,
      assets,
      events,
      frameValidation: {
        frameCount,
        sourceViewports: [...sourceViewports],
        arrivalFrame,
      },
      evidence: {
        initialDocument: {
          origin: state.page.origin,
          path: state.page.path,
          stateKey: state.page.stateKey,
          revision: state.page.revision,
        },
        finalDocument: {
          origin: final.page.origin,
          path: final.page.path,
          stateKey: final.page.stateKey,
          revision: final.page.revision,
        },
        actualFinalUrl: app.page.url(),
        workerPlanStatus: final.goalPlan.status,
        workerJourneyStatus: final.journey.status,
        verifiedSteps: final.verifiedSteps,
        reason: final.goalPlan.reason,
        transitions: final.journey.progress.map(
          ({ label, from, to, signature }) => ({ label, from, to, signature }),
        ),
      },
    };
  } catch (error) {
    await app.page
      .screenshot({ path: `${raw}/${workflow}-${theme}-failure.png` })
      .catch(() => {});
    const state = await app.view().catch(() => undefined);
    throw Object.assign(
      new Error(`${workflow}/${theme}: ${error.message.split("\n")[0]}`),
      {
        captureFailure: {
          workflow,
          theme,
          observedStatus: state?.goalPlan?.status || "not planned",
          observedReason: state?.goalPlan?.reason || "",
          observedRecoveryStage: state?.goalPlan?.recoveryStage || null,
        },
      },
    );
  } finally {
    if (recording) await app.page.screencast.stop().catch(() => {});
    await app.close();
  }
}

const attempts = [];
let selected = requested === "wikipedia" ? "wikipedia" : "github";
let light;
try {
  light = await capture(selected, "light");
} catch (error) {
  attempts.push({
    ...error.captureFailure,
    message: error.message,
    accepted: false,
  });
  if (requested !== "auto") throw error;
  console.log(
    "GitHub take was not eligible. Recording the explicitly labeled Wikipedia workflow.",
  );
  selected = "wikipedia";
  light = await capture(selected, "light");
}
const dark = await capture(selected, "dark");
if (
  JSON.stringify(beforeFiles) !==
  JSON.stringify(await artifactFiles("dist/extension"))
)
  throw Error(
    "Extension bytes changed during recording; rerun on a frozen build",
  );
const definition = workflows[selected];
for (const variant of [light, dark])
  for (const asset of Object.values(variant.assets))
    await copyFile(`${raw}/${asset.file}`, `${output}/${asset.file}`);
const transcriptFile = `tholi-${selected}-transcript.txt`;
const transcript =
  `${definition.label}\n\nPublic source: ${definition.source}\nRequest: ${definition.request}\n\nThis is the actual built extension in a disposable Chromium profile. The operator performs website interactions. No generated cursor, recreated controls or invented arrival state is present.\n\n` +
  light.events.map((event) => `${stamp(event.at)} ${event.text}`).join("\n") +
  "\n\nThe light and dark recordings follow the same real workflow. Playback is muted, with descriptive captions. Browser permission UI, signed-in dashboards and unrelated tasks are not validated by this demonstration.\n";
await writeFile(`${output}/${transcriptFile}`, transcript);
const provenance = {
  capturedAt: new Date().toISOString(),
  extensionVersion,
  extensionBuildSha256: sha(JSON.stringify(beforeFiles)),
  artifactFiles: beforeFiles,
  workflow: selected,
  ...definition,
  attempts,
  capture:
    "Playwright page.screencast, VP9 WebM, 1440 × 960 CSS pixels at 30 fps. Actual extension widget and live public website. Site theme changed using its genuine appearance controls. Disposable Chromium profile; no personal account, synthetic cursor, altered site UI or fabricated worker outcome.",
  permissionNote:
    "Wikipedia uses the shipped host permission. A GitHub attempt uses a disposable manifest-only host pregrant, equivalent to authorized discovery, and does not validate native Chrome permission activation.",
  skillsApplied: [
    "animate: motion used for product explanation, with actual interface timing preserved",
    "emil-design-eng: inspect real interactions instead of a marketing imitation",
    "animation-performance: no synthesized per-frame React animation or animated screenshot",
  ],
  variants: { light, dark },
  transcript: { file: transcriptFile, sha256: sha(Buffer.from(transcript)) },
};
await writeFile(
  `${output}/provenance.json`,
  JSON.stringify(provenance, null, 2) + "\n",
);
await writeFile(
  `${output}/manifest.json`,
  JSON.stringify(
    {
      schemaVersion: 1,
      workflow: selected,
      label: definition.label,
      title: definition.label,
      source: definition.source,
      request: definition.request,
      extensionVersion,
      transcript: `/media/video/${transcriptFile}`,
      provenance: "/media/video/provenance.json",
      variants: Object.fromEntries(
        Object.entries({ light, dark }).map(([theme, variant]) => [
          theme,
          Object.fromEntries(
            Object.entries(variant).filter(
              ([key]) => !["evidence", "events", "assets"].includes(key),
            ),
          ),
        ]),
      ),
    },
    null,
    2,
  ) + "\n",
);
console.log(
  "Published two real, outcome-verified recording variants and their provenance.",
);
