import { test, expect } from "vitest";
import { readFile, mkdtemp, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { tmpdir } from "node:os";
import { OcrEngine } from "../../../packages/vision/engine";
import { createApi } from "../../../apps/api/src/server";
import type { RecognitionInput } from "../../../packages/vision/contracts";
async function input(theme = "light"): Promise<RecognitionInput> {
  return {
    requestId: crypto.randomUUID(),
    journeyId: crypto.randomUUID(),
    contextRevision: 4,
    documentId: "fixture-document",
    observationRevision: 9,
    viewportRevision: 3,
    captureId: crypto.randomUUID(),
    image: (await readFile("tests/fixtures/vision/" + theme + ".png")).toString(
      "base64",
    ),
    width: 640,
    height: 180,
    cssWidth: 320,
    cssHeight: 90,
  };
}
test("real pinned CPU OCR recognizes light/dark labels with scaled image coordinates", async () => {
  const engine = new OcrEngine({ langPath: resolve("assets/ocr") });
  try {
    for (const theme of ["light", "dark"]) {
      const request = await input(theme),
        result = await engine.recognize(request);
      const target = result.regions.find(
        (r) => r.text.trim() === "Deploy website",
      );
      expect(target).toBeDefined();
      expect(target!.confidence).toBeGreaterThanOrEqual(85);
      expect(target!.box.x).toBeGreaterThan(10);
      expect(target!.box.x).toBeLessThan(25);
      expect(result.requestId).toBe(request.requestId);
      expect(result.viewportRevision).toBe(3);
    }
    const large = {
      ...(await input()),
      image: (await readFile("tests/fixtures/vision/viewport.png")).toString(
        "base64",
      ),
      width: 1920,
      height: 1080,
      cssWidth: 1920,
      cssHeight: 1080,
    };
    const controller = new AbortController();
    const pending = engine.recognize(large, controller.signal);
    setTimeout(() => controller.abort(), 5);
    await expect(pending).rejects.toThrow("OCR canceled");
    expect(
      (await engine.recognize(await input())).regions.some(
        (r) => r.text === "Deploy website",
      ),
    ).toBe(true);
  } finally {
    await engine.close();
  }
});
test("authenticated OCR API has parity, validates bounds and never persists image or recognized text", async () => {
  const directory = await mkdtemp(join(tmpdir(), "navigator-vision-"));
  const token = "v".repeat(64),
    origin = "chrome-extension://" + "a".repeat(32);
  const api = await createApi({
    database: join(directory, "memory.sqlite"),
    token,
    origins: [origin],
    models: resolve("assets/models"),
    worker: new URL("../../../apps/api/dist/inference.js", import.meta.url),
  });
  try {
    const request = await input(),
      headers = { authorization: "Bearer " + token, origin };
    expect(
      (await api.inject({ method: "POST", url: "/v2/ocr", payload: request }))
        .statusCode,
    ).toBe(401);
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v2/ocr",
          headers: { ...headers, origin: "https://other.test" },
          payload: request,
        })
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await api.inject({
          method: "POST",
          url: "/v2/ocr",
          headers,
          payload: { ...request, width: 9999 },
        })
      ).statusCode,
    ).toBe(400);
    const response = await api.inject({
      method: "POST",
      url: "/v2/ocr",
      headers,
      payload: request,
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(
      response.json().regions.some((r: any) => r.text === "Deploy website"),
    ).toBe(true);
    expect(response.json().contextRevision).toBe(4);
    expect(
      (await api.inject({ url: "/v2/health", headers })).json().capabilities,
    ).toContain("cpu-ocr");
    expect(
      (await api.inject({ url: "/v2/openapi.json", headers })).json().paths[
        "/v2/ocr"
      ],
    ).toBeDefined();
    const bytes = await readFile(join(directory, "memory.sqlite"));
    expect(bytes.includes(Buffer.from("Deploy website"))).toBe(false);
    expect(bytes.includes(Buffer.from(request.image.slice(0, 200)))).toBe(
      false,
    );
  } finally {
    await api.close();
    const absolute = resolve(directory);
    if (!absolute.startsWith(resolve(tmpdir()) + sep))
      throw new Error("Unsafe test cleanup");
    await rm(absolute, { recursive: true, force: true });
  }
});
