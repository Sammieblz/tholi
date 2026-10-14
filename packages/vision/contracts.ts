import { z } from "zod";
export const visualStampSchema = z
  .object({
    requestId: z.string().uuid(),
    journeyId: z.string().uuid(),
    contextRevision: z.number().int().nonnegative(),
    documentId: z.string().max(200),
    observationRevision: z.number().int().nonnegative(),
    viewportRevision: z.number().int().nonnegative(),
    captureId: z.string().uuid(),
  })
  .strict();
export const boxSchema = z
  .object({
    x: z.number().finite().nonnegative(),
    y: z.number().finite().nonnegative(),
    width: z.number().finite().positive(),
    height: z.number().finite().positive(),
  })
  .strict();
export const recognitionInputSchema = visualStampSchema
  .extend({
    image: z.string().min(1).max(5592500),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    cssWidth: z.number().finite().positive(),
    cssHeight: z.number().finite().positive(),
  })
  .strict()
  .refine(
    (v) => v.width * v.height <= 4000000,
    "Image exceeds four megapixels",
  );
export const visualObservationSchema = visualStampSchema
  .extend({
    regions: z
      .array(
        z
          .object({
            text: z.string().min(1).max(160),
            confidence: z.number().min(0).max(100),
            polygon: z
              .array(
                z
                  .object({ x: z.number().finite(), y: z.number().finite() })
                  .strict(),
              )
              .min(4)
              .max(8)
              .optional(),
            box: boxSchema,
          })
          .strict(),
      )
      .max(300),
    elapsedMs: z.number().finite().nonnegative(),
    engine: z.enum(["tesseract-6.0.1-eng-fast", "paddle-0.4.2-v6-tiny"]),
  })
  .strict();
export type RecognitionInput = z.infer<typeof recognitionInputSchema>;
export type VisualObservation = z.infer<typeof visualObservationSchema>;
export function sameVisualStamp(
  a: z.infer<typeof visualStampSchema>,
  b: z.infer<typeof visualStampSchema>,
) {
  return Object.keys(visualStampSchema.shape).every(
    (key) => a[key as keyof typeof a] === b[key as keyof typeof b],
  );
}
export function validatePng(input: RecognitionInput) {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(input.image))
    throw new Error("Invalid PNG encoding");
  const binary =
    typeof Buffer !== "undefined"
      ? Buffer.from(input.image, "base64")
      : Uint8Array.from(atob(input.image), (c) => c.charCodeAt(0));
  if (
    binary.length > 4194304 ||
    binary.length < 24 ||
    [137, 80, 78, 71, 13, 10, 26, 10].some((v, i) => binary[i] !== v)
  )
    throw new Error("Expected a PNG of at most four MB");
  const view = new DataView(
    binary.buffer,
    binary.byteOffset,
    binary.byteLength,
  );
  if (
    view.getUint32(16) !== input.width ||
    view.getUint32(20) !== input.height ||
    input.width * input.height > 4000000
  )
    throw new Error("PNG dimensions do not match capture metadata");
  return binary;
}
