const pending = new Map<
  string,
  { respond: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }
>();
function createWorker() {
  const instance = new Worker(chrome.runtime.getURL("inference.js"), {
    type: "module",
  });
  instance.onmessage = (event) => {
    const value = event.data,
      entry = pending.get(value.id);
    if (!entry) return;
    clearTimeout(entry.timer);
    entry.respond(value);
    pending.delete(value.id);
  };
  instance.onerror = (event) => {
    event.preventDefault();
    resetWorker("Local inference failed. Please try again.");
  };
  instance.onmessageerror = () =>
    resetWorker(
      "Local inference returned an invalid response. Please try again.",
    );
  return instance;
}
let worker = createWorker();
function resetWorker(error: string) {
  worker.terminate();
  for (const [id, entry] of pending) {
    clearTimeout(entry.timer);
    entry.respond({ id, error });
  }
  pending.clear();
  worker = createWorker();
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== "offscreen")
    return;
  if (["OCR_REQUEST", "CANCEL_OCR"].includes(message.type)) return;
  if (message.type === "CANCEL_NLP") {
    cancelOcr();
    resetWorker("Planning canceled.");
    respond({ ok: true });
    return;
  }
  pending.set(message.id, {
    respond,
    timer: setTimeout(
      () => resetWorker("Local inference took too long. Please try again."),
      30000,
    ),
  });
  worker.postMessage(message);
  return true;
});

let ocrWorker: Worker | undefined;
const ocrPending = new Map<
  string,
  { respond: (value: unknown) => void; timer: ReturnType<typeof setTimeout> }
>();
function cancelOcr(error = "OCR canceled") {
  ocrWorker?.terminate();
  ocrWorker = undefined;
  for (const [id, p] of ocrPending) {
    clearTimeout(p.timer);
    p.respond({ id, error });
  }
  ocrPending.clear();
}
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message.target !== "offscreen") return;
  if (message.type === "CANCEL_OCR") {
    cancelOcr();
    respond({ ok: true });
    return;
  }
  if (message.type !== "OCR_REQUEST") return;
  if (!ocrWorker) {
    ocrWorker = new Worker(chrome.runtime.getURL("ocr-worker.js"), {
      type: "module",
    });
    ocrWorker.onmessage = (event) => {
      const p = ocrPending.get(event.data.id);
      if (!p) return;
      clearTimeout(p.timer);
      p.respond(event.data);
      ocrPending.delete(event.data.id);
    };
    ocrWorker.onerror = () => cancelOcr("OCR worker failed");
    ocrWorker.onmessageerror = () => cancelOcr("Invalid OCR response");
  }
  ocrPending.set(message.id, {
    respond,
    timer: setTimeout(() => cancelOcr("OCR timed out"), 30000),
  });
  ocrWorker.postMessage(message);
  return true;
});
