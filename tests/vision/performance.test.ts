import { test, expect } from "vitest";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import os from "node:os";
import { OcrEngine } from "../../packages/vision/engine";
import { buildProvenance } from "../support/build-provenance";
test("warm CPU viewport OCR stays within its documented latency budget", async () => {
  const image = (await readFile("tests/vision-fixtures/viewport.png")).toString(
      "base64",
    ),
    engine = new OcrEngine({ langPath: resolve("assets/ocr") });
  const input = () => ({
    requestId: crypto.randomUUID(),
    journeyId: crypto.randomUUID(),
    contextRevision: 0,
    documentId: "performance",
    observationRevision: 1,
    viewportRevision: 1,
    captureId: crypto.randomUUID(),
    image,
    width: 1920,
    height: 1080,
    cssWidth: 1920,
    cssHeight: 1080,
  });
  const values: number[] = [];
  let coldMs = 0;
  try {
    coldMs = (await engine.recognize(input())).elapsedMs;
    for (let i = 0; i < 10; i++) {
      const result = await engine.recognize(input());
      expect(result.regions.some((r) => r.text === "Deploy website")).toBe(
        true,
      );
      values.push(result.elapsedMs);
    }
  } finally {
    await engine.close();
  }
  const p95 = values.sort((a, b) => a - b)[Math.ceil(values.length * 0.95) - 1];
  const report = {
    ...(await buildProvenance()),
    passed: p95 < 2000,
    coldMs,
    warmP95Ms: p95,
    samples: values.length,
    pixels: 1920 * 1080,
    hardware: {
      cpu: os.cpus()[0].model,
      totalMemory: os.totalmem(),
      node: process.version,
    },
    rss: process.memoryUsage().rss,
  };
  await mkdir("output/vision", { recursive: true });
  await writeFile(
    "output/vision/performance.json",
    JSON.stringify(report, null, 2),
  );
  expect(p95).toBeLessThan(2000);
});
