import {
  ensureInferenceHost,
  requestInferenceHost,
  disposeInferenceHost,
  cancelInferenceHost,
} from "../platform/inference-host";
import type { PlanInput } from "../../../../packages/navigation-core/contracts";
import type { SiteMemory } from "../../../../packages/page-model/index";
let idle: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let active = 0;
export async function localNlp(
  input: PlanInput,
  memory?: SiteMemory,
  suggestions = false,
) {
  clearTimeout(idle);
  const started = generation;
  active++;
  try {
    await ensureInferenceHost();
    const response = await requestInferenceHost({
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
        void disposeInferenceHost();
      }, 120000);
  }
}
export async function cancelNlp() {
  generation++;
  clearTimeout(idle);
  await cancelInferenceHost("CANCEL_NLP");
  await disposeInferenceHost();
}

export async function browserOcr(message: Record<string, unknown>) {
  clearTimeout(idle);
  active++;
  try {
    await ensureInferenceHost();
    const response = await requestInferenceHost({
      ...message,
      type: "OCR_REQUEST",
      id: crypto.randomUUID(),
    });
    if (!response || response.error)
      throw new Error(response?.error || "OCR unavailable");
    return response.value;
  } finally {
    active--;
    if (!active) idle = setTimeout(() => void disposeInferenceHost(), 120000);
  }
}
