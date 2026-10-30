import { readFile } from "node:fs/promises";
import { crc32, deflateSync } from "node:zlib";
import { afterEach, expect, it, vi } from "vitest";
import { inspectPngData } from "../../../packages/vision/png";
import {
  validatePng,
  type RecognitionInput,
} from "../../../packages/vision/contracts";

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
