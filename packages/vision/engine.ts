import { createWorker, OEM, PSM, type Worker } from "tesseract.js";
import {
  recognitionInputSchema,
  visualObservationSchema,
  validatePng,
  type RecognitionInput,
  type VisualObservation,
} from "./contracts";
export class OcrEngine {
  private worker?: Promise<Worker>;
  constructor(
    private paths: { langPath: string; corePath?: string; workerPath?: string },
  ) {}
  private open() {
    return (this.worker ||= createWorker("eng", OEM.LSTM_ONLY, {
      ...this.paths,
      gzip: false,
      workerBlobURL: false,
      cacheMethod: "none",
      legacyCore: false,
      legacyLang: false,
    })
      .then(async (w) => {
        await w.setParameters({ tessedit_pageseg_mode: PSM.SPARSE_TEXT });
        return w;
      })
      .catch((error) => {
        this.worker = undefined;
        throw error;
      }));
  }
  async recognize(
    raw: RecognitionInput,
    signal?: AbortSignal,
  ): Promise<VisualObservation> {
    const input = recognitionInputSchema.parse(raw);
    validatePng(input);
    signal?.throwIfAborted();
    const started = performance.now();
    let rejectCanceled: (error: Error) => void = () => {};
    const canceled = new Promise<never>((_, reject) => {
      rejectCanceled = reject;
    });
    const abort = () => {
      rejectCanceled(new DOMException("OCR canceled", "AbortError"));
      void this.close();
    };
    signal?.addEventListener("abort", abort, { once: true });
    try {
      const worker = await Promise.race([this.open(), canceled]);
      signal?.throwIfAborted();
      const focus = input.focusRegions?.[0];
      const rectangle = focus
        ? {
            left: Math.floor((focus.x * input.width) / input.cssWidth),
            top: Math.floor((focus.y * input.height) / input.cssHeight),
            width: Math.max(
              1,
              Math.floor((focus.width * input.width) / input.cssWidth),
            ),
            height: Math.max(
              1,
              Math.floor((focus.height * input.height) / input.cssHeight),
            ),
          }
        : undefined;
      const recognize = (crop?: typeof rectangle) =>
        worker.recognize(
          "data:image/png;base64," + input.image,
          crop ? { rectangle: crop } : {},
          { blocks: true },
        );
      let result = await Promise.race([recognize(rectangle), canceled]);
      if (
        rectangle &&
        !(result.data.blocks || []).some((b) =>
          b.paragraphs.some((p) =>
            p.lines.some((line) => line.confidence >= 85 && line.text.trim()),
          ),
        )
      )
        result = await Promise.race([recognize(undefined), canceled]);
      signal?.throwIfAborted();
      const regions: VisualObservation["regions"] = [];
      for (const block of result.data.blocks || [])
        for (const paragraph of block.paragraphs)
          for (const line of paragraph.lines) {
            const text = line.text.trim().slice(0, 160),
              b = line.bbox;
            if (text && b.x1 > b.x0 && b.y1 > b.y0)
              regions.push({
                text,
                confidence: Math.max(0, Math.min(100, line.confidence)),
                box: {
                  x: (b.x0 * input.cssWidth) / input.width,
                  y: (b.y0 * input.cssHeight) / input.height,
                  width: ((b.x1 - b.x0) * input.cssWidth) / input.width,
                  height: ((b.y1 - b.y0) * input.cssHeight) / input.height,
                },
              });
          }
      const {
        image,
        width,
        height,
        cssWidth,
        cssHeight,
        focusRegions,
        ...stamp
      } = input;
      return visualObservationSchema.parse({
        ...stamp,
        regions: regions.slice(0, 300),
        elapsedMs: performance.now() - started,
        engine: "tesseract-6.0.1-eng-fast",
      });
    } finally {
      signal?.removeEventListener("abort", abort);
    }
  }
  async close() {
    const pending = this.worker;
    this.worker = undefined;
    if (pending) await (await pending.catch(() => undefined))?.terminate();
  }
}
