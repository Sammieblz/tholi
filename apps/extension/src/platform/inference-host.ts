import { api, browserTarget, chromiumApi } from "./api";
import { createInferenceHost } from "../inference/worker-host";
let creating: Promise<void> | undefined;
let host: ReturnType<typeof createInferenceHost> | undefined;
export async function ensureInferenceHost() {
  if (browserTarget() === "firefox") {
    host ||= createInferenceHost();
    return;
  }
  const native = chromiumApi();
  if (!native?.offscreen?.createDocument)
    throw Error("This browser cannot host local inference.");
  if (
    (
      await native.runtime.getContexts({
        contextTypes: [native.runtime.ContextType.OFFSCREEN_DOCUMENT],
      })
    ).length
  )
    return;
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
export async function requestInferenceHost(message: Record<string, unknown>) {
  await ensureInferenceHost();
  return browserTarget() === "firefox"
    ? host!.request(message)
    : api.runtime.sendMessage({ ...message, target: "offscreen" });
}
export async function disposeInferenceHost() {
  if (browserTarget() === "firefox") {
    host?.dispose();
    host = undefined;
  } else
    await chromiumApi()
      .offscreen.closeDocument()
      .catch(() => {});
}
export async function cancelInferenceHost(type: "CANCEL_NLP" | "CANCEL_OCR") {
  if (browserTarget() === "firefox") await host?.request({ type });
  else
    await api.runtime
      .sendMessage({ target: "offscreen", type })
      .catch(() => {});
}
