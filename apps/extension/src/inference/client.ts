import {
  requestInferenceHost,
  disposeInferenceHost,
} from "../platform/inference-host";
import type { PlanInput } from "../../../../packages/navigation-core/contracts";
import type { SiteMemory } from "../../../../packages/page-model/index";
let idle: ReturnType<typeof setTimeout> | undefined;
let generation = 0;
let lifetime = new AbortController();
let active = 0;
export async function localNlp(
  input: PlanInput,
  memory?: SiteMemory,
  suggestions = false,
) {
  clearTimeout(idle);
  const started = generation;
  const signal = lifetime.signal;
  active++;
  try {
    const response = await requestInferenceHost(
      {
        type: suggestions ? "SUGGEST_NLP" : "PLAN_NLP",
        id: crypto.randomUUID(),
        input,
        memory,
      },
      signal,
    );
    if (started !== generation) throw new Error("Planning canceled.");
    if (response?.error || !response)
      throw new Error(response?.error || "Local inference unavailable.");
    return response.value;
  } finally {
    active--;
    if (!active && started === generation)
      idle = setTimeout(() => {
        void disposeInferenceHost();
      }, 30000);
  }
}
export async function cancelNlp() {
  generation++;
  lifetime.abort();
  lifetime = new AbortController();
  clearTimeout(idle);
  // Termination does not wait for an already-busy worker's event loop.
  await disposeInferenceHost();
}

export async function browserOcr(message: Record<string, unknown>) {
  clearTimeout(idle);
  const started = generation,
    signal = lifetime.signal;
  active++;
  try {
    const response = await requestInferenceHost(
      {
        ...message,
        type: "OCR_REQUEST",
        id: crypto.randomUUID(),
      },
      signal,
    );
    signal.throwIfAborted();
    if (!response || response.error)
      throw new Error(response?.error || "OCR unavailable");
    return response.value;
  } finally {
    active--;
    if (!active && started === generation)
      idle = setTimeout(() => void disposeInferenceHost(), 30000);
  }
}
