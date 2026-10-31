import { getPrivateSetting, setPrivateSetting } from "./private-settings";
import { hasBackendAccess } from "./site-access";
import type { PlanInput } from "../../../../packages/navigation-core/contracts";
import { resultSchema } from "../../../../packages/navigation-core/contracts";
import {
  recognitionInputSchema,
  validatePng,
  type RecognitionInput,
} from "../../../../packages/vision/contracts";
import {
  parameterizedTask,
  structuralKnowledge,
  structuralObservation,
} from "../../../../packages/navigation-core/privacy";
import type {
  SavedTask,
  SiteMemory,
} from "../../../../packages/page-model/index";
import {
  joinNavigationDecision,
  navigationCancellationSchema,
  navigationRequestStatusSchema,
  navigationTransportInputSchema,
  navigationTransportResponseSchema,
  validateNavigationObservationContext,
  type NavigationTransportInput,
  type NavigationValidationContext,
} from "../../../../packages/navigation-core/contracts-navigation";
import { awaitAbortableOperation } from "../../../../packages/navigation-core/abort";
import { ServiceClientError } from "../../../../packages/navigation-core/service-client";
import {
  cancelServiceInference,
  serviceAuthorizedRequest,
  serviceInferenceAccess,
  serviceInferencePreflight,
  serviceInferenceSignal,
  serviceInferenceCurrent,
} from "./service-auth";
type Settings = { url: string; token: string; enabled: boolean };
const planning = new Set<AbortController>();
export function cancelBackendPlanning() {
  for (const controller of planning) controller.abort();
  planning.clear();
  cancelServiceInference();
}
export async function backendSettings(): Promise<Settings> {
  return (
    (await getPrivateSetting<Settings>("backend")) || {
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
  if (settings.enabled && !(await hasBackendAccess(url.origin)))
    throw new Error(
      "Allow backend website access and data transmission before connecting.",
    );
  await setPrivateSetting("backend", {
    url: url.origin,
    token: settings.token,
    enabled: settings.enabled,
  });
  return { ok: true };
}
async function backendFetch(
  settings: Settings,
  path: string,
  init: RequestInit | (() => Promise<RequestInit>),
) {
  if (!(await hasBackendAccess(settings.url)))
    throw new Error(
      "Backend data transmission permission was declined or revoked.",
    );
  const request = typeof init === "function" ? await init() : init;
  request.signal?.throwIfAborted();
  return fetch(settings.url + path, {
    ...request,
    headers: {
      ...request.headers,
      Authorization: "Bearer " + settings.token,
    },
  });
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
    const response = await backendFetch(settings, "/v" + version + "/" + path, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
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
    const capability = await backendFetch(settings, "/v2/health", {
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
  raw: RecognitionInput,
  signal: AbortSignal | undefined,
  beforeSend: () => Promise<void>,
) {
  const settings = await backendSettings();
  if (!settings.enabled) return;
  const health = await backendFetch(settings, "/v2/health", {
    signal: AbortSignal.any([
      signal || new AbortController().signal,
      AbortSignal.timeout(2000),
    ]),
  });
  if (!health.ok || !(await health.json()).capabilities?.includes("cpu-ocr"))
    return;
  const response = await backendFetch(settings, "/v2/ocr", async () => {
    const current = await backendSettings();
    if (
      !current.enabled ||
      current.url !== settings.url ||
      current.token !== settings.token
    )
      throw Error("The backend connection changed before image transmission.");
    // All capability, consent and protected-setting awaits precede the capture
    // owner's final native/viewport check. Only a bounded prepared PNG is sent.
    await beforeSend();
    signal?.throwIfAborted();
    const input = recognitionInputSchema.parse(raw);
    validatePng(input);
    return {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
      signal: AbortSignal.any([
        signal || new AbortController().signal,
        AbortSignal.timeout(10000),
      ]),
    };
  });
  if (!response.ok) throw new Error("Backend OCR unavailable");
  return response.json();
}

/** Explicit service transport; legacy private NLP/OCR never selects this path. */
export async function backendNavigation(
  raw: NavigationTransportInput,
  current: () => NavigationValidationContext,
  beforeSend: () => Promise<void>,
  callerSignal?: AbortSignal,
) {
  const parsed = navigationTransportInputSchema.safeParse(raw);
  if (!parsed.success)
    throw new ServiceClientError(
      "INVALID_REQUEST",
      0,
      "The navigation request is invalid.",
    );
  const input = parsed.data;
  const original = validateNavigationObservationContext(
    input.observation,
    input.validation,
  );
  if (!original.accepted)
    throw new ServiceClientError(
      "INVALID_REQUEST",
      0,
      "The original navigation context is invalid.",
    );
  const currentContext = () => {
    const latest = current();
    if (
      latest.requestStartedAtMs !== input.validation.requestStartedAtMs ||
      latest.nowMs < input.validation.nowMs
    )
      throw new ServiceClientError(
        "INVALID_REQUEST",
        0,
        "The original navigation clock changed.",
      );
    return {
      ...latest,
      requestDeadlineMs: Math.min(
        input.validation.requestDeadlineMs,
        latest.requestDeadlineMs,
      ),
    };
  };
  const initial = currentContext();
  const admitted = validateNavigationObservationContext(
    input.observation,
    initial,
  );
  if (!admitted.accepted)
    throw new ServiceClientError(
      "INVALID_REQUEST",
      0,
      "Fresh navigation context is required.",
    );
  const remaining = Math.min(
    input.policy.timeoutMs,
    input.observation.deadlineAtMs - initial.nowMs,
    initial.requestDeadlineMs - initial.nowMs,
  );
  if (remaining < 1)
    throw new ServiceClientError(
      "DEADLINE_EXCEEDED",
      0,
      "The navigation deadline expired.",
    );
  const started = performance.now();
  const deadline = AbortSignal.timeout(Math.floor(remaining));
  // Start the original clock and identity spans before any storage/auth await.
  const signal = AbortSignal.any([
    deadline,
    serviceInferenceSignal(),
    ...(callerSignal ? [callerSignal] : []),
  ]);
  const interrupted = () =>
    new ServiceClientError(
      deadline.aborted ? "DEADLINE_EXCEEDED" : "CANCELLED",
      0,
      deadline.aborted
        ? "The navigation deadline expired."
        : "The navigation request was cancelled.",
    );
  const check = () => {
    signal.throwIfAborted();
    serviceInferenceCurrent(input);
    const context = validateNavigationObservationContext(
      input.observation,
      currentContext(),
    );
    if (!context.accepted)
      throw new ServiceClientError(
        "INVALID_REQUEST",
        0,
        "The navigation context changed.",
      );
  };
  return awaitAbortableOperation(
    async () => {
      const images = input.observation.images.length > 0;
      const binding = await serviceInferenceAccess(images, input);
      check();
      const response = await serviceAuthorizedRequest(
        (account) => `/api/v1/workspaces/${account.workspaceId}/decisions`,
        navigationTransportResponseSchema,
        "POST",
        input,
        {
          signal,
          profile: "navigation",
          timeoutMs: Math.max(
            1,
            Math.floor(remaining - (performance.now() - started)),
          ),
          beforeSend: async (connected) => {
            const fresh = await serviceInferencePreflight(
              images,
              signal,
              input,
            );
            if (
              fresh.origin !== binding.origin ||
              connected.origin !== binding.origin ||
              fresh.account.id !== binding.account.id ||
              connected.account.id !== binding.account.id ||
              fresh.account.workspaceId !== binding.account.workspaceId ||
              connected.account.workspaceId !== binding.account.workspaceId
            )
              throw new ServiceClientError(
                "FORBIDDEN",
                0,
                "The inference account connection changed.",
              );
            check();
            // Native capture freshness is the last asynchronous operation. Its
            // owner performs masking, current grants and actual document checks.
            await beforeSend();
            check();
          },
        },
      );
      check();
      if (response.requestId !== input.requestId)
        throw new ServiceClientError(
          "INVALID_RESPONSE",
          0,
          "The inference response belongs to another request.",
        );
      if (
        response.decision &&
        !joinNavigationDecision(
          response.decision,
          input.observation,
          currentContext(),
        ).accepted
      )
        throw new ServiceClientError(
          "INVALID_RESPONSE",
          0,
          "The inference proposal does not match current navigation context.",
        );
      return response;
    },
    signal,
    interrupted,
  );
}

function transportRequestId(raw: string) {
  const parsed = navigationRequestStatusSchema.shape.requestId.safeParse(raw);
  if (!parsed.success)
    throw new ServiceClientError(
      "INVALID_REQUEST",
      0,
      "The navigation request identifier is invalid.",
    );
  return parsed.data;
}

/** Metadata only. Status retrieval never repeats a model generation. */
export async function backendNavigationStatus(
  raw: string,
  signal?: AbortSignal,
) {
  const requestId = transportRequestId(raw);
  const result = await serviceAuthorizedRequest(
    (account) =>
      `/api/v1/workspaces/${account.workspaceId}/decisions/${requestId}`,
    navigationRequestStatusSchema,
    "GET",
    undefined,
    { signal },
  );
  if (result.requestId !== requestId)
    throw new ServiceClientError(
      "INVALID_RESPONSE",
      0,
      "The inference status belongs to another request.",
    );
  return result;
}

/** Acknowledged cancellation intent cannot establish provider cancellation. */
export async function cancelBackendNavigation(
  raw: string,
  signal?: AbortSignal,
) {
  const requestId = transportRequestId(raw);
  const result = await serviceAuthorizedRequest(
    (account) =>
      `/api/v1/workspaces/${account.workspaceId}/decisions/${requestId}/cancel`,
    navigationCancellationSchema,
    "POST",
    {},
    { signal },
  );
  if (result.requestId !== requestId)
    throw new ServiceClientError(
      "INVALID_RESPONSE",
      0,
      "The inference cancellation belongs to another request.",
    );
  return result;
}
