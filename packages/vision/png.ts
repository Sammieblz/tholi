const signature = [137, 80, 78, 71, 13, 10, 26, 10];
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** Header primitives shared with the deliberately permissive legacy OCR profile. */
export function hasPngSignature(bytes: Uint8Array): boolean {
  return (
    bytes.length >= signature.length &&
    signature.every((value, index) => bytes[index] === value)
  );
}

export function readPngDimensions(bytes: Uint8Array) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { width: view.getUint32(16), height: view.getUint32(20) };
}

const crcTable = Uint32Array.from({ length: 256 }, (_, index) => {
  let crc = index;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function chunkCrc(bytes: Uint8Array, start: number, end: number) {
  let crc = 0xffffffff;
  for (let index = start; index < end; index++)
    crc = crcTable[(crc ^ bytes[index]) & 255] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function requirePng(condition: unknown): asserts condition {
  if (!condition) throw new Error("Invalid static PNG capture");
}

function decodeCanonicalBase64(image: string, maxBytes: number) {
  requirePng(
    image.length > 0 &&
      image.length <= Math.ceil(maxBytes / 3) * 4 &&
      image.length % 4 === 0 &&
      /^[A-Za-z0-9+/]+={0,2}$/.test(image),
  );
  const padding = image.endsWith("==") ? 2 : image.endsWith("=") ? 1 : 0;
  const size = (image.length / 4) * 3 - padding;
  requirePng(size <= maxBytes);
  if (padding)
    requirePng(
      (alphabet.indexOf(image[image.length - padding - 1]) &
        (padding === 2 ? 15 : 3)) ===
        0,
    );
  const binary = atob(image);
  const bytes = new Uint8Array(size);
  for (let index = 0; index < size; index++)
    bytes[index] = binary.charCodeAt(index);
  return bytes;
}

/**
 * Bounded, canonical static PNG container admission, not a pixel decoder or mask
 * attestation. Only pixel/rendering chunks are accepted; text, profiles, private
 * extensions, animation and trailing data are excluded from this capture profile.
 * Chunk layout/order/CRC follow https://www.w3.org/TR/png-3/.
 */
export function inspectPngData(
  image: string,
  options: { maxBytes: number; maxPixels: number },
): { bytes: Uint8Array; width: number; height: number } {
  requirePng(
    Number.isSafeInteger(options.maxBytes) &&
      options.maxBytes > 0 &&
      Number.isSafeInteger(options.maxPixels) &&
      options.maxPixels > 0,
  );
  const bytes = decodeCanonicalBase64(image, options.maxBytes);
  requirePng(hasPngSignature(bytes));
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = 8;
  let width = 0,
    height = 0,
    bitDepth = 0,
    colorType = 0;
  let paletteEntries = 0,
    imageBytes = 0;
  let previous = "";
  const seen = new Set<string>();
  while (offset < bytes.length) {
    requirePng(bytes.length - offset >= 12);
    const length = view.getUint32(offset);
    requirePng(length <= 0x7fffffff && length <= bytes.length - offset - 12);
    const type = String.fromCharCode(...bytes.subarray(offset + 4, offset + 8));
    const start = offset + 8,
      end = start + length;
    requirePng(view.getUint32(end) === chunkCrc(bytes, offset + 4, end));
    requirePng((offset === 8) === (type === "IHDR"));
    requirePng(type === "IDAT" || !seen.has(type));
    switch (type) {
      case "IHDR": {
        requirePng(length === 13);
        ({ width, height } = readPngDimensions(bytes));
        bitDepth = bytes[start + 8];
        colorType = bytes[start + 9];
        const depths: Record<number, readonly number[]> = {
          0: [1, 2, 4, 8, 16],
          2: [8, 16],
          3: [1, 2, 4, 8],
          4: [8, 16],
          6: [8, 16],
        };
        requirePng(
          width > 0 &&
            height > 0 &&
            width <= 0x7fffffff &&
            height <= 0x7fffffff &&
            width <= options.maxPixels / height &&
            depths[colorType]?.includes(bitDepth) &&
            bytes[start + 10] === 0 &&
            bytes[start + 11] === 0 &&
            bytes[start + 12] <= 1,
        );
        break;
      }
      case "PLTE":
        requirePng(
          !seen.has("IDAT") &&
            !seen.has("tRNS") &&
            colorType !== 0 &&
            colorType !== 4 &&
            length > 0 &&
            length <= 768 &&
            length % 3 === 0,
        );
        paletteEntries = length / 3;
        requirePng(colorType !== 3 || paletteEntries <= 2 ** bitDepth);
        break;
      case "tRNS":
        requirePng(!seen.has("IDAT"));
        if (colorType === 0)
          requirePng(length === 2 && view.getUint16(start) < 2 ** bitDepth);
        else if (colorType === 2)
          requirePng(
            length === 6 &&
              [0, 2, 4].every(
                (index) => view.getUint16(start + index) < 2 ** bitDepth,
              ),
          );
        else
          requirePng(
            colorType === 3 &&
              paletteEntries > 0 &&
              length > 0 &&
              length <= paletteEntries,
          );
        break;
      case "sRGB":
        requirePng(
          !seen.has("PLTE") &&
            !seen.has("IDAT") &&
            length === 1 &&
            bytes[start] <= 3,
        );
        break;
      case "gAMA":
        requirePng(
          !seen.has("PLTE") &&
            !seen.has("IDAT") &&
            length === 4 &&
            view.getUint32(start) > 0 &&
            view.getUint32(start) <= 0x7fffffff,
        );
        break;
      case "cHRM":
        requirePng(
          !seen.has("PLTE") &&
            !seen.has("IDAT") &&
            length === 32 &&
            Array.from({ length: 8 }, (_, index) =>
              view.getUint32(start + index * 4),
            ).every((value) => value <= 0x7fffffff),
        );
        break;
      case "pHYs":
        requirePng(!seen.has("IDAT") && length === 9 && bytes[start + 8] <= 1);
        break;
      case "IDAT":
        requirePng(
          (!seen.has("IDAT") || previous === "IDAT") &&
            (colorType !== 3 || paletteEntries > 0),
        );
        imageBytes += length;
        break;
      case "IEND":
        requirePng(length === 0 && imageBytes > 0 && end + 4 === bytes.length);
        return { bytes, width, height };
      default:
        requirePng(false);
    }
    seen.add(type);
    previous = type;
    offset = end + 4;
  }
  requirePng(false);
}
