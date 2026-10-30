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

const settingsSchema = z
  .object({
    origin: z.string().transform(serviceOrigin),
    tokens: identityTokensSchema.optional(),
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
]);
let generation = 0;
let pending = new AbortController();
let refreshing: Promise<IdentityTokens> | undefined;
let signingIn = false;
let writes: Promise<void> = Promise.resolve();
function persist(value: z.infer<typeof settingsSchema>, expected = generation) {
  const write = writes
    .catch(() => {})
    .then(async () => {
      if (generation !== expected)
        throw new Error("The account connection changed.");
      await setPrivateSetting("service-auth", value);
    });
  writes = write;
  return write;
}
function invalidate() {
  generation++;
  pending.abort();
  pending = new AbortController();
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
  await persist({ origin, tokens }, expected);
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
        },
      );
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
async function authorized<T>(
  path: `/api/v1/${string}`,
  schema: z.ZodType<T>,
  method: "GET" | "POST" | "DELETE" = "GET",
  body?: unknown,
) {
  const expected = generation;
  const saved = await connection(expected);
  if (!saved.tokens) throw new Error("Sign in to your Tholi account first.");
  const tokens =
    Date.parse(saved.tokens.expiresAt) <= Date.now() + 15_000
      ? await refresh()
      : saved.tokens;
  current(expected);
  try {
    const response = await serviceRequest(saved.origin, path, schema, {
      method,
      body,
      signal: pending.signal,
      headers: { Authorization: `Bearer ${tokens.accessToken}` },
    });
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
  const response = await authorized(
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
  switch (command.type) {
    case "AUTH_STATUS":
      return status();
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
      return authorized("/api/v1/account/sessions", identitySessionsSchema);
    case "AUTH_REVOKE": {
      const expected = generation;
      await authorized(
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
      await authorized(
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
