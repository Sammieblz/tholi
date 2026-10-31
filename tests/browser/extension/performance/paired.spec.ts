import { test, expect } from "../../../support/browser-test";
import { openBrandedExtension } from "../../../support/branded-extension";
import { openFirefoxExtension } from "../../../support/firefox-extension";
import { acceptanceServer } from "../../../support/fixture-server";
import { readFile } from "node:fs/promises";
import os from "node:os";
import { processSnapshot as processMemory } from "../../../support/process-sampling";
import { imageCaptureFixture } from "../../../support/image-capture-fixture";
async function measureBusyPage() {
  const root = document.getElementById("internet-navigator-overlay");
  const times: number[] = [];
  let previous = performance.now(),
    count = 0;
  const timer = setInterval(() => {
    const storm = document.getElementById("storm")!;
    for (let i = 0; i < 100; i++)
      storm.children[(count + i) % 50000].textContent = String(count);
    count += 100;
  }, 50);
  try {
    await new Promise<void>((resolve) => {
      const tick = (now: number) => {
        times.push(now - previous);
        previous = now;
        if (times.length === 120) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  } finally {
    clearInterval(timer);
  }
  return {
    frameP95Ms: times.sort((a, b) => a - b)[Math.floor(times.length * 0.95)],
    nodes: document.getElementById("storm")!.children.length,
    highlightPresent: !!root,
    sameHighlight:
      document.getElementById("internet-navigator-overlay") === root,
  };
}
// One serial experiment on the same host; pure model accuracy still runs once.
test("paired browser CPU planning, OCR and busy-page measurements retain the same budgets", async ({}, info) => {
  const fixture = await acceptanceServer(),
    measurements = [];
  const image =
    "data:image/png;base64," +
    (await readFile("tests/fixtures/vision/viewport.png")).toString("base64");
  try {
    for (const target of ["chromium", "firefox"] as const) {
      const app =
        target === "firefox"
          ? await openFirefoxExtension(fixture.url)
          : await openBrandedExtension("chrome", fixture.url);
      try {
        const capabilities = await app.driver.getCapabilities();
        const processId = Number(
          capabilities.get("moz:processID") ||
            capabilities.get("goog:processID"),
        );
        const memory = {
          beforeInference: processMemory(processId),
          afterPlanning: {} as unknown,
          afterOcr: {} as unknown,
          afterStop: {} as unknown,
        };
        await app.start();
        const planning = [];
        for (let i = 0; i < 21; i++) {
          const value = await app.extension(async () => {
            const api =
              (globalThis as any).browser || (globalThis as any).chrome;
            const start = performance.now();
            const page = await api.runtime.sendMessage({ type: "GET_PAGE" });
            const reply = await api.runtime.sendMessage({
              type: "SET_GOAL",
              goal: "Show search",
              revision: page.page.revision,
            });
            return {
              ms: performance.now() - start,
              error: reply.error || "",
              status: reply.view?.goalPlan?.status,
            };
          });
          expect(value.error).toBe("");
          expect(value.status).toBe("guiding");
          planning.push(value.ms);
        }
        memory.afterPlanning = processMemory(processId);
        // Exactly the packaged OCR worker and frozen viewport, including its normal image preparation.
        const ocr = await app.extension(
          async ({
            image,
            capture,
          }: {
            image: string;
            capture: ReturnType<typeof imageCaptureFixture>;
          }) => {
            const api =
              (globalThis as any).browser || (globalThis as any).chrome;
            const worker = new Worker(api.runtime.getURL("ocr-worker.js"), {
              type: "module",
            });
            const values: number[] = [];
            let coldMs = 0;
            try {
              for (let i = 0; i < 11; i++) {
                const id = crypto.randomUUID();
                const result: any = await new Promise((resolve, reject) => {
                  const timer = setTimeout(
                    () => reject(Error("Packaged OCR deadline")),
                    30000,
                  );
                  worker.onerror = (event) => {
                    clearTimeout(timer);
                    reject(Error(event.message));
                  };
                  worker.onmessage = ({ data }) => {
                    if (data.id === id) {
                      clearTimeout(timer);
                      data.error
                        ? reject(Error(data.error))
                        : resolve(data.value);
                    }
                  };
                  worker.postMessage({
                    type: "OCR_REQUEST",
                    id,
                    image,
                    ...capture,
                    stamp: {
                      requestId: crypto.randomUUID(),
                      journeyId: crypto.randomUUID(),
                      contextRevision: 0,
                      documentId: "paired-performance",
                      observationRevision: 1,
                      viewportRevision: 1,
                      captureId: capture.metadata.captureId,
                    },
                  });
                });
                if (
                  !result.regions.some((r: any) => r.text === "Deploy website")
                )
                  throw Error("Frozen OCR outcome missing");
                if (i === 0) coldMs = result.elapsedMs;
                else values.push(result.elapsedMs);
              }
              return { coldMs, values };
            } finally {
              worker.terminate();
            }
          },
          { image, capture: imageCaptureFixture(1920, 1080) },
        );
        memory.afterOcr = processMemory(processId);
        await app.site(() => {
          const storm = document.createElement("section");
          storm.id = "storm";
          const batch = document.createDocumentFragment();
          for (let i = 0; i < 50000; i++) {
            const span = document.createElement("span");
            span.textContent = ".";
            batch.append(span);
          }
          storm.append(batch);
          document.body.append(storm);
        });
        const busy = await app.site(measureBusyPage);
        const pause = await app.extension(async () => {
          const api = (globalThis as any).browser || (globalThis as any).chrome;
          // Queue routine reads first. User cancellation must preempt these
          // rather than waiting for every page scan to finish.
          const reads = Array.from({ length: 8 }, () =>
            api.runtime.sendMessage({ type: "GET_PAGE" }).catch(() => {}),
          );
          const start = performance.now();
          const reply = await api.runtime.sendMessage({ type: "PAUSE" });
          const ms = performance.now() - start;
          await Promise.allSettled(reads);
          return { ms, status: reply.view?.status };
        });
        expect(pause.status).toBe("paused");
        const stop = await app.extension(async () => {
          const start = performance.now();
          const api = (globalThis as any).browser || (globalThis as any).chrome;
          await api.runtime.sendMessage({ type: "STOP" });
          return performance.now() - start;
        });
        memory.afterStop = processMemory(processId);
        const stoppedBaseline = await app.site(measureBusyPage);
        const p95 = (values: number[]) =>
          values.sort((a, b) => a - b)[Math.floor(values.length * 0.95)];
        const measurement = {
          target,
          browser: target === "firefox" ? "firefox" : "chrome",
          version: app.version,
          settings: { model: "MiniLM", quantization: "q8", wasmThreads: 1 },
          planning: {
            coldMs: planning[0],
            warmP95Ms: p95(planning.slice(1)),
            samples: 20,
          },
          ocr: { coldMs: ocr.coldMs, warmP95Ms: p95(ocr.values), samples: 10 },
          busy,
          stoppedBaseline,
          stopMs: stop,
          pauseMs: pause.ms,
          processId,
          memory,
        };
        measurements.push(measurement);
      } finally {
        await app.close();
      }
    }
    for (const measurement of measurements) {
      expect(measurement.planning.warmP95Ms).toBeLessThan(750);
      expect(measurement.ocr.warmP95Ms).toBeLessThan(2000);
      expect(measurement.stopMs).toBeLessThan(1000);
      expect(measurement.pauseMs).toBeLessThan(1000);
      expect(measurement.busy.highlightPresent).toBe(true);
      expect(measurement.busy.sameHighlight).toBe(true);
      expect(measurement.busy.nodes).toBe(50000);
    }
  } finally {
    await fixture.close();
    await info.attach("paired-performance", {
      body: Buffer.from(
        JSON.stringify({
          hardware: {
            cpu: os.cpus()[0].model,
            logicalCpus: os.cpus().length,
            totalMemory: os.totalmem(),
            platform: os.platform(),
            node: process.version,
          },
          measurements,
        }),
      ),
      contentType: "application/json",
    });
  }
});
