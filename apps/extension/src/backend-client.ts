import type { PlanInput } from "../../../packages/navigation-core/contracts";
import { resultSchema } from "../../../packages/navigation-core/contracts";
import type { SiteMemory, SavedTask } from "../../../packages/page-model";
import {
  structuralObservation,
  structuralKnowledge,
  parameterizedTask,
} from "../../../packages/navigation-core/privacy";
type Settings = { url: string; token: string; enabled: boolean };
const planning = new Set<AbortController>();
export function cancelBackendPlanning() {
  for (const controller of planning) controller.abort();
  planning.clear();
}
export async function backendSettings(): Promise<Settings> {
  return (
    (await chrome.storage.local.get("backend")).backend || {
      url: "http://127.0.0.1:8787",
      token: "",
      enabled: false,
    }
  );
}
export async function setBackendSettings(settings: Settings) {
  const url = new URL(settings.url);
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    (url.protocol !== "https:" &&
      !(
        url.protocol === "http:" &&
        ["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
      ))
  )
    throw new Error("Use HTTPS or a loopback HTTP address.");
  if (settings.enabled && settings.token.length < 32)
    throw new Error("Paste the API’s generated bearer token.");
  await chrome.storage.local.setAccessLevel({
    accessLevel: "TRUSTED_CONTEXTS",
  });
  await chrome.storage.local.set({
    backend: {
      url: url.origin,
      token: settings.token,
      enabled: settings.enabled,
    },
  });
  return { ok: true };
}
async function call(
  settings: Settings,
  path: string,
  body: unknown,
  version = 1,
) {
  const controller = new AbortController(),
    isPlanning = ["plans", "suggestions"].includes(path);
  if (isPlanning) planning.add(controller);
  try {
    const response = await fetch(settings.url + "/v" + version + "/" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + settings.token,
      },
      body: JSON.stringify(body),
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(8000)]),
    });
    if (!response.ok) throw new Error("Backend unavailable.");
    return await response.json();
  } finally {
    planning.delete(controller);
  }
}
export async function backendNlp(
  input: PlanInput,
  suggestions: boolean,
  memory?: SiteMemory,
) {
  const settings = await backendSettings();
  if (!settings.enabled) return undefined;
  const version = input.protocolVersion === 2 ? 2 : 1;
  if (version === 2) {
    const capability = await fetch(settings.url + "/v2/health", {
      headers: { Authorization: "Bearer " + settings.token },
      signal: AbortSignal.timeout(2000),
    });
    if (!capability.ok) return undefined;
    const health = await capability.json();
    if (
      !health.protocols?.includes(2) ||
      (/\b(settings?|preferences?)\b/i.test(input.text) &&
        !health.capabilities?.includes("settings-navigation"))
    )
      return undefined;
  }
  if (memory && memory.origin === input.observation.origin)
    await call(settings, "knowledge", structuralKnowledge(memory), version);
  await call(
    settings,
    "observations",
    { observation: structuralObservation(input.observation) },
    version,
  );
  const value = await call(
    settings,
    suggestions ? "suggestions" : "plans",
    input,
    version,
  );
  return suggestions
    ? value.suggestions
    : value.status === "pending-indexing"
      ? undefined
      : resultSchema.parse(value);
}
export async function mirrorRoute(task: SavedTask) {
  const settings = await backendSettings();
  if (settings.enabled) await call(settings, "routes", parameterizedTask(task));
}
export async function deleteBackendMemory(origin?: string) {
  const settings = await backendSettings();
  if (!settings.enabled) return;
  // Surface mirror deletion failures, rather than claiming remote data was erased.
  await call(settings, origin ? "forget" : "clear", origin ? { origin } : {});
}

export async function backendOcr(
  input: import("../../../packages/vision/contracts").RecognitionInput,
  signal?: AbortSignal,
) {
  const settings = await backendSettings();
  if (!settings.enabled) return;
  const health = await fetch(settings.url + "/v2/health", {
    headers: { Authorization: "Bearer " + settings.token },
    signal: AbortSignal.any([
      signal || new AbortController().signal,
      AbortSignal.timeout(2000),
    ]),
  });
  if (!health.ok || !(await health.json()).capabilities?.includes("cpu-ocr"))
    return;
  const response = await fetch(settings.url + "/v2/ocr", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + settings.token,
    },
    body: JSON.stringify(input),
    signal: AbortSignal.any([
      signal || new AbortController().signal,
      AbortSignal.timeout(10000),
    ]),
  });
  if (!response.ok) throw new Error("Backend OCR unavailable");
  return response.json();
}
