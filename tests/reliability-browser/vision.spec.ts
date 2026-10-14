import { test, expect } from "@playwright/test";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { openNavigatorExtension } from "../support/navigator-extension";
test("compare frozen UI images with real bundled OCR in the offline production extension", async () => {
  const corpusBytes = await readFile("tests/reliability-vision/corpus.json");
  expect(createHash("sha256").update(corpusBytes).digest("hex")).toBe(
    (await readFile("tests/reliability-vision/corpus.sha256", "utf8")).trim(),
  );
  const corpus = JSON.parse(corpusBytes.toString()),
    app = await openNavigatorExtension();
  const results: any[] = [];
  app.context.on("console", (message) => {
    if (message.type() === "error")
      console.log("OCR console:", message.text().slice(0, 500));
  });
  try {
    await app.panel.evaluate(async () => {
      if (
        !(
          await chrome.runtime.getContexts({
            contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
          })
        ).length
      )
        await chrome.offscreen.createDocument({
          url: "offscreen.html",
          reasons: [chrome.offscreen.Reason.WORKERS],
          justification: "Offline reliability acceptance",
        });
    });
    await app.context.setOffline(true);
    for (const engine of ["tesseract", "paddle"]) {
      for (const c of corpus.cases) {
        const bytes = await readFile("tests/reliability-vision/" + c.file);
        expect(createHash("sha256").update(bytes).digest("hex")).toBe(c.sha256);
        const result = await app.panel.evaluate(
          async ({ image, engine }) =>
            chrome.runtime.sendMessage({
              target: "offscreen",
              type: "OCR_REQUEST",
              engine,
              id: crypto.randomUUID(),
              image,
              metadata: { width: 960, height: 600, masks: [] },
              stamp: {
                requestId: crypto.randomUUID(),
                journeyId: crypto.randomUUID(),
                contextRevision: 0,
                documentId: "image-corpus",
                observationRevision: 1,
                viewportRevision: 1,
                captureId: crypto.randomUUID(),
              },
            }),
          {
            image: "data:image/png;base64," + bytes.toString("base64"),
            engine,
          },
        );
        results.push({
          id: c.id,
          engine,
          split: c.split,
          category: c.category,
          target: c.target,
          expectedBox: c.expectedBox,
          error: result.error,
          elapsedMs: result.value?.elapsedMs,
          regions: result.value?.regions,
        });
        if (result.error) break; // Runtime/CSP failure is an explicit failed promotion gate.
      }
    }
    const metrics = Object.fromEntries(
      ["tesseract", "paddle"].map((engine) => {
        const rows = results.filter(
            (r) => r.engine === engine && r.split === "held-out",
          ),
          times = rows
            .map((r) => r.elapsedMs || Infinity)
            .sort((a, b) => a - b);
        let accepted = 0,
          correct = 0,
          supported = 0,
          covered = 0;
        for (const row of rows) {
          const matches = (row.regions || []).filter(
            (r: any) =>
              r.confidence >= 85 &&
              r.text.toLowerCase().trim() === row.target.toLowerCase(),
          );
          if (row.category === "supported") supported++;
          if (matches.length === 1) {
            accepted++;
            const r = matches[0].box,
              b = row.expectedBox;
            if (
              row.category === "supported" &&
              b &&
              r.x >= b.x &&
              r.x <= b.x + b.width &&
              r.y >= b.y &&
              r.y <= b.y + b.height
            ) {
              correct++;
              covered++;
            }
          }
        }
        return [
          engine,
          {
            precision: accepted ? correct / accepted : 0,
            coverage: supported ? covered / supported : 0,
            supported,
            accepted,
            warmP95Ms: times[Math.floor(times.length * 0.95)] ?? null,
            runtimeError: results.find((r) => r.engine === engine && r.error)
              ?.error,
            heldOut: rows.length,
          },
        ];
      }),
    );
    await mkdir("output/reliability", { recursive: true });
    await writeFile(
      "output/reliability/vision-comparison.json",
      JSON.stringify(
        {
          corpusSha256: createHash("sha256").update(corpusBytes).digest("hex"),
          metrics,
          results,
        },
        null,
        2,
      ),
    );
    expect(metrics.tesseract.heldOut).toBe(24);
    // Paddle is promoted only by a separate explicit gate, never by a fallback result.
    expect(results.length).toBeGreaterThanOrEqual(33);
  } finally {
    await app.close();
  }
});
