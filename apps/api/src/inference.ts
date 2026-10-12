import { parentPort, workerData } from "node:worker_threads";
import { NavigationCore } from "../../../packages/navigation-core";
import { SemanticIndex, MiniLM } from "../../../packages/nlp";
import { SqliteStorage } from "./storage";
import { planInputSchema } from "../../../packages/navigation-core/contracts";
const store = new SqliteStorage(workerData.database);
const core = new NavigationCore(
  new SemanticIndex(new MiniLM(workerData.models), store),
);
const controllers = new Map<string, AbortController>();
parentPort!.on("message", async (message) => {
  if (message.type === "cancel") {
    controllers.get(message.id)?.abort();
    return;
  }
  if (message.type === "reset") {
    for (const controller of controllers.values()) controller.abort();
    core.index.invalidateCache();
    parentPort!.postMessage({ id: message.id, value: { ok: true } });
    return;
  }
  const controller = new AbortController();
  controllers.set(message.id, controller);
  try {
    const input = planInputSchema.parse(message.input),
      memory = message.memory || (await store.get(input.observation.origin));
    const value =
      message.type === "suggestions"
        ? await core.suggestions(input, memory, controller.signal)
        : await core.plan(input, memory, controller.signal);
    parentPort!.postMessage({ id: message.id, value });
  } catch (error) {
    parentPort!.postMessage({
      id: message.id,
      error: error instanceof Error ? error.message : "Inference failed",
    });
  } finally {
    controllers.delete(message.id);
  }
});
