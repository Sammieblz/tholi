import { api, browserTarget, chromiumApi } from "./api";
import { createInferenceHost } from "../inference/worker-host";
let creating: Promise<void> | undefined;
let disposing: Promise<void> | undefined;
let host: ReturnType<typeof createInferenceHost> | undefined;
export async function ensureInferenceHost(signal?: AbortSignal) {
  await disposing;
  signal?.throwIfAborted();
  if (browserTarget() === "firefox") {
    host ||= createInferenceHost();
    return;
  }
  const native = chromiumApi();
  if (!native?.offscreen?.createDocument)
    throw Error("This browser cannot host local inference.");
  const contexts = await native.runtime.getContexts({
    contextTypes: [native.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  signal?.throwIfAborted();
  if (contexts.length) return;
  await (creating ||= native.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: [native.offscreen.Reason.WORKERS],
      justification: "Run the packaged CPU NLP model in a local worker.",
    })
    .finally(() => {
      creating = undefined;
    }));
}
export async function requestInferenceHost(
  message: Record<string, unknown>,
  signal?: AbortSignal,
) {
  signal?.throwIfAborted();
  await ensureInferenceHost(signal);
  signal?.throwIfAborted();
  return browserTarget() === "firefox"
    ? host!.request(message)
    : api.runtime.sendMessage({ ...message, target: "offscreen" });
}
export async function disposeInferenceHost() {
  return (disposing ||= (async () => {
    // Finish opening the old host before closing it; a rapid Resume waits for
    // this disposal instead of having its new workers killed by late cleanup.
    await creating?.catch(() => {});
    if (browserTarget() === "firefox") {
      host?.dispose();
      host = undefined;
    } else
      await chromiumApi()
        .offscreen.closeDocument()
        .catch(() => {});
  })().finally(() => {
    disposing = undefined;
  }));
}
export async function cancelInferenceHost(type: "CANCEL_NLP" | "CANCEL_OCR") {
  if (browserTarget() === "firefox") await host?.request({ type });
  else
    await api.runtime
      .sendMessage({ target: "offscreen", type })
      .catch(() => {});
}
