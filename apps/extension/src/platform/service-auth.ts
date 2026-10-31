import { z } from "zod";
import {
  identityAccountResponseSchema,
  identityExchangeSchema,
  identityLogoutResponseSchema,
  identityRevokedSchema,
  identitySessionsSchema,
  identityTokensSchema,
  type IdentityTokens,
} from "../../../../packages/navigation-core/contracts-identity";
import {
  serviceOrigin,
  serviceRequest,
  ServiceClientError,
} from "../../../../packages/navigation-core/service-client";
import { api, browserTarget } from "./api";
import { getPrivateSetting, setPrivateSetting } from "./private-settings";
import { hasServiceAuthAccess } from "./service-auth-access";
import { hasBackendAccess } from "./site-access";
import {
  consentPageSchema,
  consentSchema,
  policyCatalogSchema,
} from "../../../../packages/navigation-core/contracts-authorization";
import { serviceCapabilitiesSchema } from "../../../../packages/navigation-core/contracts-service";
import {
  NAVIGATION_FAKE_CAPABILITY,
  NAVIGATION_TRANSPORT_CAPABILITY,
  NAVIGATION_EVALUATION_CAPABILITY,
  nativeReferenceKey,
  type NavigationObservation,
  type NavigationTransportInput,
  type NativeBrowserReference,
} from "../../../../packages/navigation-core/contracts-navigation";
import {
  OPERATOR_EVALUATION_LIMITS,
  operatorEvaluationPlanSchema,
  operatorEvaluationMetadataSchema,
  operatorEvaluationSha256,
  operatorEvaluationManifestSha256,
  type OperatorEvaluationPlan,
  type OperatorEvaluationTrial,
  type OperatorEvaluationBinding,
} from "../../../../packages/navigation-core/contracts-evaluation";
import {
  serviceInferenceChoicesSchema,
  type ServiceInferenceStatus,
} from "./service-auth-contract";

const inferenceSettingsSchema = z
  .object({
    accountId: z.string().uuid(),
    workspaceId: z.string().uuid(),
    profile: z.literal("fake"),
    enabled: z.boolean(),
    images: z.boolean(),
  })
  .strict()
  .refine((value) => !value.images || value.enabled);

const settingsSchema = z
  .object({
    origin: z.string().transform(serviceOrigin),
    tokens: identityTokensSchema.optional(),
    inference: inferenceSettingsSchema.optional(),
  })
  .strict();
const commandSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("AUTH_STATUS") }).strict(),
  z
    .object({ type: z.literal("AUTH_CONFIGURE"), origin: z.string().max(2048) })
    .strict(),
  z
    .object({
      type: z.literal("AUTH_SIGN_IN"),
      action: z.enum(["signin", "signup"]),
    })
    .strict(),
  z.object({ type: z.literal("AUTH_REFRESH") }).strict(),
  z
    .object({ type: z.literal("AUTH_SIGN_OUT"), all: z.boolean().optional() })
    .strict(),
  z.object({ type: z.literal("AUTH_SESSIONS") }).strict(),
  z.object({ type: z.literal("AUTH_REVOKE"), id: z.string().uuid() }).strict(),
  z.object({ type: z.literal("AUTH_INFERENCE_STATUS") }).strict(),
  z
    .object({
      type: z.literal("AUTH_EVALUATION_ACTIVATE"),
      planJson: z.string().min(1).max(OPERATOR_EVALUATION_LIMITS.maxPlanBytes),
      trialId: z.string().uuid(),
    })
    .strict(),
  z
    .object({
      type: z.literal("AUTH_INFERENCE_CONFIGURE"),
      profile: z.literal("fake"),
      enabled: z.boolean(),
      images: z.boolean(),
    })
    .strict(),
]);
let generation = 0;
let credentialsGeneration = 0;
let pending = new AbortController();
let refreshing: Promise<IdentityTokens> | undefined;
let signingIn = false;
let writes: Promise<void> = Promise.resolve();
let inferencePending = new AbortController();
let inferenceGeneration = 0;
let configuringInference: number | undefined;
let inferenceSuppressed = false;
type OperatorEvaluation = {
  plan: OperatorEvaluationPlan;
  planSha256: string;
  trial: OperatorEvaluationTrial & { arm: "structured" | "multimodal" };
  accountId: string;
  workspaceId: string;
  sessionId: string;
  origin: string;
  tabId: number;
  windowId: number;
  nextGeneration: number;
  issued?: OperatorEvaluationBinding & { native: string };
};
// Temporary operator authority belongs to this account lifecycle. It is never
// persisted, restored, or inferred from a saved development-service choice.
let evaluation: OperatorEvaluation | undefined;
let evaluationTimer: ReturnType<typeof setTimeout> | undefined;
function clearEvaluation() {
  evaluation = undefined;
  clearTimeout(evaluationTimer);
  evaluationTimer = undefined;
}
export function revokeServiceEvaluation() {
  if (!evaluation) return;
  clearEvaluation();
  inferenceSuppressed = true;
  cancelServiceInference();
}
function currentEvaluation() {
  if (evaluation && Date.now() >= evaluation.plan.expiresAtMs)
    revokeServiceEvaluation();
  return evaluation;
}
type Settings = z.infer<typeof settingsSchema>;
function persist(
  value: Settings | ((latest: Settings | undefined) => Settings | undefined),
  expected = generation,
) {
  const write = writes
    .catch(() => {})
    .then(async () => {
      if (generation !== expected)
        throw new Error("The account connection changed.");
      const next =
        typeof value === "function" ? value(await settings()) : value;
      current(expected);
      if (next) await setPrivateSetting("service-auth", next);
    });
  writes = write;
  return write;
}
function invalidate() {
  generation++;
  pending.abort();
  pending = new AbortController();
  inferenceSuppressed = true;
  clearEvaluation();
  cancelServiceInference();
}
/** Revoke a transmission span immediately without signing the account out. */
export function cancelServiceInference() {
  inferenceGeneration++;
  inferencePending.abort();
  inferencePending = new AbortController();
  configuringInference = undefined;
}
export function serviceInferenceSignal() {
  return AbortSignal.any([pending.signal, inferencePending.signal]);
}
function current(expected: number) {
  if (generation !== expected)
    throw new Error(
      "The account connection changed. Open it again to continue.",
    );
}
function clientId() {
  return browserTarget() === "firefox"
    ? "extension-firefox"
    : "extension-chromium";
}
async function settings() {
  const value = await getPrivateSetting<unknown>("service-auth");
  if (value === undefined) return;
  const parsed = settingsSchema.safeParse(value);
  if (!parsed.success)
    throw new Error(
      "The saved account connection is invalid. Save the service origin again.",
    );
  return parsed.data;
}
async function connection(expected = generation) {
  const saved = await settings();
  current(expected);
  if (!saved) throw new Error("Save a Tholi service origin before signing in.");
  if (!(await hasServiceAuthAccess(saved.origin)))
    throw new Error(
      "Account access was declined or revoked. Grant access from the Tholi sidebar.",
    );
  current(expected);
  return saved;
}
function encode(bytes: Uint8Array) {
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
function secret() {
  return encode(crypto.getRandomValues(new Uint8Array(32)));
}
async function saveTokens(
  origin: string,
  tokens: IdentityTokens,
  expected: number,
) {
  if (generation !== expected)
    throw new Error(
      "The account connection changed. Sign in again when you are ready.",
    );
  // A refresh during another request's final guard must not send its old bearer.
  credentialsGeneration++;
  await persist((latest) => {
    const inference = latest?.inference;
    return {
      origin,
      tokens,
      ...(latest?.origin === origin &&
      latest.tokens?.account.id === tokens.account.id &&
      latest.tokens.account.workspaceId === tokens.account.workspaceId &&
      inference?.accountId === tokens.account.id &&
      inference.workspaceId === tokens.account.workspaceId
        ? { inference }
        : {}),
    };
  }, expected);
  if (generation !== expected)
    throw new Error("The account connection changed.");
}
async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    const expected = generation;
    const saved = await connection(expected);
    if (!saved.tokens) throw new Error("Sign in to your Tholi account first.");
    try {
      const tokens = await serviceRequest(
        saved.origin,
        "/api/v1/auth/refresh",
        identityTokensSchema,
        {
          method: "POST",
          body: {
            clientId: clientId(),
            refreshToken: saved.tokens.refreshToken,
          },
          signal: pending.signal,
          beforeSend: async () => {
            if (!(await hasServiceAuthAccess(saved.origin)))
              throw new Error("Account permission was revoked.");
            current(expected);
          },
        },
      );
      if (
        tokens.account.id !== saved.tokens.account.id ||
        tokens.account.workspaceId !== saved.tokens.account.workspaceId ||
        tokens.sessionId !== saved.tokens.sessionId
      )
        throw new Error("The refreshed account connection changed.");
      await saveTokens(saved.origin, tokens, expected);
      return tokens;
    } catch (error) {
      // A rotation that reached the service cannot safely be retried with its old token.
      if (expected === generation) {
        invalidate();
        await persist({ origin: saved.origin });
      }
      throw error;
    }
  })().finally(() => {
    refreshing = undefined;
  });
  return refreshing;
}
export interface ServiceAccountConnection {
  origin: string;
  account: IdentityTokens["account"];
}
interface AuthorizedOptions {
  signal?: AbortSignal;
  beforeSend?: (connection: ServiceAccountConnection) => Promise<void>;
  profile?: "navigation";
  timeoutMs?: number;
}
export async function serviceAuthorizedRequest<T>(
  path:
    | `/api/v1/${string}`
    | ((account: IdentityTokens["account"]) => `/api/v1/${string}`),
  schema: z.ZodType<T>,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: unknown,
  options: AuthorizedOptions = {},
) {
  options.signal?.throwIfAborted();
  const expected = generation;
  const saved = await connection(expected);
  options.signal?.throwIfAborted();
  if (!saved.tokens) throw new Error("Sign in to your Tholi account first.");
  const tokens =
    Date.parse(saved.tokens.expiresAt) <= Date.now() + 15_000
      ? await refresh()
      : saved.tokens;
  current(expected);
  const expectedCredentials = credentialsGeneration;
  const signal = AbortSignal.any([
    pending.signal,
    ...(options.signal ? [options.signal] : []),
  ]);
  signal.throwIfAborted();
  try {
    const response = await serviceRequest(
      saved.origin,
      typeof path === "function" ? path(tokens.account) : path,
      schema,
      {
        method,
        body,
        signal,
        headers: { Authorization: `Bearer ${tokens.accessToken}` },
        ...(options.profile ? { profile: options.profile } : {}),
        ...(options.timeoutMs !== undefined
          ? { timeoutMs: options.timeoutMs }
          : {}),
        beforeSend: async () => {
          const fresh = await connection(expected);
          if (
            fresh.origin !== saved.origin ||
            fresh.tokens?.accessToken !== tokens.accessToken ||
            fresh.tokens.account.id !== tokens.account.id ||
            fresh.tokens.account.workspaceId !== tokens.account.workspaceId
          )
            throw new Error(
              "The account connection changed before transmission.",
            );
          signal.throwIfAborted();
          await options.beforeSend?.({
            origin: saved.origin,
            account: tokens.account,
          });
          current(expected);
          if (credentialsGeneration !== expectedCredentials)
            throw new Error(
              "The account credentials changed before transmission.",
            );
          signal.throwIfAborted();
        },
      },
    );
    if (expected !== generation)
      throw new Error("The account session changed.");
    return response;
  } catch (error) {
    if (
      expected === generation &&
      error instanceof ServiceClientError &&
      error.status === 401
    ) {
      invalidate();
      await persist({ origin: saved.origin });
    }
    throw error;
  }
}
async function status() {
  const expected = generation;
  const saved = await settings();
  current(expected);
  if (!saved) return { configured: false as const };
  if (!saved.tokens) return { configured: true as const, origin: saved.origin };
  const response = await serviceAuthorizedRequest(
    "/api/v1/account",
    identityAccountResponseSchema,
  );
  current(expected);
  return {
    configured: true as const,
    origin: saved.origin,
    account: response.account,
    session: response.session,
  };
}

function inferenceChoices(saved: Settings | undefined) {
  const tokens = saved?.tokens;
  const choice = saved?.inference;
  return {
    profile: "fake" as const,
    enabled: !!(
      tokens &&
      choice?.accountId === tokens.account.id &&
      choice.workspaceId === tokens.account.workspaceId &&
      choice.enabled
    ),
    images: !!(
      tokens &&
      choice?.accountId === tokens.account.id &&
      choice.workspaceId === tokens.account.workspaceId &&
      choice.enabled &&
      choice.images
    ),
  };
}

async function inferenceStatus(): Promise<ServiceInferenceStatus> {
  const expected = generation;
  const saved = await settings();
  current(expected);
  const active = currentEvaluation();
  if (active) {
    if (
      saved?.origin !== active.origin ||
      saved.tokens?.account.id !== active.accountId ||
      saved.tokens.account.workspaceId !== active.workspaceId ||
      saved.tokens.sessionId !== active.sessionId
    ) {
      revokeServiceEvaluation();
    } else {
      return {
        configured: true,
        profile: "operator-evaluation",
        enabled: true,
        images: active.trial.arm === "multimodal",
        evaluation: {
          profile: "operator-evaluation",
          planSha256: active.planSha256,
          provider: active.plan.provider,
          runtimeManifestSha256: active.plan.hashes.runtimeManifestSha256,
          expiresAtMs: active.plan.expiresAtMs,
          trialId: active.trial.id,
          arm: active.trial.arm,
        },
      };
    }
  }
  return { configured: !!saved?.tokens, ...inferenceChoices(saved) };
}

function evaluationCase(active: OperatorEvaluation) {
  return active.plan.cases.find((item) => item.id === active.trial.caseId)!;
}
async function evaluationNative(
  active: OperatorEvaluation,
  native?: NativeBrowserReference,
) {
  const tab = await api.tabs.get(active.tabId);
  const frame = await api.webNavigation.getFrame({
    tabId: active.tabId,
    frameId: 0,
  });
  const url = new URL(frame?.url || tab.url || "");
  if (
    currentEvaluation() !== active ||
    tab.windowId !== active.windowId ||
    !frame?.documentId ||
    !evaluationCase(active).scope.urls.includes(
      url.origin + url.pathname + url.search,
    ) ||
    (native &&
      (native.tabId !== active.tabId ||
        native.windowId !== active.windowId ||
        native.frameId !== 0 ||
        native.documentId !== frame.documentId))
  )
    throw new ServiceClientError(
      "FORBIDDEN",
      0,
      "This native page is outside the operator evaluation scope.",
    );
}

/** Reserve metadata only; the service ledger independently enforces every cap. */
export async function reserveServiceEvaluation(
  observation: NavigationObservation,
) {
  const active = currentEvaluation();
  if (!active)
    throw new ServiceClientError(
      "FORBIDDEN",
      0,
      "The operator evaluation is not active.",
    );
  if (
    observation.context.goal !== evaluationCase(active).goal ||
    (active.trial.arm === "multimodal") !== (observation.images.length === 1)
  )
    throw new ServiceClientError(
      "FORBIDDEN",
      0,
      "The operator trial scope or image policy changed.",
    );
  if (active.nextGeneration >= evaluationCase(active).maxGenerations)
    throw new ServiceClientError(
      "QUOTA_EXCEEDED",
      0,
      "The operator trial generation limit was reached.",
    );
  await evaluationNative(active, observation.native);
  if (currentEvaluation() !== active)
    throw new ServiceClientError(
      "CANCELLED",
      0,
      "The operator evaluation ended.",
    );
  if (active.nextGeneration >= evaluationCase(active).maxGenerations)
    throw new ServiceClientError(
      "QUOTA_EXCEEDED",
      0,
      "The operator trial generation limit was reached.",
    );
  const binding: OperatorEvaluationBinding = {
    planSha256: active.planSha256,
    trialId: active.trial.id,
    generation: active.nextGeneration++ as 0 | 1,
  };
  active.issued = {
    ...binding,
    native: nativeReferenceKey(observation.native),
  };
  return { ...binding, provider: active.plan.provider, arm: active.trial.arm };
}
export function serviceEvaluationHasGeneration() {
  const active = currentEvaluation();
  return (
    !!active && active.nextGeneration < evaluationCase(active).maxGenerations
  );
}

export function serviceInferenceCurrent(request: NavigationTransportInput) {
  const active = currentEvaluation();
  if (request.profile === "fake") {
    if (!active) return;
  } else if (
    active &&
    active.issued &&
    active.issued.planSha256 === request.evaluation.planSha256 &&
    active.issued.trialId === request.evaluation.trialId &&
    active.issued.generation === request.evaluation.generation &&
    active.issued.native === nativeReferenceKey(request.observation.native) &&
    request.observation.context.goal === evaluationCase(active).goal &&
    (active.trial.arm === "multimodal") ===
      (request.observation.images.length === 1)
  )
    return;
  throw new ServiceClientError(
    "FORBIDDEN",
    0,
    "The operator evaluation binding is no longer current.",
  );
}

/** Background metadata only. The returned binding never includes credentials. */
export async function serviceInferenceAccess(
  images: boolean,
  request?: NavigationTransportInput,
) {
  const expected = generation;
  const expectedInference = inferenceGeneration;
  const saved = await connection(expected);
  if (!saved.tokens) throw new Error("Sign in to your Tholi account first.");
  const active = currentEvaluation();
  if (request) serviceInferenceCurrent(request);
  else if (active)
    throw new ServiceClientError(
      "FORBIDDEN",
      0,
      "Operator evaluation requires an explicit request binding.",
    );
  const choices = active
    ? {
        profile: "operator-evaluation" as const,
        enabled: true,
        images: active.trial.arm === "multimodal",
      }
    : inferenceChoices(saved);
  if (
    inferenceSuppressed ||
    configuringInference !== undefined ||
    !choices.enabled ||
    (images && !choices.images)
  )
    throw new ServiceClientError(
      "FORBIDDEN",
      0,
      "Enable the matching inference and image transmission choices in the sidebar.",
    );
  if (!(await hasBackendAccess(saved.origin)))
    throw new ServiceClientError(
      "FORBIDDEN",
      0,
      "Inference transmission permission was declined or revoked.",
    );
  current(expected);
  if (active) {
    if (
      saved.tokens.account.id !== active.accountId ||
      saved.tokens.account.workspaceId !== active.workspaceId ||
      saved.tokens.sessionId !== active.sessionId ||
      saved.origin !== active.origin
    )
      throw new ServiceClientError(
        "FORBIDDEN",
        0,
        "The operator account binding changed.",
      );
    await evaluationNative(active, request!.observation.native);
    serviceInferenceCurrent(request!);
  }
  if (
    expectedInference !== inferenceGeneration ||
    configuringInference !== undefined
  )
    throw new Error("Inference transmission choices changed.");
  return {
    origin: saved.origin,
    account: saved.tokens.account,
    ...choices,
  };
}

function requireFakeInferenceProfile(
  capabilities: z.infer<typeof serviceCapabilitiesSchema>,
) {
  if (
    !capabilities.availability.decisions ||
    !capabilities.capabilities.includes(NAVIGATION_TRANSPORT_CAPABILITY) ||
    !capabilities.capabilities.includes(NAVIGATION_FAKE_CAPABILITY)
  )
    throw new ServiceClientError(
      "UNAVAILABLE",
      0,
      "This service does not offer the development fake inference profile.",
    );
}

async function readInferenceConsents(
  connected: ServiceAccountConnection,
  signal: AbortSignal,
  beforeSend: NonNullable<AuthorizedOptions["beforeSend"]>,
) {
  const policies = await serviceAuthorizedRequest(
    (account) => `/api/v1/workspaces/${account.workspaceId}/policies`,
    policyCatalogSchema,
    "GET",
    undefined,
    { signal, beforeSend },
  );
  const consents = await serviceAuthorizedRequest(
    (account) => `/api/v1/workspaces/${account.workspaceId}/consents`,
    consentPageSchema,
    "GET",
    undefined,
    { signal, beforeSend },
  );
  if (policies.workspaceId !== connected.account.workspaceId)
    throw new ServiceClientError(
      "INVALID_RESPONSE",
      0,
      "The service policy workspace changed.",
    );
  return { policies, consents };
}

export async function serviceInferencePreflight(
  images: boolean,
  signal: AbortSignal,
  request?: NavigationTransportInput,
) {
  signal.throwIfAborted();
  const binding = await serviceInferenceAccess(images, request);
  const guard = async (connected: ServiceAccountConnection) => {
    const fresh = await serviceInferenceAccess(images, request);
    signal.throwIfAborted();
    if (
      connected.origin !== binding.origin ||
      fresh.origin !== binding.origin ||
      connected.account.id !== binding.account.id ||
      fresh.account.id !== binding.account.id ||
      connected.account.workspaceId !== binding.account.workspaceId ||
      fresh.account.workspaceId !== binding.account.workspaceId
    )
      throw new Error("The inference account connection changed.");
  };
  const capabilities = await serviceAuthorizedRequest(
    "/api/v1/capabilities",
    serviceCapabilitiesSchema,
    "GET",
    undefined,
    { signal, beforeSend: guard },
  );
  if (request?.profile === "operator-evaluation") {
    const active = currentEvaluation();
    if (!active)
      throw new ServiceClientError(
        "FORBIDDEN",
        0,
        "The operator evaluation ended.",
      );
    requireEvaluationCapability(capabilities, active);
  } else requireFakeInferenceProfile(capabilities);
  const { policies, consents } = await readInferenceConsents(
    binding,
    signal,
    guard,
  );
  signal.throwIfAborted();
  requireInferenceConsents(policies, consents, images);
  return binding;
}

function requireInferenceConsents(
  policies: z.infer<typeof policyCatalogSchema>,
  consents: z.infer<typeof consentPageSchema>,
  images: boolean,
) {
  for (const purpose of images
    ? ["cloud_inference", "image_transmission"]
    : ["cloud_inference"]) {
    const policy = policies.consentPolicies.find(
      (item) => item.purpose === purpose,
    );
    if (
      !policy ||
      !consents.items.some(
        (item) =>
          item.purpose === purpose &&
          item.policyVersion === policy.policyVersion &&
          item.granted,
      )
    )
      throw new ServiceClientError(
        "FORBIDDEN",
        0,
        "Current service consent is required before inference transmission.",
      );
  }
}

function requireEvaluationCapability(
  capabilities: z.infer<typeof serviceCapabilitiesSchema>,
  active: Pick<OperatorEvaluation, "plan" | "planSha256">,
) {
  const metadata = operatorEvaluationMetadataSchema.safeParse(
    capabilities.evaluation,
  );
  if (
    !capabilities.availability.decisions ||
    !capabilities.capabilities.includes(NAVIGATION_TRANSPORT_CAPABILITY) ||
    !capabilities.capabilities.includes(NAVIGATION_EVALUATION_CAPABILITY) ||
    !metadata.success ||
    metadata.data.planSha256 !== active.planSha256 ||
    metadata.data.provider !== active.plan.provider ||
    metadata.data.runtimeManifestSha256 !==
      active.plan.hashes.runtimeManifestSha256 ||
    metadata.data.expiresAtMs !== active.plan.expiresAtMs ||
    Date.now() >= metadata.data.expiresAtMs
  )
    throw new ServiceClientError(
      "FORBIDDEN",
      0,
      "The service does not admit this exact operator evaluation.",
    );
}

async function activateEvaluation(planJson: string, trialId: string) {
  cancelServiceInference();
  clearEvaluation();
  inferenceSuppressed = true;
  const expected = generation,
    operation = inferenceGeneration;
  const signal = serviceInferenceSignal();
  const check = () => {
    current(expected);
    signal.throwIfAborted();
    if (operation !== inferenceGeneration)
      throw new Error("The operator activation changed.");
  };
  if (
    new TextEncoder().encode(planJson).byteLength >
    OPERATOR_EVALUATION_LIMITS.maxPlanBytes
  )
    throw new Error("The operator declaration is too large.");
  const plan = operatorEvaluationPlanSchema.parse(JSON.parse(planJson));
  const trial = plan.trials.find((item) => item.id === trialId);
  if (
    !trial ||
    trial.arm === "local" ||
    Date.now() < plan.createdAtMs ||
    Date.now() >= plan.expiresAtMs
  )
    throw new Error("A current declared provider trial is required.");
  const planSha256 = await operatorEvaluationSha256(planJson);
  const actualManifest = await operatorEvaluationManifestSha256(
    api.runtime.getManifest(),
  );
  check();
  if (actualManifest !== plan.hashes.runtimeManifestSha256)
    throw new Error(
      "The installed manifest differs from the operator declaration.",
    );
  const saved = await connection(expected);
  check();
  if (!saved.tokens || !(await hasBackendAccess(saved.origin)))
    throw new Error(
      "Current account and transmission permission are required.",
    );
  check();
  if (
    clientId() !== plan.operator.clientId ||
    saved.tokens.account.id !== plan.operator.accountId ||
    saved.tokens.account.workspaceId !== plan.operator.workspaceId
  )
    throw new Error(
      "The signed-in operator differs from the declared account, workspace or browser client.",
    );
  // A service-worker restart or failed activation must return to Local, rather
  // than revive a previously saved fake-profile transmission choice.
  await persist((latest) => {
    check();
    if (!latest) return;
    const { inference: _previous, ...rest } = latest;
    return rest;
  }, expected);
  check();
  const guarded = async (connected: ServiceAccountConnection) => {
    check();
    if (
      connected.origin !== saved.origin ||
      connected.account.id !== saved.tokens!.account.id ||
      connected.account.workspaceId !== saved.tokens!.account.workspaceId
    )
      throw new Error("The operator account changed.");
  };
  const account = await serviceAuthorizedRequest(
    "/api/v1/account",
    identityAccountResponseSchema,
    "GET",
    undefined,
    { signal, beforeSend: guarded },
  );
  check();
  if (
    account.account.id !== saved.tokens.account.id ||
    account.account.workspaceId !== saved.tokens.account.workspaceId ||
    account.session.id !== saved.tokens.sessionId ||
    account.session.clientId !== plan.operator.clientId ||
    account.session.clientKind !== "extension"
  )
    throw new Error("The operator session changed.");
  const capabilities = await serviceAuthorizedRequest(
    "/api/v1/capabilities",
    serviceCapabilitiesSchema,
    "GET",
    undefined,
    { signal, beforeSend: guarded },
  );
  check();
  requireEvaluationCapability(capabilities, { plan, planSha256 });
  const { policies, consents } = await readInferenceConsents(
    { origin: saved.origin, account: saved.tokens.account },
    signal,
    guarded,
  );
  check();
  requireInferenceConsents(policies, consents, trial.arm === "multimodal");
  const [tab] = await api.tabs.query({ active: true, lastFocusedWindow: true });
  check();
  if (tab?.id === undefined || tab.windowId === undefined)
    throw new Error("An active declared browser page is required.");
  const active: OperatorEvaluation = {
    plan,
    planSha256,
    trial: { ...trial, arm: trial.arm },
    origin: saved.origin,
    accountId: saved.tokens.account.id,
    workspaceId: saved.tokens.account.workspaceId,
    sessionId: saved.tokens.sessionId,
    tabId: tab.id,
    windowId: tab.windowId,
    nextGeneration: 0,
  };
  evaluation = active;
  try {
    await evaluationNative(active);
    check();
  } catch (error) {
    if (evaluation === active) clearEvaluation();
    throw error;
  }
  inferenceSuppressed = false;
  evaluationTimer = setTimeout(
    revokeServiceEvaluation,
    Math.max(1, plan.expiresAtMs - Date.now()),
  );
  return inferenceStatus();
}

async function configureInference(
  raw: unknown,
): Promise<ServiceInferenceStatus> {
  const choices = serviceInferenceChoicesSchema.parse(raw);
  // Fence immediately, before any private storage or service await.
  cancelServiceInference();
  clearEvaluation();
  inferenceSuppressed = true;
  const operation = inferenceGeneration;
  configuringInference = operation;
  const expected = generation;
  const signal = serviceInferenceSignal();
  const check = () => {
    current(expected);
    signal.throwIfAborted();
    if (inferenceGeneration !== operation)
      throw new Error("Inference transmission choices changed.");
  };
  try {
    // A failed or offline enable attempt never leaves the former choice enabled.
    const saved = await settings();
    check();
    if (!saved) {
      if (choices.enabled)
        throw new Error("Configure and sign in to a Tholi service first.");
      return {
        configured: false,
        profile: "fake",
        enabled: false,
        images: false,
        serverConsentUpdated: false,
      };
    }
    await persist((latest) => {
      check();
      if (!latest || latest.origin !== saved.origin)
        throw new Error("The account connection changed.");
      const { inference: _previous, ...rest } = latest;
      return rest;
    }, expected);
    check();
    if (!saved.tokens) {
      if (choices.enabled)
        throw new Error("Sign in to your Tholi account first.");
      return {
        configured: false,
        profile: "fake",
        enabled: false,
        images: false,
        serverConsentUpdated: false,
      };
    }
    const account = saved.tokens.account;
    const guarded = async (connected: ServiceAccountConnection) => {
      check();
      if (
        connected.origin !== saved.origin ||
        connected.account.id !== account.id ||
        connected.account.workspaceId !== account.workspaceId
      )
        throw new Error("The account connection changed.");
    };
    try {
      if (choices.enabled) {
        if (!(await hasBackendAccess(saved.origin)))
          throw new Error(
            "Grant inference transmission access before enabling it.",
          );
        check();
        const capabilities = await serviceAuthorizedRequest(
          "/api/v1/capabilities",
          serviceCapabilitiesSchema,
          "GET",
          undefined,
          { signal, beforeSend: guarded },
        );
        check();
        requireFakeInferenceProfile(capabilities);
      }
      const path = (suffix: "policies" | "consents") =>
        `/api/v1/workspaces/${account.workspaceId}/${suffix}` as const;
      const { policies, consents } = await readInferenceConsents(
        { origin: saved.origin, account },
        signal,
        guarded,
      );
      check();
      for (const purpose of [
        "cloud_inference",
        "image_transmission",
      ] as const) {
        const policy = policies.consentPolicies.find(
          (item) => item.purpose === purpose,
        );
        if (!policy)
          throw new Error(
            "The service inference consent policy is unavailable.",
          );
        const granted =
          purpose === "cloud_inference" ? choices.enabled : choices.images;
        const previous = consents.items.find(
          (item) => item.purpose === purpose,
        );
        if (
          previous?.granted === granted &&
          previous.policyVersion === policy.policyVersion
        )
          continue;
        const recorded = await serviceAuthorizedRequest(
          path("consents"),
          consentSchema,
          "POST",
          {
            purpose,
            policyVersion: policy.policyVersion,
            granted,
            expectedRevision: previous?.revision ?? "0",
          },
          { signal, beforeSend: guarded },
        );
        check();
        if (
          recorded.purpose !== purpose ||
          recorded.policyVersion !== policy.policyVersion ||
          recorded.granted !== granted
        )
          throw new ServiceClientError(
            "INVALID_RESPONSE",
            0,
            "The service consent response could not be verified.",
          );
      }
      if (choices.enabled) {
        await persist((latest) => {
          check();
          if (
            !latest?.tokens ||
            latest.origin !== saved.origin ||
            latest.tokens.account.id !== account.id ||
            latest.tokens.account.workspaceId !== account.workspaceId
          )
            throw new Error("The account connection changed.");
          return {
            ...latest,
            inference: {
              ...choices,
              accountId: account.id,
              workspaceId: account.workspaceId,
            },
          };
        }, expected);
        check();
        inferenceSuppressed = false;
      }
      return { configured: true, ...choices, serverConsentUpdated: true };
    } catch (error) {
      // Local disable succeeds even when account-wide withdrawal is unavailable.
      // The UI must distinguish this from confirmed service consent withdrawal.
      if (
        !choices.enabled &&
        expected === generation &&
        operation === inferenceGeneration
      )
        return {
          configured: true,
          profile: "fake",
          enabled: false,
          images: false,
          serverConsentUpdated: false,
        };
      throw error;
    }
  } finally {
    if (configuringInference === operation) configuringInference = undefined;
  }
}
async function signIn(action: "signin" | "signup") {
  if (signingIn) throw new Error("A sign-in window is already open.");
  signingIn = true;
  try {
    const saved = await connection();
    invalidate();
    const expected = generation;
    // Clear the previous account before switching. Local journey and memory owners are untouched.
    await persist({ origin: saved.origin });
    const redirectUri = api.identity.getRedirectURL();
    const state = secret(),
      codeVerifier = secret();
    const codeChallenge = encode(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(codeVerifier),
        ),
      ),
    );
    const url = new URL("/api/v1/auth/authorize", saved.origin);
    url.search = new URLSearchParams({
      clientId: clientId(),
      action,
      destination: "client",
      redirectUri,
      state,
      codeChallenge,
    }).toString();
    const returned = await api.identity.launchWebAuthFlow({
      url: url.href,
      interactive: true,
    });
    const callback = new URL(returned),
      registered = new URL(redirectUri);
    const keys = [...callback.searchParams.keys()];
    if (
      callback.origin !== registered.origin ||
      callback.pathname !== registered.pathname ||
      callback.hash ||
      callback.username ||
      callback.password ||
      callback.searchParams.get("state") !== state ||
      keys.length !== 2 ||
      keys.some((key) => key !== "code" && key !== "state")
    )
      throw new Error("The sign-in response could not be verified.");
    if (expected !== generation)
      throw new Error("The account connection changed during sign-in.");
    const body = identityExchangeSchema.parse({
      code: callback.searchParams.get("code"),
      clientId: clientId(),
      redirectUri,
      codeVerifier,
    });
    if (!(await hasServiceAuthAccess(saved.origin)))
      throw new Error("Account permission was revoked during sign-in.");
    current(expected);
    const tokens = await serviceRequest(
      saved.origin,
      "/api/v1/auth/exchange",
      identityTokensSchema,
      { method: "POST", body, signal: pending.signal },
    );
    await saveTokens(saved.origin, tokens, expected);
    return status();
  } finally {
    signingIn = false;
  }
}

/** Called only after the message router has verified the exact privileged panel sender. */
export async function serviceAuthCommand(raw: unknown): Promise<unknown> {
  const command = commandSchema.parse(raw);
  if (
    ["AUTH_CONFIGURE", "AUTH_SIGN_IN", "AUTH_SIGN_OUT", "AUTH_REVOKE"].includes(
      command.type,
    )
  ) {
    inferenceSuppressed = true;
    clearEvaluation();
    cancelServiceInference();
    const expected = generation;
    await persist((latest) => {
      if (!latest) return;
      const { inference: _previous, ...rest } = latest;
      return rest;
    }, expected);
  }
  switch (command.type) {
    case "AUTH_STATUS":
      return status();
    case "AUTH_INFERENCE_STATUS":
      return inferenceStatus();
    case "AUTH_INFERENCE_CONFIGURE":
      return configureInference({
        profile: command.profile,
        enabled: command.enabled,
        images: command.images,
      });
    case "AUTH_EVALUATION_ACTIVATE":
      return activateEvaluation(command.planJson, command.trialId);
    case "AUTH_CONFIGURE": {
      const origin = serviceOrigin(command.origin);
      if (!(await hasServiceAuthAccess(origin)))
        throw new Error(
          "Grant account access before saving this service origin.",
        );
      invalidate();
      await persist({ origin });
      return status();
    }
    case "AUTH_SIGN_IN":
      return signIn(command.action);
    case "AUTH_REFRESH":
      await refresh();
      return status();
    case "AUTH_SESSIONS":
      return serviceAuthorizedRequest(
        "/api/v1/account/sessions",
        identitySessionsSchema,
      );
    case "AUTH_REVOKE": {
      const expected = generation;
      await serviceAuthorizedRequest(
        `/api/v1/account/sessions/${command.id}`,
        identityRevokedSchema,
        "DELETE",
      );
      const saved = await settings();
      current(expected);
      if (saved?.tokens?.sessionId === command.id) {
        invalidate();
        await persist({ origin: saved.origin });
      }
      return { revoked: true };
    }
    case "AUTH_SIGN_OUT": {
      const expected = generation;
      await serviceAuthorizedRequest(
        "/api/v1/auth/logout",
        identityLogoutResponseSchema,
        "POST",
        { all: command.all ?? false },
      );
      const saved = await settings();
      current(expected);
      invalidate();
      if (saved) await persist({ origin: saved.origin });
      return status();
    }
  }
}
