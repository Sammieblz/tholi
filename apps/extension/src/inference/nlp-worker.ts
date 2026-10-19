import {
  InferenceQueue,
  inferencePriority,
} from "../../../../packages/nlp/work-queue";
import { planInputSchema } from "../../../../packages/navigation-core/contracts";
import { NavigationCore } from "../../../../packages/navigation-core/index";
import { MiniLM, SemanticIndex } from "../../../../packages/nlp/index";
import { IndexedDBDerivedStore } from "../../../../packages/site-memory/derived";
const root = new URL("./models/", import.meta.url).href;
const wasm = new URL("./runtime/", import.meta.url).href;
const core = new NavigationCore(
  new SemanticIndex(new MiniLM(root, wasm), new IndexedDBDerivedStore()),
);
const queue = new InferenceQueue<any, unknown>(async (message, signal) => {
  const input = planInputSchema.parse(message.input);
  return message.type === "SUGGEST_NLP"
    ? core.suggestions(input, message.memory, signal)
    : core.plan(input, message.memory, signal);
});
self.onmessage = ({ data: message }) => {
  if (message.type === "CANCEL_NLP") {
    queue.cancel();
    return;
  }
  const input = message.input;
  const key = `${input?.tabId ?? "local"}:${input?.documentId ?? "unknown"}`;
  void queue
    .submit(
      message.id,
      key,
      inferencePriority(input || {}, message.type === "SUGGEST_NLP"),
      message,
    )
    .then(
      (value) => self.postMessage({ id: message.id, value }),
      (error) => self.postMessage({ id: message.id, error: error.message }),
    );
};
