import {
  recognitionInputSchema,
  validatePng,
  type RecognitionInput,
} from "../../../../packages/vision/contracts";
import {
  compareCaptureRegions,
  prepareNavigationCapture,
  prepareRecognitionCapture,
} from "../../../../packages/vision/processing";
import { OcrEngine } from "../../../../packages/vision/engine";
import { OcrQueue } from "../../../../packages/vision/queue";
const engine = new OcrEngine({
  langPath: new URL("./ocr", import.meta.url).href,
  corePath: new URL("./ocr", import.meta.url).href,
  workerPath: new URL("./ocr/worker.min.js", import.meta.url).href,
});
declare const __PADDLE_DEFAULT__: boolean;
declare const __PADDLE_BUNDLED__: boolean;
let paddle:
  import("../../../../packages/vision/paddle").PaddleEngine | undefined;
async function recognition(
  input: RecognitionInput,
  message: any,
  signal: AbortSignal,
) {
  if (message.engine === "paddle" && !__PADDLE_BUNDLED__)
    throw new Error(
      "PaddleOCR is not included in this build; use the experimental Paddle build to evaluate it",
    );
  if (
    __PADDLE_BUNDLED__ &&
    (message.engine === "paddle" ||
      (__PADDLE_DEFAULT__ && message.engine !== "tesseract"))
  ) {
    try {
      const { PaddleEngine } =
        await import("../../../../packages/vision/paddle");
      paddle ||= new PaddleEngine(
        new URL("./paddle/", import.meta.url).href,
        new URL("./runtime/", import.meta.url).href,
      );
      return await paddle.recognize(input, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (message.engine === "paddle") throw error; // Experiments must never masquerade as Paddle passes.
    }
  }
  return engine.recognize(input, signal);
}
const jobs = new OcrQueue<any, unknown>(async (message, signal) => {
  if (message.compareRegion) return compareCaptureRegions(message, signal);
  if (message.prepareNavigation)
    return prepareNavigationCapture(message, signal);
  const input = message.prepared
    ? recognitionInputSchema.parse(message.prepared)
    : await prepareRecognitionCapture(message, signal);
  if (message.prepared) validatePng(input);
  signal.throwIfAborted();
  return message.prepareOnly ? input : recognition(input, message, signal);
});
let idle: ReturnType<typeof setTimeout> | undefined;
self.onmessage = (event) => {
  const message = event.data;
  clearTimeout(idle);
  if (message.type === "CANCEL_OCR") {
    jobs.cancel();
    void engine.close();
    void paddle?.close();
    return;
  }
  void jobs
    .submit(message)
    .then((value) => self.postMessage({ id: message.id, value }))
    .catch((error) =>
      self.postMessage({ id: message.id, error: error.message }),
    )
    .finally(() => {
      idle = setTimeout(() => {
        void engine.close();
        void paddle?.close();
      }, 60000);
    });
};
