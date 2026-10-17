import type { PlanInput } from "../../../../packages/navigation-core/contracts";
import type { SiteMemory } from "../../../../packages/page-model/index";
let creating: Promise<void> | undefined;
let idle: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let active = 0;
export async function ensureOffscreen() {
  const contexts = await chrome.runtime.getContexts({
    contextTypes: [chrome.runtime.ContextType.OFFSCREEN_DOCUMENT],
  });
  if (contexts.length) return;
  await (creating ||= chrome.offscreen
    .createDocument({
      url: "offscreen.html",
      reasons: [chrome.offscreen.Reason.WORKERS],
      justification: "Run the packaged CPU NLP model in a local worker.",
    })
    .finally(() => {
      creating = undefined;
    }));
}
export async function localNlp(
  input: PlanInput,
  memory?: SiteMemory,
  suggestions = false,
) {
  clearTimeout(idle);
  const started = generation;
  active++;
  try {
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({
      target: "offscreen",
      type: suggestions ? "SUGGEST_NLP" : "PLAN_NLP",
      id: crypto.randomUUID(),
      input,
      memory,
    });
    if (started !== generation) throw new Error("Planning canceled.");
    if (response?.error || !response)
      throw new Error(response?.error || "Local inference unavailable.");
    return response.value;
  } finally {
    active--;
    if (!active)
      idle = setTimeout(() => {
        void chrome.offscreen.closeDocument().catch(() => {});
      }, 120000);
  }
}
export async function cancelNlp() {
  generation++;
  clearTimeout(idle);
  await chrome.runtime
    .sendMessage({ target: "offscreen", type: "CANCEL_NLP" })
    .catch(() => {});
  await chrome.offscreen.closeDocument().catch(() => {});
}

export async function browserOcr(message: Record<string, unknown>) {
  clearTimeout(idle);
  active++;
  try {
    await ensureOffscreen();
    const response = await chrome.runtime.sendMessage({
      ...message,
      target: "offscreen",
      type: "OCR_REQUEST",
      id: crypto.randomUUID(),
    });
    if (!response || response.error)
      throw new Error(response?.error || "OCR unavailable");
    return response.value;
  } finally {
    active--;
    if (!active)
      idle = setTimeout(
        () => void chrome.offscreen.closeDocument().catch(() => {}),
        120000,
      );
  }
}
