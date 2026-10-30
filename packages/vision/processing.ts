import {
  boxSchema,
  captureMetadataSchema,
  navigationPreparationSchema,
  preparedNavigationPixelsSchema,
  recognitionInputSchema,
  validatePng,
  visualStampSchema,
  VISION_CAPTURE_LIMITS,
  type CaptureMetadata,
  type PreparedNavigationPixels,
  type RecognitionInput,
  type VisualObservation,
} from "./contracts";
import {
  NAVIGATION_LIMITS,
  navigationCaptureSourceSchema,
  navigationViewportSchema,
  navigationImageMatchesViewport,
  type NavigationViewport,
} from "../navigation-core/contracts-navigation";
import { inspectPngData } from "./png";

type Box = CaptureMetadata["masks"][number];
export interface PixelCaptureRequest {
  image: string;
  metadata: CaptureMetadata;
  captureCssBounds: Box;
  browserZoom: number;
}
interface NativeSurface {
  canvas: OffscreenCanvas;
  metadata: CaptureMetadata;
  viewport: NavigationViewport;
  captureCssBounds: Box;
  scaleX: number;
  scaleY: number;
  maskedAtMs: number;
  maskedRegions: number;
}

function requireCapture(value: unknown, message: string): asserts value {
  if (!value) throw new Error(message);
}
function canvasContext(canvas: OffscreenCanvas) {
  const context = canvas.getContext("2d", {
    alpha: false,
    willReadFrequently: true,
  });
  requireCapture(context, "Capture pixel processing is unavailable.");
  return context;
}
function releaseCanvas(canvas: OffscreenCanvas | undefined) {
  if (canvas) {
    canvas.width = 0;
    canvas.height = 0;
  }
}

/** Decode only local bounded PNGs, then mask at native size before any transform. */
async function withMaskedNative<T>(
  request: PixelCaptureRequest,
  signal: AbortSignal,
  consume: (source: NativeSurface) => Promise<T>,
): Promise<T> {
  signal.throwIfAborted();
  const metadata = captureMetadataSchema.parse(request.metadata);
  const viewport = navigationViewportSchema.parse({
    ...metadata.viewport,
    browserZoom: request.browserZoom,
  });
  const extent = boxSchema.parse(request.captureCssBounds);
  requireCapture(
    extent.x === 0 &&
      extent.y === 0 &&
      extent.width === viewport.width &&
      extent.height === viewport.height,
    "Native capture extent does not match the observed layout viewport.",
  );
  // Desktop capture has been measured on this plane. Pinch-panned surfaces need
  // separately verified source-plane support rather than a guessed transform.
  requireCapture(
    viewport.visualViewport.offsetLeft === 0 &&
      viewport.visualViewport.offsetTop === 0 &&
      viewport.visualViewport.scale === 1,
    "This visual viewport cannot be captured with the current source profile.",
  );
  const prefix = "data:image/png;base64,";
  requireCapture(
    typeof request.image === "string" &&
      request.image.startsWith(prefix) &&
      request.image.length <=
        prefix.length + Math.ceil(VISION_CAPTURE_LIMITS.maxSourceBytes / 3) * 4,
    "Expected a bounded local PNG capture.",
  );
  const admitted = inspectPngData(request.image.slice(prefix.length), {
    maxBytes: VISION_CAPTURE_LIMITS.maxSourceBytes,
    maxPixels: VISION_CAPTURE_LIMITS.maxSourcePixels,
  });
  requireCapture(
    navigationCaptureSourceSchema.shape.bitmapWidth.safeParse(admitted.width)
      .success &&
      navigationCaptureSourceSchema.shape.bitmapHeight.safeParse(
        admitted.height,
      ).success,
    "Native capture dimensions exceed their bound.",
  );
  const scaleX = admitted.width / extent.width,
    scaleY = admitted.height / extent.height;
  requireCapture(
    navigationCaptureSourceSchema.shape.scaleX.safeParse(scaleX).success &&
      navigationCaptureSourceSchema.shape.scaleY.safeParse(scaleY).success,
    "The native pixel scale exceeds the capture profile.",
  );
  // Integer CSSOM dimensions and native pixels have bounded rounding precision.
  // Require one possible common scale inside both intervals; never infer it from
  // DPR/zoom or replace the original layout-relative source scales above.
  const scaleInterval = (
    pixels: number,
    layout: number,
    visibleEdge: number,
  ) => {
    const rounding = Number.isInteger(layout) ? 0.5 : 0;
    const minimumExtent = Math.max(layout - rounding, visibleEdge);
    return {
      minimum: (pixels - 0.5) / (layout + rounding),
      maximum: (pixels + 0.5) / minimumExtent,
    };
  };
  const xScale = scaleInterval(
    admitted.width,
    viewport.width,
    viewport.visualViewport.offsetLeft + viewport.visualViewport.width,
  );
  const yScale = scaleInterval(
    admitted.height,
    viewport.height,
    viewport.visualViewport.offsetTop + viewport.visualViewport.height,
  );
  requireCapture(
    Math.max(xScale.minimum, yScale.minimum) <=
      Math.min(xScale.maximum, yScale.maximum),
    "The native capture dimensions do not preserve the observed layout aspect.",
  );
  let bitmap: ImageBitmap | undefined;
  let canvas: OffscreenCanvas | undefined;
  try {
    // inspectPngData allocates an independent ordinary ArrayBuffer, not shared memory.
    bitmap = await createImageBitmap(
      new Blob([admitted.bytes.buffer as ArrayBuffer], { type: "image/png" }),
    );
    signal.throwIfAborted();
    requireCapture(
      bitmap.width === admitted.width && bitmap.height === admitted.height,
      "Decoded capture dimensions do not match the admitted PNG.",
    );
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvasContext(canvas);
    context.drawImage(bitmap, 0, 0);
    bitmap.close();
    bitmap = undefined;
    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
    context.fillStyle = "#888888";
    let maskedRegions = 0;
    for (const mask of metadata.masks) {
      const left = Math.max(0, Math.floor((mask.x - 2 - extent.x) * scaleX));
      const top = Math.max(0, Math.floor((mask.y - 2 - extent.y) * scaleY));
      const right = Math.min(
        canvas.width,
        Math.ceil((mask.x + mask.width + 2 - extent.x) * scaleX),
      );
      const bottom = Math.min(
        canvas.height,
        Math.ceil((mask.y + mask.height + 2 - extent.y) * scaleY),
      );
      if (right <= left || bottom <= top) continue;
      context.fillRect(left, top, right - left, bottom - top);
      maskedRegions++;
    }
    signal.throwIfAborted();
    return await consume({
      canvas,
      metadata,
      viewport,
      captureCssBounds: extent,
      scaleX,
      scaleY,
      maskedAtMs: Date.now(),
      maskedRegions,
    });
  } finally {
    bitmap?.close();
    releaseCanvas(canvas);
  }
}

function dimensions(
  width: number,
  height: number,
  maxPixels: number,
  maxDimension = Infinity,
) {
  const factor = Math.min(
    1,
    Math.sqrt(maxPixels / (width * height)),
    maxDimension / width,
    maxDimension / height,
  );
  const horizontal = width >= height;
  const shorter = horizontal ? height : width,
    longer = horizontal ? width : height;
  let short = Math.max(1, Math.floor(shorter * factor));
  let long = Math.max(1, Math.round((short * longer) / shorter));
  while (short > 1 && (short * long > maxPixels || long > maxDimension)) {
    short--;
    long = Math.max(1, Math.round((short * longer) / shorter));
  }
  requireCapture(
    short * long <= maxPixels && long <= maxDimension,
    "The capture aspect cannot fit the image limits without distortion.",
  );
  return horizontal
    ? { width: long, height: short }
    : { width: short, height: long };
}
function derivative(
  source: NativeSurface,
  pixels: Box,
  maxPixels: number,
  maxDimension = Infinity,
) {
  const size = dimensions(pixels.width, pixels.height, maxPixels, maxDimension);
  const canvas = new OffscreenCanvas(size.width, size.height);
  try {
    canvasContext(canvas).drawImage(
      source.canvas,
      pixels.x,
      pixels.y,
      pixels.width,
      pixels.height,
      0,
      0,
      size.width,
      size.height,
    );
    return canvas;
  } catch (error) {
    releaseCanvas(canvas);
    throw error;
  }
}
async function png(
  canvas: OffscreenCanvas,
  maxBytes: number,
  signal: AbortSignal,
) {
  signal.throwIfAborted();
  const blob = await canvas.convertToBlob({ type: "image/png" });
  signal.throwIfAborted();
  requireCapture(
    blob.size <= maxBytes,
    "Prepared capture exceeds its PNG byte limit.",
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  signal.throwIfAborted();
  let binary = "";
  for (let index = 0; index < bytes.length; index += 8192)
    binary += String.fromCharCode(...bytes.subarray(index, index + 8192));
  return btoa(binary);
}
function sourcePixels(source: NativeSurface) {
  return {
    x: 0,
    y: 0,
    width: source.canvas.width,
    height: source.canvas.height,
  };
}

/** Preserve the existing OCR wire and its layout-relative output coordinates. */
export async function prepareRecognitionCapture(
  request: PixelCaptureRequest & { stamp: unknown },
  signal: AbortSignal,
): Promise<RecognitionInput> {
  const stamp = visualStampSchema.parse(request.stamp);
  requireCapture(
    stamp.captureId === request.metadata?.captureId &&
      stamp.observationRevision === request.metadata?.observationRevision &&
      stamp.viewportRevision === request.metadata?.viewportRevision,
    "The OCR stamp does not match its capture lease.",
  );
  return withMaskedNative(request, signal, async (source) => {
    const canvas = derivative(
      source,
      sourcePixels(source),
      VISION_CAPTURE_LIMITS.maxOcrPixels,
    );
    try {
      const context = canvasContext(canvas),
        pixels = context.getImageData(0, 0, canvas.width, canvas.height);
      let sum = 0,
        count = 0;
      for (let index = 0; index < pixels.data.length; index += 400) {
        sum += pixels.data[index];
        count++;
      }
      const invert = sum / count < 96;
      for (let index = 0; index < pixels.data.length; index += 4) {
        let value =
          pixels.data[index] * 0.299 +
          pixels.data[index + 1] * 0.587 +
          pixels.data[index + 2] * 0.114;
        if (invert) value = 255 - value;
        pixels.data[index] =
          pixels.data[index + 1] =
          pixels.data[index + 2] =
            value;
      }
      context.putImageData(pixels, 0, 0);
      return recognitionInputSchema.parse({
        ...stamp,
        image: await png(canvas, VISION_CAPTURE_LIMITS.maxOcrBytes, signal),
        width: canvas.width,
        height: canvas.height,
        cssWidth: source.viewport.width,
        cssHeight: source.viewport.height,
        // A legacy OCR hint cannot represent the fractional visible band. Drop
        // that optional hint rather than inventing coordinates or dropping masks.
        focusRegions: source.metadata.focusRegions?.filter(
          (region) =>
            region.x + region.width <= source.viewport.width &&
            region.y + region.height <= source.viewport.height,
        ),
      });
    } finally {
      releaseCanvas(canvas);
    }
  });
}

function cropPixels(source: NativeSurface, requested: Box) {
  const visual = source.viewport.visualViewport;
  requireCapture(
    requested.x >= visual.offsetLeft &&
      requested.y >= visual.offsetTop &&
      requested.x + requested.width <= visual.offsetLeft + visual.width &&
      requested.y + requested.height <= visual.offsetTop + visual.height,
    "The requested crop is outside the captured visual viewport.",
  );
  const extent = source.captureCssBounds;
  // Keep a crop wholly inside the visible pixel plane. Its reported CSS bounds
  // are reconstructed from these exact quantized pixels below.
  const left = Math.max(
    Math.ceil((visual.offsetLeft - extent.x) * source.scaleX),
    Math.floor((requested.x - extent.x) * source.scaleX),
  );
  const top = Math.max(
    Math.ceil((visual.offsetTop - extent.y) * source.scaleY),
    Math.floor((requested.y - extent.y) * source.scaleY),
  );
  const right = Math.min(
    Math.floor((visual.offsetLeft + visual.width - extent.x) * source.scaleX),
    Math.ceil((requested.x + requested.width - extent.x) * source.scaleX),
  );
  const bottom = Math.min(
    Math.floor((visual.offsetTop + visual.height - extent.y) * source.scaleY),
    Math.ceil((requested.y + requested.height - extent.y) * source.scaleY),
  );
  requireCapture(
    right > left && bottom > top,
    "The requested crop contains no complete visible pixels.",
  );
  return { x: left, y: top, width: right - left, height: bottom - top };
}

/** Optional color preparation. Default OCR never encodes an unused model image. */
export async function prepareNavigationCapture(
  request: PixelCaptureRequest & { prepareNavigation: { crop?: Box } },
  signal: AbortSignal,
): Promise<PreparedNavigationPixels> {
  const options = navigationPreparationSchema.parse(request.prepareNavigation);
  return withMaskedNative(request, signal, async (source) => {
    const visual = source.viewport.visualViewport;
    const requested = options.crop;
    const pixels = requested
      ? cropPixels(source, boxSchema.parse(requested))
      : {
          x: Math.round(
            (visual.offsetLeft - source.captureCssBounds.x) * source.scaleX,
          ),
          y: Math.round(
            (visual.offsetTop - source.captureCssBounds.y) * source.scaleY,
          ),
          width: Math.min(
            source.canvas.width,
            Math.round(visual.width * source.scaleX),
          ),
          height: Math.min(
            source.canvas.height,
            Math.round(visual.height * source.scaleY),
          ),
        };
    requireCapture(
      pixels.width > 0 &&
        pixels.height > 0 &&
        pixels.x + pixels.width <= source.canvas.width &&
        pixels.y + pixels.height <= source.canvas.height,
      "The visual viewport does not fit its original capture bitmap.",
    );
    const cssBounds = requested
      ? {
          x: source.captureCssBounds.x + pixels.x / source.scaleX,
          y: source.captureCssBounds.y + pixels.y / source.scaleY,
          width: pixels.width / source.scaleX,
          height: pixels.height / source.scaleY,
        }
      : {
          x: visual.offsetLeft,
          y: visual.offsetTop,
          width: visual.width,
          height: visual.height,
        };
    const canvas = derivative(
      source,
      pixels,
      NAVIGATION_LIMITS.maxImagePixels,
      NAVIGATION_LIMITS.maxImageDimension,
    );
    try {
      const image = await png(canvas, NAVIGATION_LIMITS.maxImageBytes, signal);
      const prepared = preparedNavigationPixelsSchema.parse({
        captureId: source.metadata.captureId,
        scanId: source.metadata.scanId,
        observationRevision: source.metadata.observationRevision,
        viewportRevision: source.metadata.viewportRevision,
        image,
        width: canvas.width,
        height: canvas.height,
        source: {
          kind: requested ? "crop" : "viewport",
          cssBounds,
          captureCssBounds: source.captureCssBounds,
          pixelBounds: pixels,
          bitmapWidth: source.canvas.width,
          bitmapHeight: source.canvas.height,
          scaleX: source.scaleX,
          scaleY: source.scaleY,
          devicePixelRatio: source.viewport.devicePixelRatio,
          browserZoom: source.viewport.browserZoom,
        },
        maskedAtMs: source.maskedAtMs,
        masking: {
          version: 1,
          complete: true,
          maskedBeforeTransform: true,
          maskedRegions: source.maskedRegions,
        },
      });
      requireCapture(
        navigationImageMatchesViewport(prepared, source.viewport),
        "The visible viewport cannot be represented within native pixel precision.",
      );
      return prepared;
    } finally {
      releaseCanvas(canvas);
    }
  });
}

/** Both comparison sources pass through the same masking stage before cropping. */
export async function compareCaptureRegions(
  request: PixelCaptureRequest & {
    referenceImage: string;
    referenceMetadata: CaptureMetadata;
    referenceCaptureCssBounds: Box;
    referenceBrowserZoom: number;
    compareRegion: Box;
  },
  signal: AbortSignal,
) {
  const box = boxSchema.parse(request.compareRegion);
  const pixels = (capture: PixelCaptureRequest) =>
    withMaskedNative(capture, signal, async (source) => {
      const canvas = derivative(
        source,
        cropPixels(source, box),
        VISION_CAPTURE_LIMITS.maxOcrPixels,
      );
      try {
        return {
          width: canvas.width,
          height: canvas.height,
          viewport: source.viewport,
          viewportRevision: source.metadata.viewportRevision,
          data: canvasContext(canvas).getImageData(
            0,
            0,
            canvas.width,
            canvas.height,
          ).data,
        };
      } finally {
        releaseCanvas(canvas);
      }
    });
  const before = await pixels({
    image: request.referenceImage,
    metadata: request.referenceMetadata,
    captureCssBounds: request.referenceCaptureCssBounds,
    browserZoom: request.referenceBrowserZoom,
  });
  signal.throwIfAborted();
  const after = await pixels(request);
  signal.throwIfAborted();
  requireCapture(
    JSON.stringify(before.viewport) === JSON.stringify(after.viewport) &&
      before.viewportRevision === after.viewportRevision,
    "The viewport changed before visual comparison.",
  );
  return {
    matches:
      before.width === after.width &&
      before.height === after.height &&
      before.data.length === after.data.length &&
      before.data.every((value, index) => value === after.data[index]),
  };
}
export async function recognizeWithFallback(
  capture: Record<string, unknown>,
  services: {
    browser: (message: Record<string, unknown>) => Promise<any>;
    backend: (
      input: RecognitionInput,
      signal?: AbortSignal,
    ) => Promise<VisualObservation | undefined>;
  },
  backendEnabled: boolean,
  signal: AbortSignal,
): Promise<VisualObservation> {
  signal.throwIfAborted();
  let result: VisualObservation | undefined;
  let prepared: RecognitionInput | undefined;
  if (backendEnabled) {
    prepared = recognitionInputSchema.parse(
      await services.browser({ ...capture, prepareOnly: true }),
    );
    validatePng(prepared);
    signal.throwIfAborted();
    try {
      result = await services.backend(prepared, signal);
    } catch {
      signal.throwIfAborted();
    }
  }
  signal.throwIfAborted();
  result ??= await services.browser(
    prepared ? { prepared, engine: capture.engine } : capture,
  );
  signal.throwIfAborted();
  return result!;
}
