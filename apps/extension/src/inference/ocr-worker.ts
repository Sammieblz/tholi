import type { RecognitionInput } from "../../../../packages/vision/contracts";
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
async function prepare(message: any): Promise<RecognitionInput> {
  const bitmap = await createImageBitmap(
    await (await fetch(message.image)).blob(),
  );
  const factor = Math.min(
    1,
    Math.sqrt(4000000 / (bitmap.width * bitmap.height)),
  );
  const width = Math.max(1, Math.floor(bitmap.width * factor)),
    height = Math.max(1, Math.floor(bitmap.height * factor));
  const canvas = new OffscreenCanvas(width, height),
    context = canvas.getContext("2d")!;
  context.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();
  context.fillStyle = "#888";
  for (const mask of message.metadata.masks)
    context.fillRect(
      ((mask.x - 2) * width) / message.metadata.width,
      ((mask.y - 2) * height) / message.metadata.height,
      ((mask.width + 4) * width) / message.metadata.width,
      ((mask.height + 4) * height) / message.metadata.height,
    );
  const pixels = context.getImageData(0, 0, width, height);
  let sum = 0,
    count = 0;
  for (let i = 0; i < pixels.data.length; i += 400) {
    sum += pixels.data[i];
    count++;
  }
  const invert = sum / count < 96;
  for (let i = 0; i < pixels.data.length; i += 4) {
    let value =
      pixels.data[i] * 0.299 +
      pixels.data[i + 1] * 0.587 +
      pixels.data[i + 2] * 0.114;
    if (invert) value = 255 - value;
    pixels.data[i] = pixels.data[i + 1] = pixels.data[i + 2] = value;
  }
  context.putImageData(pixels, 0, 0);
  const blob = await canvas.convertToBlob({ type: "image/png" });
  if (blob.size > 4194304)
    throw new Error("Capture exceeds the four MB OCR limit");
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = "";
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return {
    ...message.stamp,
    image: btoa(binary),
    width,
    height,
    cssWidth: message.metadata.width,
    cssHeight: message.metadata.height,
    focusRegions: message.metadata.focusRegions,
  };
}
const jobs = new OcrQueue<any, unknown>(async (message, signal) => {
  if (message.compareRegion) {
    const box = message.compareRegion;
    const width = Math.max(1, Math.ceil(box.width)),
      height = Math.max(1, Math.ceil(box.height));
    if (width * height > 4000000) throw new Error("Visual region is too large");
    const pixels = async (url: string) => {
      const bitmap = await createImageBitmap(await (await fetch(url)).blob());
      const canvas = new OffscreenCanvas(width, height),
        context = canvas.getContext("2d")!;
      context.drawImage(
        bitmap,
        (box.x * bitmap.width) / message.metadata.width,
        (box.y * bitmap.height) / message.metadata.height,
        (box.width * bitmap.width) / message.metadata.width,
        (box.height * bitmap.height) / message.metadata.height,
        0,
        0,
        width,
        height,
      );
      bitmap.close();
      return context.getImageData(0, 0, width, height).data;
    };
    const a = await pixels(message.referenceImage),
      b = await pixels(message.image);
    signal.throwIfAborted();
    return { matches: a.length === b.length && a.every((v, i) => v === b[i]) };
  }
  const input = await prepare(message);
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
