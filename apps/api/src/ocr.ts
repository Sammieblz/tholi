import { parentPort, workerData } from "node:worker_threads";
import { OcrEngine } from "../../../packages/vision/engine";
import { OcrQueue } from "../../../packages/vision/queue";
const engine = new OcrEngine({ langPath: workerData.models });
const queue = new OcrQueue<any, unknown>((message, signal) =>
  engine.recognize(message.input, signal),
);
let idle: ReturnType<typeof setTimeout> | undefined;
parentPort!.on("message", (message) => {
  clearTimeout(idle);
  if (message.type === "cancel") {
    if (queue.cancel((input) => input.id === message.id)) void engine.close();
    return;
  }
  void queue
    .submit(message)
    .then((value) => parentPort!.postMessage({ id: message.id, value }))
    .catch((error) =>
      parentPort!.postMessage({ id: message.id, error: error.message }),
    )
    .finally(() => {
      idle = setTimeout(() => void engine.close(), 60000);
    });
});
