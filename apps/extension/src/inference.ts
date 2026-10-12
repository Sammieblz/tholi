import { NavigationCore } from "../../../packages/navigation-core";
import { MiniLM, SemanticIndex } from "../../../packages/nlp";
import { IndexedDBDerivedStore } from "../../../packages/site-memory/derived";
import { planInputSchema } from "../../../packages/navigation-core/contracts";
const root = new URL("./models/", import.meta.url).href;
const wasm = new URL("./runtime/", import.meta.url).href;
const core = new NavigationCore(
  new SemanticIndex(new MiniLM(root, wasm), new IndexedDBDerivedStore()),
);
const controllers = new Map<string, AbortController>();
// Foreground queries outrank background suggestions. Inference is one CPU
// thread; replacing a request aborts obsolete work between each model call.
const jobs: { message: any; controller: AbortController }[] = [];
let running = false;
let currentJob: { message: any; controller: AbortController } | undefined;
async function drain() {
  if (running) return;
  running = true;
  while (jobs.length) {
    jobs.sort(
      (a, b) =>
        Number(a.message.type === "SUGGEST_NLP") -
        Number(b.message.type === "SUGGEST_NLP"),
    );
    currentJob = jobs.shift()!;
    const { message, controller } = currentJob;
    try {
      const input = planInputSchema.parse(message.input);
      const value =
        message.type === "SUGGEST_NLP"
          ? await core.suggestions(input, message.memory, controller.signal)
          : await core.plan(input, message.memory, controller.signal);
      controller.signal.throwIfAborted();
      self.postMessage({ id: message.id, value });
    } catch (error) {
      self.postMessage({
        id: message.id,
        error:
          error instanceof Error ? error.message : "Local inference failed.",
      });
    } finally {
      controllers.delete(message.id);
      currentJob = undefined;
    }
  }
  running = false;
}
self.onmessage = (event) => {
  const message = event.data;
  if (message.type === "CANCEL_NLP") {
    for (const c of controllers.values()) c.abort();
    return;
  }
  if (message.type === "PLAN_NLP") {
    if (currentJob?.message.type === "SUGGEST_NLP")
      currentJob.controller.abort();
    for (const job of jobs)
      if (job.message.type === "SUGGEST_NLP") job.controller.abort();
  }
  const controller = new AbortController();
  controllers.set(message.id, controller);
  jobs.push({ message, controller });
  void drain();
};
