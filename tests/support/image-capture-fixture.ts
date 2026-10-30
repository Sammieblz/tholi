import { randomUUID } from "node:crypto";
import {
  captureMetadataSchema,
  type CaptureMetadata,
} from "../../packages/vision/contracts";

/** Declared public image coordinates, never a substitute for native capture identity. */
export function imageCaptureFixture(
  width: number,
  height: number,
  masks: CaptureMetadata["masks"] = [],
) {
  return {
    metadata: captureMetadataSchema.parse({
      version: 1,
      captureId: randomUUID(),
      scanId: randomUUID(),
      observationRevision: 1,
      viewportRevision: 1,
      at: Date.now(),
      viewport: {
        width,
        height,
        scrollX: 0,
        scrollY: 0,
        devicePixelRatio: 1,
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
      masks,
      masking: { version: 1, complete: true },
    }),
    captureCssBounds: { x: 0, y: 0, width, height },
    browserZoom: 1,
  };
}
