import {
  InferenceQueue,
  inferencePriority,
} from "../../../packages/nlp/work-queue";
import { parentPort, workerData } from "node:worker_threads";
import { NavigationCore } from "../../../packages/navigation-core";
import { SemanticIndex, MiniLM } from "../../../packages/nlp";
import { SqliteStorage } from "./storage";
import { planInputSchema } from "../../../packages/navigation-core/contracts";
const store = new SqliteStorage(workerData.database);
const core = new NavigationCore(
  new SemanticIndex(new MiniLM(workerData.models), store),
);
const queue = new InferenceQueue<any, unknown>(async (message, signal) => {
  const input = planInputSchema.parse(message.input);
  const memory = message.memory || (await store.get(input.observation.origin));
  return message.type === "suggestions"
    ? core.suggestions(input, memory, signal)
    : core.plan(input, memory, signal);
});
parentPort!.on("message", (message) => {
  if (message.type === "cancel") {
    queue.cancel((job) => job.id === message.id);
    return;
  }
  if (message.type === "reset") {
    queue.cancel();
    core.index.invalidateCache();
    parentPort!.postMessage({ id: message.id, value: { ok: true } });
    return;
  }
  const input = message.input;
  const key = `${input?.tabId ?? "local"}:${input?.documentId ?? "unknown"}`;
  void queue
    .submit(
      message.id,
      key,
      inferencePriority(input || {}, message.type === "suggestions"),
      message,
    )
    .then(
      (value) => parentPort!.postMessage({ id: message.id, value }),
      (error) =>
        parentPort!.postMessage({ id: message.id, error: error.message }),
    );
});
// Imports, storage and request handling are initialized; model loading stays lazy.
parentPort!.postMessage({ type: "ready" });
