import { z } from "zod";
import { hasPngSignature, readPngDimensions } from "./png";
import {
  navigationDomViewportSchema,
  navigationImagePixelsObjectSchema,
  refineNavigationImagePixels,
  navigationViewportExtent,
} from "../navigation-core/contracts-navigation";

export const VISION_CAPTURE_LIMITS = Object.freeze({
  maxSourcePixels: 16000000,
  maxSourceBytes: 16 * 1024 * 1024,
  maxMasks: 5000,
  maxOcrPixels: 4000000,
  maxOcrBytes: 4 * 1024 * 1024,
});
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
/** Ephemeral DOM evidence. Native identity and browser zoom belong to background. */
export const captureMetadataSchema = z
  .object({
    version: z.literal(1),
    captureId: z.string().uuid(),
    scanId: z.string().uuid(),
    observationRevision: z.number().int().nonnegative().safe(),
    viewportRevision: z.number().int().nonnegative().safe(),
    at: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER),
    viewport: navigationDomViewportSchema,
    masks: z.array(boxSchema).max(VISION_CAPTURE_LIMITS.maxMasks),
    focusRegions: z.array(boxSchema).max(1).optional(),
    masking: z
      .object({ version: z.literal(1), complete: z.literal(true) })
      .strict(),
  })
  .strict()
  .superRefine((metadata, context) => {
    const extent = navigationViewportExtent(metadata.viewport);
    if (
      [...metadata.masks, ...(metadata.focusRegions || [])].some(
        (box) =>
          box.x + box.width > extent.width ||
          box.y + box.height > extent.height,
      )
    )
      context.addIssue({
        code: "custom",
        message: "Capture region exceeds the observed viewport extent.",
      });
  });
export type CaptureMetadata = z.infer<typeof captureMetadataSchema>;
export const navigationPreparationSchema = z
  .object({ crop: boxSchema.optional() })
  .strict();
/** Pixel preparation supplies no invented native identity or request generations. */
export const preparedNavigationPixelsSchema = navigationImagePixelsObjectSchema
  .extend({
    captureId: captureMetadataSchema.innerType().shape.captureId,
    scanId: captureMetadataSchema.innerType().shape.scanId,
    observationRevision:
      captureMetadataSchema.innerType().shape.observationRevision,
    viewportRevision: captureMetadataSchema.innerType().shape.viewportRevision,
  })
  .strict()
  .superRefine(refineNavigationImagePixels);
export type PreparedNavigationPixels = z.infer<
  typeof preparedNavigationPixelsSchema
>;
export const recognitionInputSchema = visualStampSchema
  .extend({
    image: z.string().min(1).max(5592500),
    width: z.number().int().positive(),
    height: z.number().int().positive(),
    cssWidth: z.number().finite().positive(),
    cssHeight: z.number().finite().positive(),
    focusRegions: z.array(boxSchema).max(1).optional(),
  })
  .strict()
  .refine(
    (v) => v.width * v.height <= VISION_CAPTURE_LIMITS.maxOcrPixels,
    "Image exceeds four megapixels",
  )
  .refine(
    (v) =>
      !v.focusRegions?.some(
        (r) => r.x + r.width > v.cssWidth || r.y + r.height > v.cssHeight,
      ),
    "OCR region exceeds the viewport",
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
    binary.length > VISION_CAPTURE_LIMITS.maxOcrBytes ||
    binary.length < 24 ||
    !hasPngSignature(binary)
  )
    throw new Error("Expected a PNG of at most four MB");
  const { width, height } = readPngDimensions(binary);
  if (
    width !== input.width ||
    height !== input.height ||
    input.width * input.height > VISION_CAPTURE_LIMITS.maxOcrPixels
  )
    throw new Error("PNG dimensions do not match capture metadata");
  return binary;
}
