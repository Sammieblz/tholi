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
} from "../../../../packages/navigation-core/contracts-navigation";
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
  return { configured: !!saved?.tokens, ...inferenceChoices(saved) };
}

/** Background metadata only. The returned binding never includes credentials. */
export async function serviceInferenceAccess(images: boolean) {
  const expected = generation;
  const expectedInference = inferenceGeneration;
  const saved = await connection(expected);
  if (!saved.tokens) throw new Error("Sign in to your Tholi account first.");
  const choices = inferenceChoices(saved);
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
) {
  signal.throwIfAborted();
  const binding = await serviceInferenceAccess(images);
  const guard = async (connected: ServiceAccountConnection) => {
    const fresh = await serviceInferenceAccess(images);
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
  requireFakeInferenceProfile(capabilities);
  const { policies, consents } = await readInferenceConsents(
    binding,
    signal,
    guard,
  );
  signal.throwIfAborted();
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
  return binding;
}

async function configureInference(
  raw: unknown,
): Promise<ServiceInferenceStatus> {
  const choices = serviceInferenceChoicesSchema.parse(raw);
  // Fence immediately, before any private storage or service await.
  cancelServiceInference();
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
