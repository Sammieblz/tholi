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
  if (message.type === "CANCEL_NLP") {
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
