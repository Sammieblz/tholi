import { api } from "../platform/api";
import { createInferenceHost } from "./worker-host";
const host = createInferenceHost();
api.runtime.onMessage.addListener((message, sender) => {
  if (sender.id !== api.runtime.id || message?.target !== "offscreen") return;
  return host.request(message);
});
