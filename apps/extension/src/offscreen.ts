let worker = new Worker(chrome.runtime.getURL("inference.js"), {
  type: "module",
});
const pending = new Map<string, (value: unknown) => void>();
worker.onmessage = (event) => {
  const value = event.data;
  pending.get(value.id)?.(value);
  pending.delete(value.id);
};
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.target !== "offscreen")
    return;
  if (message.type === "CANCEL_NLP") {
    worker.postMessage(message);
    respond({ ok: true });
    return;
  }
  pending.set(message.id, respond);
  worker.postMessage(message);
  return true;
});
