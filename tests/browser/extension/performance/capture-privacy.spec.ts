import { test, expect } from "../../../support/browser-test";
import { openBrandedExtension } from "../../../support/branded-extension";
import { openFirefoxExtension } from "../../../support/firefox-extension";
import { activateFirefoxToolbar } from "../../../support/webdriver-surfaces";
import { acceptanceServer } from "../../../support/fixture-server";
import { nativeVisionPixels } from "../../../support/native-vision";
import { privateCapturePage } from "../../../fixtures/vision/private-page";
import { readFile } from "node:fs/promises";

// Private captures and prepared PNGs remain inside the installed extension/worker.
test.use({ trace: "off", screenshot: "off", video: "off" });
for (const target of ["chromium", "firefox"] as const) {
  test(`${target} native private pixels are opaque before navigation crops, OCR and comparison`, async ({}, info) => {
    const fixture = await acceptanceServer({
      "/acceptance/fixture": privateCapturePage,
    });
    const app =
      target === "firefox"
        ? await openFirefoxExtension(fixture.url)
        : await openBrandedExtension("chrome", fixture.url, ["<all_urls>"]);
    const measurements = [];
    try {
      await info.attach("browser-runtime", {
        body: Buffer.from(
          JSON.stringify({
            name: target === "chromium" ? "chrome" : "firefox",
            version: app.version,
            target,
          }),
        ),
        contentType: "application/json",
      });
      const original = JSON.parse(
        await readFile(
          target === "firefox"
            ? "dist/extension-firefox/manifest.json"
            : "dist/extension/manifest.json",
          "utf8",
        ),
      );
      const manifest = await app.extension(() =>
        (
          (globalThis as any).browser || (globalThis as any).chrome
        ).runtime.getManifest(),
      );
      if (target === "chromium")
        expect(manifest.host_permissions).toEqual([
          ...original.host_permissions,
          "<all_urls>",
        ]);
      else expect(manifest.host_permissions).toEqual(original.host_permissions);
      await app.start();
      await app.goal("Show search");
      await app.site(() => (window as any).__vision38Fixture.addDynamic());
      for (const zoom of [0.8, 1.25, 2]) {
        await app.extension(
          async (tabId: number, zoom: number) => {
            const api =
              (globalThis as any).browser || (globalThis as any).chrome;
            await api.tabs.setZoom(tabId, zoom);
          },
          app.tabId,
          zoom,
        );
        await app.site(() => document.title);
        if (target === "firefox") await activateFirefoxToolbar(app.driver);
        await app.driver.sleep(2100);
        const observed = await app.message({ type: "GET_PAGE" });
        expect(observed.error).toBeUndefined();
        expect(observed.perception).toBeTruthy();
        const proof = await app.extension(nativeVisionPixels, {
          tabId: app.tabId,
          compare: zoom === 1.25,
        });
        measurements.push(proof);
        expect(proof.browserZoom).toBe(zoom);
        expect(proof.privateRectCount).toBeGreaterThanOrEqual(21);
        expect(proof.maskCount).toBeGreaterThanOrEqual(proof.privateRectCount);
        expect(proof.identityMatched).toBe(true);
        expect(proof.bounded).toBe(true);
        expect(proof.exactStylesRestored).toBe(true);
        for (const pixels of [proof.color, proof.crop, proof.ocr]) {
          expect(pixels.checkedPrivatePixels).toBeGreaterThan(0);
          expect(pixels.privateFailures).toBe(0);
        }
        expect(proof.color.checkedPadding).toBeGreaterThan(0);
        expect(proof.color.paddingFailures).toBe(0);
        expect(proof.color.publicColorRetained).toBe(true);
        expect(proof.color.privateSlotPixels).toBeGreaterThan(0);
        expect(proof.color.privateSlotOverflowPixels).toBeGreaterThan(0);
        expect(proof.color.publicSlotOutsidePrivateText).toBe(true);
        expect(proof.color.publicSlotColorRetained).toBe(true);
        expect(proof.color.ownedUiAbsent).toBe(true);
        expect(proof.color.bottomRowSamples).toBeGreaterThan(0);
        expect(proof.color.bottomRowFailures).toBe(0);
        if (proof.color.fractionalStripExpected) {
          expect(proof.color.fractionStripSampleCount).toBeGreaterThan(0);
          expect(proof.color.fractionStripFailures).toBe(0);
        }
        if (zoom === 1.25) expect(proof.privateComparisonMatched).toBe(true);
      }
      // A stale restore cannot unhide UI suppressed by a newer capture lease.
      const lease = await app.extension(async (tabId: number) => {
        const api = (globalThis as any).browser || (globalThis as any).chrome;
        const session = await api.runtime.sendMessage({ type: "GET_SESSION" });
        const tokens = [crypto.randomUUID(), crypto.randomUUID()];
        const styles = async () =>
          (
            await api.scripting.executeScript({
              target: { tabId },
              world: "MAIN",
              func: () => ({
                saved: JSON.stringify(
                  (window as any).__vision38Fixture.ownedStyles(),
                ),
                opacity: getComputedStyle(document.getElementById("owned")!)
                  .opacity,
              }),
            })
          )[0].result;
        const before = await styles();
        try {
          for (const captureId of tokens) {
            const reply = await api.tabs.sendMessage(
              tabId,
              {
                type: "PREPARE_CAPTURE",
                sessionId: session.sessionId,
                captureId,
              },
              { frameId: 0 },
            );
            if (reply?.error || !reply?.metadata)
              throw Error("Lease preparation failed");
          }
          await api.tabs.sendMessage(
            tabId,
            {
              type: "RESTORE_CAPTURE",
              sessionId: session.sessionId,
              captureId: tokens[0],
            },
            { frameId: 0 },
          );
          const staleKeptHidden = (await styles()).opacity === "0";
          await api.tabs.sendMessage(
            tabId,
            {
              type: "RESTORE_CAPTURE",
              sessionId: session.sessionId,
              captureId: tokens[1],
            },
            { frameId: 0 },
          );
          return {
            staleKeptHidden,
            exactStylesRestored: (await styles()).saved === before.saved,
          };
        } finally {
          for (const captureId of tokens)
            await api.tabs.sendMessage(
              tabId,
              {
                type: "RESTORE_CAPTURE",
                sessionId: session.sessionId,
                captureId,
              },
              { frameId: 0 },
            );
        }
      }, app.tabId);
      expect(lease).toEqual({
        staleKeptHidden: true,
        exactStylesRestored: true,
      });
      await app.site(() => (window as any).__vision38Fixture.animatePrivate());
      const animationRejected = await app.extension(async (tabId: number) => {
        const api = (globalThis as any).browser || (globalThis as any).chrome;
        const session = await api.runtime.sendMessage({ type: "GET_SESSION" }),
          captureId = crypto.randomUUID();
        try {
          const reply = await api.tabs.sendMessage(
            tabId,
            {
              type: "PREPARE_CAPTURE",
              sessionId: session.sessionId,
              captureId,
            },
            { frameId: 0 },
          );
          return !!reply?.error && !reply?.metadata;
        } finally {
          await api.tabs.sendMessage(
            tabId,
            {
              type: "RESTORE_CAPTURE",
              sessionId: session.sessionId,
              captureId,
            },
            { frameId: 0 },
          );
        }
      }, app.tabId);
      expect(animationRejected).toBe(true);
      await app.site(() => (window as any).__vision38Fixture.stopAnimation());
      await info.attach("pixel-privacy", {
        body: Buffer.from(
          JSON.stringify({
            target,
            version: app.version,
            permissionProfile:
              target === "chromium"
                ? "disposable all-URLs capture pregrant"
                : "original manifest with automated native toolbar activation",
            humanActivation: "pending",
            firefoxClassicGutter: "unmeasured and rejected by production",
            imagesPersisted: false,
            measurements,
            lease,
            animationRejected,
          }),
        ),
        contentType: "application/json",
      });
    } finally {
      await app.close();
      await fixture.close();
    }
  });
}
