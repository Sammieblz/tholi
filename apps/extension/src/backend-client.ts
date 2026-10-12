import type { PlanInput } from "../../../packages/navigation-core/contracts";
import { resultSchema } from "../../../packages/navigation-core/contracts";
import type { SiteMemory, SavedTask } from "../../../packages/page-model";
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
async function call(settings: Settings, path: string, body: unknown) {
  const controller = new AbortController(),
    isPlanning = ["plans", "suggestions"].includes(path);
  if (isPlanning) planning.add(controller);
  try {
    const response = await fetch(settings.url + "/v1/" + path, {
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
  if (memory && memory.origin === input.observation.origin)
    await call(settings, "knowledge", memory);
  await call(settings, "observations", { observation: input.observation });
  const value = await call(
    settings,
    suggestions ? "suggestions" : "plans",
    input,
  );
  return suggestions
    ? value.suggestions
    : value.status === "pending-indexing"
      ? undefined
      : resultSchema.parse(value);
}
export async function mirrorRoute(task: SavedTask) {
  const settings = await backendSettings();
  if (settings.enabled) await call(settings, "routes", task);
}
export async function deleteBackendMemory(origin?: string) {
  const settings = await backendSettings();
  if (!settings.enabled) return;
  // Surface mirror deletion failures, rather than claiming remote data was erased.
  await call(settings, origin ? "forget" : "clear", origin ? { origin } : {});
}
