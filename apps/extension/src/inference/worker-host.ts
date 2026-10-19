import { api } from "../platform/api";
type Reply = { id?: string; value?: unknown; error?: string; ok?: boolean };
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
  function cancel(kind: "nlp" | "ocr", error: string) {
    clearTimeout(idle[kind]);
    const entries = kind === "nlp" ? planning : recognition;
    (kind === "nlp" ? nlp : ocr)?.terminate();
    if (kind === "nlp") nlp = undefined;
    else ocr = undefined;
    for (const [id, entry] of entries) {
      clearTimeout(entry.timer);
      entry.resolve({ id, error });
    }
    entries.clear();
  }
  function start(kind: "nlp" | "ocr") {
    const entries = kind === "nlp" ? planning : recognition;
    const worker = new Worker(
      api.runtime.getURL(kind === "nlp" ? "inference.js" : "ocr-worker.js"),
      { type: "module" },
    );
    worker.onmessage = ({ data }: MessageEvent<Reply>) => {
      const entry = data?.id && entries.get(data.id);
      if (!entry || !data.id) return;
      clearTimeout(entry.timer);
      entries.delete(data.id);
      entry.resolve(data);
      if (!entries.size)
        idle[kind] = setTimeout(
          () => cancel(kind, "Idle worker released."),
          kind === "ocr" ? 10000 : 30000,
        );
    };
    worker.onerror = (event) => {
      event.preventDefault();
      cancel(
        kind,
        kind === "nlp"
          ? "Local inference failed. Please try again."
          : "OCR worker failed",
      );
    };
    worker.onmessageerror = () =>
      cancel(kind, "Local worker returned an invalid response.");
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
      const worker =
        kind === "nlp" ? (nlp ||= start(kind)) : (ocr ||= start(kind));
      const entries = kind === "nlp" ? planning : recognition,
        id = String(message.id);
      return new Promise((resolve) => {
        entries.set(id, {
          resolve,
          timer: setTimeout(
            () =>
              cancel(
                kind,
                kind === "nlp"
                  ? "Local inference took too long. Please try again."
                  : "OCR timed out",
              ),
            30000,
          ),
        });
        worker.postMessage(message);
      });
    },
    dispose() {
      cancel("nlp", "Planning canceled.");
      cancel("ocr", "OCR canceled");
    },
  };
}
