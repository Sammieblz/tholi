import { PaddleOCR } from "@paddleocr/paddleocr-js";
import {
  recognitionInputSchema,
  visualObservationSchema,
  validatePng,
  type RecognitionInput,
  type VisualObservation,
} from "./contracts";
export class PaddleEngine {
  private pipeline?: ReturnType<typeof PaddleOCR.create>;
  constructor(
    private root: string,
    private runtime: string,
  ) {}
  private open() {
    return (this.pipeline ||= PaddleOCR.create({
      textDetectionModelName: "PP-OCRv6_tiny_det",
      textRecognitionModelName: "PP-OCRv6_tiny_rec",
      textDetectionModelAsset: { url: this.root + "PP-OCRv6_tiny_det.tar" },
      textRecognitionModelAsset: { url: this.root + "PP-OCRv6_tiny_rec.tar" },
      worker: false, // Already isolated in Navigator's dedicated worker.
      ortOptions: {
        backend: "wasm",
        wasmPaths: this.runtime,
        numThreads: 1,
        simd: true,
      },
    }));
  }
  async recognize(
    raw: RecognitionInput,
    signal?: AbortSignal,
  ): Promise<VisualObservation> {
    const input = recognitionInputSchema.parse(raw);
    validatePng(input);
    signal?.throwIfAborted();
    const start = performance.now();
    const engine = await this.open();
    signal?.throwIfAborted();
    const image = await createImageBitmap(
      await (await fetch("data:image/png;base64," + input.image)).blob(),
    );
    try {
      const [result] = await engine.predict(image, {
        textDetLimitSideLen: 960,
        textDetLimitType: "max",
        textRecScoreThresh: 0.5,
      });
      signal?.throwIfAborted();
      const { image: _, width, height, cssWidth, cssHeight, ...stamp } = input;
      return visualObservationSchema.parse({
        ...stamp,
        engine: "paddle-0.4.2-v6-tiny",
        elapsedMs: performance.now() - start,
        regions: result.items
          .slice(0, 300)
          .map((item) => {
            const xs = item.poly.map((p) => (p[0] * cssWidth) / width),
              ys = item.poly.map((p) => (p[1] * cssHeight) / height);
            return {
              text: item.text.trim().slice(0, 160),
              confidence: item.score * 100,
              polygon: xs.map((x, i) => ({ x, y: ys[i] })),
              box: {
                x: Math.min(...xs),
                y: Math.min(...ys),
                width: Math.max(...xs) - Math.min(...xs),
                height: Math.max(...ys) - Math.min(...ys),
              },
            };
          })
          .filter((r) => r.text && r.box.width > 0 && r.box.height > 0),
      });
    } finally {
      image.close();
    }
  }
  async close() {
    const current = this.pipeline;
    this.pipeline = undefined;
    if (current) await (await current).dispose();
  }
}
