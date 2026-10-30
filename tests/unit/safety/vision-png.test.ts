import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { inspectPngData } from "../../../packages/vision/png";
import {
  validatePng,
  VISION_CAPTURE_LIMITS,
  type CaptureMetadata,
  type RecognitionInput,
} from "../../../packages/vision/contracts";
import {
  compareCaptureRegions,
  prepareNavigationCapture,
  prepareRecognitionCapture,
  type PixelCaptureRequest,
} from "../../../packages/vision/processing";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const limits = { maxBytes: 2097152, maxPixels: 4000000 };
const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
function chunk(type: string, data: Uint8Array = new Uint8Array()) {
  const bytes = Buffer.alloc(data.length + 12);
  bytes.writeUInt32BE(data.length);
  bytes.write(type, 4, 4, "ascii");
  bytes.set(data, 8);
  bytes.writeUInt32BE(
    crc32(bytes.subarray(4, bytes.length - 4)),
    bytes.length - 4,
  );
  return bytes;
}
function header(
  options: {
    width?: number;
    height?: number;
    depth?: number;
    color?: number;
    compression?: number;
    filter?: number;
    interlace?: number;
  } = {},
) {
  const data = Buffer.alloc(13);
  data.writeUInt32BE(options.width ?? 2, 0);
  data.writeUInt32BE(options.height ?? 1, 4);
  data[8] = options.depth ?? 8;
  data[9] = options.color ?? 6;
  data[10] = options.compression ?? 0;
  data[11] = options.filter ?? 0;
  data[12] = options.interlace ?? 0;
  return chunk("IHDR", data);
}
const idat = chunk(
  "IDAT",
  deflateSync(Buffer.from([0, 255, 0, 0, 255, 0, 128, 255, 255])),
);
const iend = chunk("IEND");
const png = (...chunks: Uint8Array[]) => Buffer.concat([signature, ...chunks]);
const inspect = (bytes: Uint8Array, options = limits) =>
  inspectPngData(Buffer.from(bytes).toString("base64"), options);

function capture(width = 10, height = 8): PixelCaptureRequest {
  const metadata: CaptureMetadata = {
    version: 1,
    captureId: "10000000-0000-4000-8000-000000000001",
    scanId: "10000000-0000-4000-8000-000000000002",
    observationRevision: 3,
    viewportRevision: 4,
    at: 100,
    viewport: {
      width,
      height,
      scrollX: 0,
      scrollY: 0,
      devicePixelRatio: 2,
      visualViewport: {
        offsetLeft: 0,
        offsetTop: 0,
        pageLeft: 0,
        pageTop: 0,
        width,
        height,
        scale: 1,
      },
    },
    masks: [{ x: 4.2, y: 3.1, width: 1.2, height: 0.8 }],
    masking: { version: 1, complete: true },
  };
  return {
    image: `data:image/png;base64,${png(header({ width: width * 2, height: height * 2 }), idat, iend).toString("base64")}`,
    metadata,
    captureCssBounds: { x: 0, y: 0, width, height },
    browserZoom: 1,
  };
}
function captureStamp(request: PixelCaptureRequest) {
  return {
    requestId: request.metadata.scanId,
    journeyId: request.metadata.scanId,
    contextRevision: 1,
    documentId: "native:document",
    observationRevision: request.metadata.observationRevision,
    viewportRevision: request.metadata.viewportRevision,
    captureId: request.metadata.captureId,
  };
}

it("rejects untrusted or over-budget raw captures before bitmap allocation or remote fetching", async () => {
  const decode = vi.fn(),
    fetch = vi.fn();
  vi.stubGlobal("createImageBitmap", decode);
  vi.stubGlobal("fetch", fetch);
  const valid = capture();
  const cases = [
    { ...valid, image: "https://private.example/capture.png" },
    { ...valid, image: "data:image/png;base64,AAAA" },
    {
      ...valid,
      image: `data:image/png;base64,${"A".repeat(Math.ceil(VISION_CAPTURE_LIMITS.maxSourceBytes / 3) * 4 + 4)}`,
    },
    {
      ...valid,
      image: `data:image/png;base64,${png(header({ width: 4001, height: 4000 }), idat, iend).toString("base64")}`,
    },
    {
      ...valid,
      image: `data:image/png;base64,${png(header({ width: 24, height: 16 }), idat, iend).toString("base64")}`,
    },
    {
      ...valid,
      metadata: { ...valid.metadata, masking: { version: 1, complete: false } },
    },
    { ...valid, captureCssBounds: { ...valid.captureCssBounds, width: 9 } },
  ];
  for (const request of cases)
    await expect(
      prepareNavigationCapture(
        { ...request, prepareNavigation: {} } as Parameters<
          typeof prepareNavigationCapture
        >[0],
        new AbortController().signal,
      ),
    ).rejects.toThrow();
  expect(decode).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

function pixelCanvasHarness(width = 20, height = 16, mask = [4, 2, 11, 10]) {
  const events: string[] = [],
    canvases: { width: number; height: number }[] = [];
  const close = vi.fn(() => events.push("bitmap-close"));
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => ({ width, height, close })),
  );
  class Canvas {
    constructor(
      public width: number,
      public height: number,
    ) {
      canvases.push(this);
    }
    getContext() {
      const canvas = this;
      return {
        globalAlpha: 0,
        globalCompositeOperation: "",
        fillStyle: "",
        drawImage(...args: unknown[]) {
          if (args.length === 3) events.push("native-draw");
          else {
            expect(events.at(-1)).toBe("opaque-mask");
            events.push("transform");
          }
        },
        fillRect(
          this: {
            globalAlpha: number;
            globalCompositeOperation: string;
            fillStyle: string;
          },
          ...bounds: number[]
        ) {
          expect(this).toMatchObject({
            globalAlpha: 1,
            globalCompositeOperation: "source-over",
            fillStyle: "#888888",
          });
          expect(bounds).toEqual(mask);
          events.push("opaque-mask");
        },
        getImageData() {
          events.push("read-masked");
          return {
            data: new Uint8ClampedArray(canvas.width * canvas.height * 4),
          };
        },
        putImageData() {
          events.push("grayscale");
        },
      };
    }
    async convertToBlob() {
      events.push("encode");
      return new Blob([
        new Uint8Array(
          png(header({ width: this.width, height: this.height }), idat, iend),
        ).buffer,
      ]);
    }
  }
  vi.stubGlobal("OffscreenCanvas", Canvas);
  return { events, canvases, close };
}

it("orders opaque native masking before OCR, color crops and both region-comparison transforms, releasing native surfaces", async () => {
  const { events, canvases, close } = pixelCanvasHarness();
  const request = capture(),
    signal = new AbortController().signal;
  await prepareRecognitionCapture(
    { ...request, stamp: captureStamp(request) },
    signal,
  );
  expect(events).toEqual([
    "native-draw",
    "bitmap-close",
    "opaque-mask",
    "transform",
    "read-masked",
    "grayscale",
    "encode",
  ]);
  events.length = 0;
  await prepareNavigationCapture(
    {
      ...request,
      prepareNavigation: { crop: { x: 3, y: 2, width: 4, height: 4 } },
    },
    signal,
  );
  expect(events).toEqual([
    "native-draw",
    "bitmap-close",
    "opaque-mask",
    "transform",
    "encode",
  ]);
  events.length = 0;
  expect(
    await compareCaptureRegions(
      {
        ...request,
        referenceImage: request.image,
        referenceMetadata: request.metadata,
        referenceCaptureCssBounds: request.captureCssBounds,
        referenceBrowserZoom: request.browserZoom,
        compareRegion: { x: 3, y: 2, width: 4, height: 4 },
      },
      signal,
    ),
  ).toEqual({ matches: true });
  expect(events).toEqual([
    "native-draw",
    "bitmap-close",
    "opaque-mask",
    "transform",
    "read-masked",
    "native-draw",
    "bitmap-close",
    "opaque-mask",
    "transform",
    "read-masked",
  ]);
  expect(close).toHaveBeenCalledTimes(4);
  expect(
    canvases.every((canvas) => canvas.width === 0 && canvas.height === 0),
  ).toBe(true);
});

it("retains measured fractional viewport geometry and masks its bottom band without inventing crop pixels", async () => {
  const { canvases } = pixelCanvasHarness(764, 429, [6, 427, 5, 2]);
  const request = capture(955, 536),
    signal = new AbortController().signal;
  request.browserZoom = 0.8;
  request.image = `data:image/png;base64,${png(header({ width: 764, height: 429 }), idat, iend).toString("base64")}`;
  request.metadata.viewport.devicePixelRatio = 0.800000011920929;
  request.metadata.viewport.visualViewport.width = 936.25;
  request.metadata.viewport.visualViewport.height = 536.25;
  request.metadata.masks = [{ x: 10, y: 536.05, width: 1, height: 0.15 }];
  request.metadata.focusRegions = [{ x: 0, y: 536, width: 10, height: 0.25 }];
  const original = structuredClone(request.metadata);
  const prepared = await prepareNavigationCapture(
    { ...request, prepareNavigation: {} },
    signal,
  );
  expect(prepared).toMatchObject({
    width: 749,
    height: 429,
    source: {
      bitmapWidth: 764,
      bitmapHeight: 429,
      captureCssBounds: { x: 0, y: 0, width: 955, height: 536 },
      cssBounds: { x: 0, y: 0, width: 936.25, height: 536.25 },
      pixelBounds: { x: 0, y: 0, width: 749, height: 429 },
      scaleX: 764 / 955,
      scaleY: 429 / 536,
    },
  });
  const ocr = await prepareRecognitionCapture(
    { ...request, stamp: captureStamp(request) },
    signal,
  );
  expect(ocr).toMatchObject({
    width: 764,
    height: 429,
    cssWidth: 955,
    cssHeight: 536,
    focusRegions: [],
  });
  await expect(
    prepareNavigationCapture(
      {
        ...request,
        prepareNavigation: {
          crop: { x: 10, y: 536.05, width: 1, height: 0.15 },
        },
      },
      signal,
    ),
  ).rejects.toThrow("no complete visible pixels");
  expect(request.metadata).toEqual(original);
  expect(
    canvases.every((canvas) => canvas.width === 0 && canvas.height === 0),
  ).toBe(true);

  // A synthetic integer-roundup counterpart exercises the opposite precision
  // direction. It is a unit contract, not an additional native measurement.
  pixelCanvasHarness(764, 429, [6, 426, 5, 3]);
  const roundedUp = structuredClone(request);
  roundedUp.metadata.viewport.height = 537;
  roundedUp.metadata.viewport.visualViewport.height = 536.5;
  roundedUp.captureCssBounds.height = 537;
  expect(
    (
      await prepareNavigationCapture(
        { ...roundedUp, prepareNavigation: {} },
        signal,
      )
    ).source,
  ).toMatchObject({
    captureCssBounds: { height: 537 },
    cssBounds: { height: 536.5 },
    bitmapHeight: 429,
    pixelBounds: { height: 429 },
    scaleY: 429 / 537,
  });
});

it("closes a decoded native bitmap when cancellation arrives during decoding", async () => {
  const controller = new AbortController(),
    close = vi.fn(),
    canvas = vi.fn();
  vi.stubGlobal(
    "createImageBitmap",
    vi.fn(async () => {
      controller.abort();
      return { width: 20, height: 16, close };
    }),
  );
  vi.stubGlobal("OffscreenCanvas", canvas);
  await expect(
    prepareNavigationCapture(
      { ...capture(), prepareNavigation: {} },
      controller.signal,
    ),
  ).rejects.toThrow();
  expect(close).toHaveBeenCalledOnce();
  expect(canvas).not.toHaveBeenCalled();
});

it("admits existing static PNG fixtures using browser primitives without Buffer", async () => {
  const fixtures = await Promise.all(
    ["light", "dark", "viewport"].map(async (name) => {
      const bytes = await readFile(`tests/fixtures/vision/${name}.png`);
      return {
        image: bytes.toString("base64"),
        bytes: new Uint8Array(bytes),
        width: bytes.readUInt32BE(16),
        height: bytes.readUInt32BE(20),
      };
    }),
  );
  vi.stubGlobal("Buffer", undefined);
  for (const fixture of fixtures) {
    const result = inspectPngData(fixture.image, limits);
    expect(result).toEqual({
      bytes: fixture.bytes,
      width: fixture.width,
      height: fixture.height,
    });
    expect(result.bytes.constructor).toBe(Uint8Array);
  }
});

it("checks canonical encoding and encoded/decoded size before allocating decoded bytes", () => {
  const decode = vi.spyOn(globalThis, "atob");
  for (const image of [
    "",
    "AAA",
    "AB==",
    "AAB=",
    "AAAA=",
    "AAAA====",
    "AA A",
    "AAAA_===",
    "data:image/png;base64,AAAA",
  ])
    expect(() => inspectPngData(image, limits)).toThrow(
      "Invalid static PNG capture",
    );
  const bytes = png(header(), idat, iend);
  expect(() =>
    inspect(bytes, { ...limits, maxBytes: bytes.length - 1 }),
  ).toThrow();
  expect(decode).not.toHaveBeenCalled();
  expect(
    inspect(bytes, { maxBytes: bytes.length, maxPixels: 2 }),
  ).toMatchObject({ width: 2, height: 1 });
  expect(() => inspect(bytes, { ...limits, maxPixels: 1 })).toThrow();
});

it("rejects invalid admission budgets before decoding", () => {
  const decode = vi.spyOn(globalThis, "atob");
  for (const invalid of [
    0,
    -1,
    1.5,
    Infinity,
    NaN,
    Number.MAX_SAFE_INTEGER + 1,
  ]) {
    expect(() =>
      inspectPngData("AAAA", { ...limits, maxBytes: invalid }),
    ).toThrow();
    expect(() =>
      inspectPngData("AAAA", { ...limits, maxPixels: invalid }),
    ).toThrow();
  }
  expect(decode).not.toHaveBeenCalled();
});

it("requires the PNG signature, complete bounded chunks and correct CRCs", () => {
  const valid = png(header(), idat, iend);
  const badSignature = Buffer.from(valid);
  badSignature[0] = 0;
  const badCrc = Buffer.from(valid);
  badCrc[32] ^= 1;
  const hugeLength = Buffer.from(valid);
  hugeLength.writeUInt32BE(0x80000000, 8);
  const truncatedLength = Buffer.from(valid);
  truncatedLength.writeUInt32BE(valid.length, 8);
  for (const bytes of [
    badSignature,
    badCrc,
    hugeLength,
    truncatedLength,
    valid.subarray(0, 7),
    valid.subarray(0, 10),
    valid.subarray(0, valid.length - 1),
  ])
    expect(() => inspect(bytes)).toThrow("Invalid static PNG capture");
});

it("requires one first IHDR, nonempty consecutive IDAT data and one empty final IEND", () => {
  for (const bytes of [
    png(idat, header(), iend),
    png(header(), header(), idat, iend),
    png(header(), iend),
    png(header(), chunk("IDAT"), iend),
    png(header(), idat),
    png(header(), idat, chunk("IEND", new Uint8Array([0]))),
    png(header(), idat, iend, iend),
    png(header(), idat, iend, new Uint8Array([0])),
    png(header(), idat, chunk("pHYs", new Uint8Array(9)), idat, iend),
    png(header(), chunk("ABCD"), idat, iend),
  ])
    expect(() => inspect(bytes)).toThrow();
  const compressed = idat.subarray(8, idat.length - 4);
  expect(
    inspect(
      png(
        header(),
        chunk("IDAT", compressed.subarray(0, 2)),
        chunk("IDAT"),
        chunk("IDAT", compressed.subarray(2)),
        iend,
      ),
    ),
  ).toMatchObject({ width: 2, height: 1 });
});

it("rejects illegal IHDR dimensions, color-depth pairs and method values", () => {
  for (const options of [
    { width: 0 },
    { height: 0 },
    { width: 0x80000000 },
    { height: 0x80000000 },
    { width: 4000001 },
    { depth: 4 },
    { color: 1 },
    { color: 5 },
    { compression: 1 },
    { filter: 1 },
    { interlace: 2 },
  ])
    expect(() => inspect(png(header(options), idat, iend))).toThrow();
});

it("validates indexed palettes and transparency without admitting arbitrary metadata", () => {
  const palette = chunk("PLTE", new Uint8Array([255, 0, 0, 0, 255, 0]));
  const indexed = header({ color: 3, depth: 1 });
  const indexedPixels = chunk(
    "IDAT",
    deflateSync(new Uint8Array([0, 0b01000000])),
  );
  expect(
    inspect(
      png(
        indexed,
        palette,
        chunk("tRNS", new Uint8Array([255, 128])),
        indexedPixels,
        iend,
      ),
    ),
  ).toMatchObject({ width: 2, height: 1 });
  for (const bytes of [
    png(indexed, indexedPixels, iend),
    png(indexed, chunk("PLTE", new Uint8Array(9)), indexedPixels, iend),
    png(indexed, chunk("PLTE", new Uint8Array(4)), indexedPixels, iend),
    png(indexed, palette, palette, indexedPixels, iend),
    png(
      indexed,
      chunk("tRNS", new Uint8Array([255])),
      palette,
      indexedPixels,
      iend,
    ),
    png(
      indexed,
      palette,
      chunk("tRNS", new Uint8Array([1, 2, 3])),
      indexedPixels,
      iend,
    ),
    png(header(), chunk("tRNS", new Uint8Array([255])), idat, iend),
    png(header({ color: 0 }), palette, idat, iend),
  ])
    expect(() => inspect(bytes)).toThrow();
});

it("admits only bounded rendering ancillary fields in their required positions", () => {
  const gamma = Buffer.alloc(4);
  gamma.writeUInt32BE(45455);
  const color = chunk("sRGB", new Uint8Array([0]));
  const density = chunk("pHYs", new Uint8Array(9));
  expect(
    inspect(
      png(
        header(),
        color,
        chunk("gAMA", gamma),
        chunk("cHRM", new Uint8Array(32)),
        density,
        idat,
        iend,
      ),
    ),
  ).toMatchObject({ width: 2, height: 1 });
  for (const bytes of [
    png(header(), color, color, idat, iend),
    png(header(), chunk("sRGB", new Uint8Array([4])), idat, iend),
    png(header(), chunk("gAMA", new Uint8Array(4)), idat, iend),
    png(header(), chunk("cHRM", new Uint8Array(31)), idat, iend),
    png(header(), chunk("pHYs", new Uint8Array(8)), idat, iend),
    png(
      header(),
      chunk("pHYs", new Uint8Array([0, 0, 0, 0, 0, 0, 0, 0, 2])),
      idat,
      iend,
    ),
    png(header(), density, density, idat, iend),
  ])
    expect(() => inspect(bytes)).toThrow();
});

it("rejects animation, text, embedded profiles, Exif and private/unknown ancillary chunks", () => {
  for (const type of [
    "acTL",
    "fcTL",
    "fdAT",
    "tEXt",
    "zTXt",
    "iTXt",
    "eXIf",
    "iCCP",
    "vpAg",
    "abCD",
  ])
    expect(() =>
      inspect(
        png(
          header(),
          chunk(type, new TextEncoder().encode("PRIVATE_SENTINEL")),
          idat,
          iend,
        ),
      ),
    ).toThrow("Invalid static PNG capture");
});

it("preserves legacy OCR's permissive header-only decoding, Buffer return and existing error messages", () => {
  const legacy = Buffer.alloc(25);
  signature.copy(legacy);
  legacy.writeUInt32BE(2, 16);
  legacy.writeUInt32BE(1, 20);
  const input = {
    image: legacy.toString("base64").replace(/=+$/, ""),
    width: 2,
    height: 1,
  } as RecognitionInput;
  const decoded = validatePng(input);
  expect(Buffer.isBuffer(decoded)).toBe(true);
  expect(decoded).toEqual(legacy);
  expect(() => inspect(legacy)).toThrow();
  expect(() => validatePng({ ...input, image: "not-png" })).toThrow(
    "Invalid PNG encoding",
  );
  expect(() => validatePng({ ...input, image: btoa("not a png") })).toThrow(
    "Expected a PNG of at most four MB",
  );
  expect(() => validatePng({ ...input, width: 3 })).toThrow(
    "PNG dimensions do not match capture metadata",
  );
  const oversized = Buffer.alloc(4194305);
  legacy.copy(oversized);
  expect(() =>
    validatePng({ ...input, image: oversized.toString("base64") }),
  ).toThrow("Expected a PNG of at most four MB");
  const largeDimensions = Buffer.from(legacy);
  largeDimensions.writeUInt32BE(4000001, 16);
  expect(() =>
    validatePng({
      ...input,
      image: largeDimensions.toString("base64"),
      width: 4000001,
    }),
  ).toThrow("PNG dimensions do not match capture metadata");
  vi.stubGlobal("Buffer", undefined);
  expect(validatePng({ ...input, image: legacy.toString("base64") })).toEqual(
    new Uint8Array(legacy),
  );
});
