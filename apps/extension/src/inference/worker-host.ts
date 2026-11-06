import { api } from "../platform/api";
import {
  localEngineFailure,
  localEngineReplyFailure,
  type LocalEngineDiagnostic,
} from "../../../../packages/nlp/local-engine-error";
type Reply = {
  id?: string;
  value?: unknown;
  error?: string;
  diagnostic?: LocalEngineDiagnostic;
  ok?: boolean;
};
type Entry = {
  resolve: (reply: Reply) => void;
  timer: ReturnType<typeof setTimeout>;
};
/** One host implementation for the offscreen document and Firefox event page. */
export function createInferenceHost() {
  let nlp: Worker | undefined, ocr: Worker | undefined;
  const idle: Partial<Record<"nlp" | "ocr", ReturnType<typeof setTimeout>>> =
    {};
  const planning = new Map<string, Entry>(),
    recognition = new Map<string, Entry>();
  function cancel(
    kind: "nlp" | "ocr",
    error: string,
    diagnostic?: LocalEngineDiagnostic,
  ) {
    clearTimeout(idle[kind]);
    const entries = kind === "nlp" ? planning : recognition;
    (kind === "nlp" ? nlp : ocr)?.terminate();
    if (kind === "nlp") nlp = undefined;
    else ocr = undefined;
    for (const [id, entry] of entries) {
      clearTimeout(entry.timer);
      entry.resolve({ id, error, ...(diagnostic ? { diagnostic } : {}) });
    }
    entries.clear();
  }
  function start(kind: "nlp" | "ocr") {
    const entries = kind === "nlp" ? planning : recognition;
    const worker = new Worker(
      api.runtime.getURL(kind === "nlp" ? "inference.js" : "ocr-worker.js"),
      { type: "module" },
    );
    const current = () => (kind === "nlp" ? nlp : ocr) === worker;
    let ready = false;
    worker.onmessage = ({ data }: MessageEvent<Reply & { type?: string }>) => {
      if (!current()) return;
      if (data?.type === "LOCAL_WORKER_READY") {
        ready = true;
        return;
      }
      const entry = data?.id && entries.get(data.id);
      if (!entry || !data.id) return;
      ready = true;
      clearTimeout(entry.timer);
      entries.delete(data.id);
      entry.resolve(
        data.error
          ? {
              id: data.id,
              ...localEngineReplyFailure(
                data,
                kind === "nlp" ? "INFERENCE_FAILED" : "OCR_FAILED",
              ),
            }
          : { id: data.id, value: data.value },
      );
      if (!entries.size)
        idle[kind] = setTimeout(
          () => cancel(kind, "Idle worker released."),
          kind === "ocr" ? 10000 : 30000,
        );
    };
    worker.onerror = (event) => {
      event.preventDefault();
      if (!current()) return;
      const failure = localEngineFailure(
        undefined,
        !ready
          ? "WORKER_START_FAILED"
          : kind === "nlp"
            ? "INFERENCE_FAILED"
            : "OCR_FAILED",
      );
      cancel(kind, failure.error, failure.diagnostic);
    };
    worker.onmessageerror = () => {
      if (!current()) return;
      const failure = localEngineFailure(undefined, "WORKER_RESPONSE_INVALID");
      cancel(kind, failure.error, failure.diagnostic);
    };
    return worker;
  }
  return {
    request(message: Record<string, unknown>): Promise<Reply> {
      if (message.type === "CANCEL_NLP") {
        cancel("nlp", "Planning canceled.");
        cancel("ocr", "OCR canceled");
        return Promise.resolve({ ok: true });
      }
      if (message.type === "CANCEL_OCR") {
        cancel("ocr", "OCR canceled");
        return Promise.resolve({ ok: true });
      }
      const kind = message.type === "OCR_REQUEST" ? "ocr" : "nlp";
      clearTimeout(idle[kind]);
      let worker: Worker;
      const id = String(message.id);
      try {
        worker = kind === "nlp" ? (nlp ||= start(kind)) : (ocr ||= start(kind));
      } catch {
        return Promise.resolve({
          id,
          ...localEngineFailure(undefined, "WORKER_START_FAILED"),
        });
      }
      const entries = kind === "nlp" ? planning : recognition,
        timeout = kind === "nlp" ? "INFERENCE_TIMEOUT" : "OCR_TIMEOUT";
      return new Promise((resolve) => {
        entries.set(id, {
          resolve,
          timer: setTimeout(() => {
            const failure = localEngineFailure(undefined, timeout);
            cancel(kind, failure.error, failure.diagnostic);
          }, 30000),
        });
        try {
          worker.postMessage(message);
        } catch {
          const failure = localEngineFailure(
            undefined,
            "WORKER_REQUEST_FAILED",
          );
          cancel(kind, failure.error, failure.diagnostic);
        }
      });
    },
    dispose() {
      cancel("nlp", "Planning canceled.");
      cancel("ocr", "OCR canceled");
    },
  };
}
