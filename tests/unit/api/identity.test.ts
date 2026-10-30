import { randomBytes, randomUUID, createHash } from "node:crypto";
import { beforeAll, describe, expect, it, vi, afterEach } from "vitest";
import { exportJWK, generateKeyPair, SignJWT, type JWTPayload } from "jose";
import { createOidcProvider } from "../../../apps/api/src/adapters/oidc";
import {
  IdentityService,
  identityHash,
} from "../../../apps/api/src/application/identity";
import type {
  IdentityBroker,
  IdentityFlow,
  IdentityOptions,
  IdentityProvider,
  IdentitySession,
  IdentityStore,
} from "../../../apps/api/src/application/identity-contracts";
import { createHttpApi } from "../../../apps/api/src/http";
import { registerServiceApi } from "../../../apps/api/src/routes/service";
import { registerIdentityApi } from "../../../apps/api/src/routes/identity";
import {
  identityAccountResponseSchema,
  identityTokensSchema,
} from "../../../packages/navigation-core/contracts-identity";

const options: IdentityOptions = {
  issuer: "https://identity.example.test/realms/tholi",
  authorizationEndpoint:
    "https://identity.example.test/realms/tholi/protocol/openid-connect/auth",
  tokenEndpoint:
    "https://identity.example.test/realms/tholi/protocol/openid-connect/token",
  jwksUri:
    "https://identity.example.test/realms/tholi/protocol/openid-connect/certs",
  endSessionEndpoint:
    "https://identity.example.test/realms/tholi/protocol/openid-connect/logout",
  clientId: "tholi-broker",
  clientSecret: "synthetic-provider-secret",
  callbackUrl: "https://api.example.test/api/v1/auth/callback",
  webOrigin: "https://web.example.test",
  clients: [
    {
      id: "web",
      kind: "web",
      redirectUris: [
        "https://web.example.test/account",
        "https://web.example.test/download",
      ],
    },
    {
      id: "extension-chromium",
      kind: "extension",
      redirectUris: [
        "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/tholi",
      ],
    },
  ],
  flowEncryptionKey: randomBytes(32).toString("base64url"),
  secureCookies: true,
  requireVerifiedEmail: true,
  accessLifetimeMs: 15 * 60_000,
  sessionLifetimeMs: 24 * 60 * 60_000,
};
const context = () => ({
  requestId: randomUUID(),
  deadlineAt: Date.now() + 25_000,
  signal: new AbortController().signal,
});
let first: Awaited<ReturnType<typeof generateKeyPair>>,
  second: Awaited<ReturnType<typeof generateKeyPair>>;
beforeAll(async () => {
  [first, second] = await Promise.all([
    generateKeyPair("RS256"),
    generateKeyPair("RS256"),
  ]);
}, 20_000);
afterEach(() => vi.restoreAllMocks());
const nonce = "synthetic-login-nonce";
async function signed(overrides: JWTPayload = {}, pair = first, kid = "first") {
  return new SignJWT({
    sub: "provider-user",
    nonce,
    email_verified: true,
    sid: "provider-session",
    ...overrides,
  })
    .setProtectedHeader({ alg: "RS256", kid })
    .setIssuer(String(overrides.iss ?? options.issuer))
    .setAudience(overrides.aud ?? options.clientId)
    .setIssuedAt(overrides.iat ?? Math.floor(Date.now() / 1000))
    .setExpirationTime(overrides.exp ?? Math.floor(Date.now() / 1000) + 300)
    .sign(pair.privateKey);
}
async function transport(token: string) {
  let jwks = {
    keys: [
      {
        ...(await exportJWK(first.publicKey)),
        kid: "first",
        alg: "RS256",
        use: "sig",
      },
    ],
  };
  const fetcher = vi.fn<typeof fetch>(async (url) => {
    if (String(url) === options.jwksUri) return Response.json(jwks);
    if (String(url) === options.tokenEndpoint)
      return Response.json({
        id_token: token,
        access_token: "UPSTREAM_ACCESS_SENTINEL",
        refresh_token: "UPSTREAM_REFRESH_SENTINEL",
      });
    throw Error("Unexpected destination");
  });
  return {
    fetcher,
    provider: createOidcProvider(options, fetcher),
    rotate: async () => {
      jwks = {
        keys: [
          {
            ...(await exportJWK(second.publicKey)),
            kid: "second",
            alg: "RS256",
            use: "sig",
          },
        ],
      };
    },
  };
}
const exchangeInput = () => ({
  code: "synthetic-provider-code",
  verifier: "synthetic-provider-verifier",
  nonceHash: identityHash(nonce),
  context: context(),
});

describe("trusted OIDC provider verification", () => {
  it("verifies a signed ID token, sends bound code/PKCE proof and discards upstream credentials", async () => {
    const { provider, fetcher } = await transport(await signed());
    const result = await provider.exchange(exchangeInput());
    expect(result).toEqual({
      issuer: options.issuer,
      subject: "provider-user",
      providerSessionId: "provider-session",
      issuedAt: expect.any(Date),
    });
    expect(JSON.stringify(result)).not.toMatch(
      /UPSTREAM|access_token|refresh_token/,
    );
    const request = fetcher.mock.calls.find(
      ([url]) => url === options.tokenEndpoint,
    )![1]!;
    expect(String(request.body)).toContain(
      "code_verifier=synthetic-provider-verifier",
    );
    expect(String(request.body)).toContain(
      "redirect_uri=" + encodeURIComponent(options.callbackUrl),
    );
    expect(new Headers(request.headers).get("authorization")).toBe(
      "Basic " +
        Buffer.from(options.clientId + ":" + options.clientSecret).toString(
          "base64",
        ),
    );
    const authorize = new URL(
      provider.authorize({
        state: "state",
        nonce,
        codeChallenge: "challenge",
        action: "signup",
      }),
    );
    expect(Object.fromEntries(authorize.searchParams)).toMatchObject({
      response_type: "code",
      code_challenge_method: "S256",
      nonce,
      state: "state",
      prompt: "create",
    });
    expect(authorize.searchParams.get("scope")).not.toContain("offline_access");
    expect(
      new URL(
        provider.authorize({
          state: "state",
          nonce,
          codeChallenge: "challenge",
          action: "recover",
        }),
      ).pathname.endsWith("/forgot-credentials"),
    ).toBe(true);
  });
  it.each([
    ["issuer", { iss: "https://untrusted.example.test" }],
    ["audience", { aud: "another-client" }],
    ["expiry", { exp: Math.floor(Date.now() / 1000) - 60 }],
    ["future issue time", { iat: Math.floor(Date.now() / 1000) + 60 }],
    ["nonce", { nonce: "another-browser" }],
    ["verification", { email_verified: false }],
    ["authorized party", { azp: "another-client" }],
    [
      "multiple audiences without authorized party",
      { aud: [options.clientId, "another-audience"] },
    ],
    [
      "additional untrusted audience with correct authorized party",
      { aud: [options.clientId, "another-audience"], azp: options.clientId },
    ],
  ] as [string, JWTPayload][])(
    "rejects incorrect %s without exposing provider secrets",
    async (_label, claims) => {
      const { provider } = await transport(await signed({ ...claims }));
      await expect(provider.exchange(exchangeInput())).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
        message: "The identity provider response could not be verified.",
      });
    },
  );
  it("rejects disallowed algorithms and unknown keys", async () => {
    const hmac = await new SignJWT({ nonce })
      .setProtectedHeader({ alg: "HS256" })
      .setIssuer(options.issuer)
      .setAudience(options.clientId)
      .setIssuedAt()
      .setExpirationTime("5m")
      .sign(randomBytes(32));
    for (const token of [
      hmac,
      await signed({}, second, "unknown"),
      await signed({}, second, "first"),
    ]) {
      const { provider } = await transport(token);
      await expect(provider.exchange(exchangeInput())).rejects.toMatchObject({
        code: "UNAUTHENTICATED",
      });
    }
  });
  it("refreshes issuer-bound keys after the bounded cooldown for real key rotation", async () => {
    const initial = await signed(),
      rotated = await signed({}, second, "second"),
      network = await transport(initial);
    await network.provider.exchange(exchangeInput());
    await network.rotate();
    let current = initial;
    const base = network.fetcher.getMockImplementation()!;
    network.fetcher.mockImplementation(async (url, init) =>
      String(url) === options.tokenEndpoint
        ? Response.json({ id_token: current })
        : base(url, init),
    );
    current = rotated;
    await expect(
      network.provider.exchange(exchangeInput()),
    ).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    const time = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(time + 6000);
    await expect(
      network.provider.exchange(exchangeInput()),
    ).resolves.toMatchObject({ subject: "provider-user" });
    expect(
      network.fetcher.mock.calls.filter(([url]) => url === options.jwksUri),
    ).toHaveLength(2);
  });
  it("validates signed logout events and rejects login tokens, nonce and missing target", async () => {
    const event = { "http://schemas.openid.net/event/backchannel-logout": {} };
    for (const [claims, valid] of [
      [{ events: event, jti: "logout-event", nonce: undefined }, true],
      [{ events: event, jti: "logout-event" }, false],
      [{ events: {}, jti: "logout-event", nonce: undefined }, false],
      [
        {
          events: event,
          jti: "logout-event",
          nonce: undefined,
          sub: undefined,
          sid: undefined,
        },
        false,
      ],
    ] as const) {
      const token = await signed({ ...claims }),
        { provider } = await transport(token);
      const result = provider.verifyLogout(token, context());
      if (valid)
        await expect(result).resolves.toMatchObject({
          eventId: "logout-event",
          providerSessionId: "provider-session",
          issuedAt: expect.any(Date),
        });
      else
        await expect(result).rejects.toMatchObject({ code: "UNAUTHENTICATED" });
    }
  });
  it("bounds provider responses and honors cancellation before contacting the provider", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response("x".repeat(65537)),
    );
    const provider = createOidcProvider(options, fetcher);
    await expect(provider.exchange(exchangeInput())).rejects.toMatchObject({
      code: "UNAUTHENTICATED",
    });
    const controller = new AbortController();
    controller.abort(Error("cancelled"));
    await expect(
      provider.exchange({
        ...exchangeInput(),
        context: { ...context(), signal: controller.signal },
      }),
    ).rejects.toThrow("cancelled");
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});

function memoryStore() {
  const flows = new Map<string, IdentityFlow>(),
    brokers = new Map<string, IdentityBroker>(),
    sessions = new Map<string, IdentitySession>();
  const account = {
    identityId: randomUUID(),
    accountId: randomUUID(),
    workspaceId: randomUUID(),
    revision: "1",
  };
  const store: IdentityStore = {
    createFlow: vi.fn(async (flow) => {
      flows.set(flow.stateHash, structuredClone(flow));
    }),
    consumeFlow: vi.fn(async (hash, binding, now) => {
      const flow = flows.get(hash);
      if (!flow || flow.browserBindingHash !== binding || flow.expiresAt <= now)
        return null;
      flows.delete(hash);
      return flow;
    }),
    resolveIdentity: vi.fn(async () => account),
    createBroker: vi.fn(async (broker) => {
      brokers.set(broker.codeHash, structuredClone(broker));
    }),
    consumeBroker: vi.fn(async (hash, client, redirect, proof, now) => {
      const broker = brokers.get(hash);
      if (
        !broker ||
        broker.clientId !== client ||
        broker.redirectUri !== redirect ||
        broker.codeChallenge !== proof ||
        broker.expiresAt <= now
      )
        return null;
      brokers.delete(hash);
      return broker;
    }),
    createSession: vi.fn(async (session) => {
      sessions.set(session.id, structuredClone(session));
    }),
    authenticateSession: vi.fn(
      async (hash, now) =>
        [...sessions.values()].find(
          (session) =>
            session.accessHash === hash &&
            session.accessExpiresAt > now &&
            session.expiresAt > now,
        ) ?? null,
    ),
    rotateSession: vi.fn(async () => ({ status: "invalid" as const })),
    listSessions: vi.fn(async (id) =>
      [...sessions.values()].filter((session) => session.accountId === id),
    ),
    revokeSession: vi.fn(
      async (id, sessionId) =>
        sessions.get(sessionId)?.accountId === id && sessions.delete(sessionId),
    ),
    revokeAllSessions: vi.fn(async () => {
      sessions.clear();
    }),
    revokeProviderSessions: vi.fn(async () => {}),
  };
  return { store, flows, brokers, sessions };
}
async function application(
  secureCookies = false,
  configuredProvider?: IdentityProvider,
) {
  const state = memoryStore();
  const provider: IdentityProvider = {
    authorize: ({ state, nonce }) =>
      options.authorizationEndpoint +
      "?" +
      new URLSearchParams({ state, nonce }),
    exchange: async () => ({
      issuer: options.issuer,
      subject: "provider-user",
      providerSessionId: "provider-session",
      issuedAt: new Date(),
    }),
    verifyLogout: vi.fn(),
    logoutUrl: () => options.endSessionEndpoint,
  };
  const service = new IdentityService(
    { ...options, secureCookies },
    state.store,
    configuredProvider ?? provider,
  );
  const api = await createHttpApi("service", [], async (app) => {
    await registerServiceApi(app);
    await registerIdentityApi(app, service);
  });
  await api.ready();
  return { ...state, api, service };
}
function cookiePairs(header: string | string[] | undefined) {
  return (Array.isArray(header) ? header : header ? [header] : [])
    .map((value) => value.split(";")[0])
    .join("; ");
}

describe("identity application and HTTP delivery", () => {
  it("accepts a real signed provider logout form and rejects duplicated or forged proof", async () => {
    const claims = {
      nonce: undefined,
      jti: "provider-logout-event",
      events: { "http://schemas.openid.net/event/backchannel-logout": {} },
    };
    const token = await signed(claims),
      network = await transport(token),
      app = await application(false, network.provider);
    try {
      const send = (body: string) =>
        app.api.inject({
          method: "POST",
          url: "/api/v1/auth/backchannel-logout",
          headers: { "content-type": "application/x-www-form-urlencoded" },
          payload: body,
        });
      const body = new URLSearchParams({ logout_token: token }).toString();
      expect((await send(body + "&" + body)).statusCode).toBe(400);
      expect(app.store.revokeProviderSessions).not.toHaveBeenCalled();
      expect((await send(body)).statusCode).toBe(204);
      expect(app.store.revokeProviderSessions).toHaveBeenCalledWith(
        expect.objectContaining({
          issuer: options.issuer,
          subject: "provider-user",
          providerSessionId: "provider-session",
          eventId: "provider-logout-event",
          now: expect.any(Date),
        }),
      );
      const forged = await send(
        new URLSearchParams({
          logout_token: await signed(claims, second, "first"),
        }).toString(),
      );
      expect(forged.statusCode).toBe(401);
      expect(forged.body).not.toContain(token);
      expect(app.store.revokeProviderSessions).toHaveBeenCalledTimes(1);
    } finally {
      await app.api.close();
    }
  }, 10_000);
  it("binds native return state and PKCE, permits initial GET probes, and exchanges exactly once", async () => {
    const app = await application();
    try {
      const verifier = randomBytes(32).toString("base64url"),
        state = randomBytes(32).toString("base64url"),
        redirectUri = options.clients[1].redirectUris[0];
      const query = new URLSearchParams({
        clientId: "extension-chromium",
        action: "signin",
        destination: "client",
        redirectUri,
        state,
        codeChallenge: createHash("sha256")
          .update(verifier)
          .digest("base64url"),
      });
      const probe = await app.api.inject("/api/v1/auth/authorize?" + query);
      const start = await app.api.inject("/api/v1/auth/authorize?" + query);
      expect(probe.statusCode).toBe(302);
      expect(start.statusCode).toBe(302);
      const callbackState = new URL(start.headers.location!).searchParams.get(
        "state",
      )!;
      const callback =
        "/api/v1/auth/callback?" +
        new URLSearchParams({ state: callbackState, code: "provider-code" });
      expect((await app.api.inject(callback)).statusCode).toBe(401);
      const complete = await app.api.inject({
        url: callback,
        headers: { cookie: cookiePairs(start.headers["set-cookie"]) },
      });
      expect(complete.statusCode).toBe(302);
      const destination = new URL(complete.headers.location!);
      expect(destination.origin + destination.pathname).toBe(redirectUri);
      expect(destination.searchParams.get("state")).toBe(state);
      expect([...destination.searchParams.keys()].sort()).toEqual([
        "code",
        "state",
      ]);
      const body = {
        code: destination.searchParams.get("code"),
        clientId: "extension-chromium",
        redirectUri,
        codeVerifier: randomBytes(32).toString("base64url"),
      };
      expect(
        (
          await app.api.inject({
            method: "POST",
            url: "/api/v1/auth/exchange",
            payload: body,
          })
        ).statusCode,
      ).toBe(401);
      body.codeVerifier = verifier;
      const exchanged = await app.api.inject({
        method: "POST",
        url: "/api/v1/auth/exchange",
        payload: body,
      });
      expect(exchanged.statusCode).toBe(200);
      const tokens = identityTokensSchema.parse(exchanged.json());
      expect(
        (
          await app.api.inject({
            method: "POST",
            url: "/api/v1/auth/exchange",
            payload: body,
          })
        ).statusCode,
      ).toBe(401);
      const account = await app.api.inject({
        url: "/api/v1/account",
        headers: { authorization: "Bearer " + tokens.accessToken },
      });
      expect(account.statusCode).toBe(200);
      expect(account.json()).not.toHaveProperty("csrfToken");
      expect(account.body).not.toMatch(
        /accessHash|refreshHash|providerSubject|provider-user/,
      );
      expect(tokens.expiresAt).not.toBe(tokens.sessionExpiresAt);
    } finally {
      await app.api.close();
    }
  }, 10_000);
  it("issues protected web cookies, supplies a bounded account and requires Origin plus CSRF for mutations", async () => {
    const app = await application(true);
    try {
      const start = await app.api.inject("/api/v1/auth/authorize?clientId=web");
      const state = new URL(start.headers.location!).searchParams.get("state")!;
      const complete = await app.api.inject({
        url:
          "/api/v1/auth/callback?" +
          new URLSearchParams({
            state,
            code: "provider-code",
            iss: options.issuer,
          }),
        headers: { cookie: cookiePairs(start.headers["set-cookie"]) },
      });
      expect(complete.headers.location).toBe(options.webOrigin + "/account");
      for (const value of complete.headers["set-cookie"] as string[]) {
        expect(value).toMatch(/^__Host-tholi_(session|refresh)=/);
        expect(value).toContain("Path=/;");
        expect(value).toMatch(/HttpOnly; Secure; SameSite=Lax/);
        expect(value).not.toMatch(/Domain=/i);
      }
      const cookies = cookiePairs(complete.headers["set-cookie"]);
      const account = identityAccountResponseSchema.parse(
        (
          await app.api.inject({
            url: "/api/v1/account",
            headers: { cookie: cookies },
          })
        ).json(),
      );
      expect(account.csrfToken).toBeTruthy();
      for (const origin of [
        "chrome-extension://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
        "moz-extension://b0342914-3154-4ddd-a06a-aea1611c0951",
        "https://another-configured.example.test",
      ]) {
        const denied = await app.api.inject({
          url: "/api/v1/account",
          headers: { cookie: cookies, origin },
        });
        expect(denied.statusCode).toBe(403);
        expect(denied.body).not.toContain(account.csrfToken!);
      }
      const logout = (headers: Record<string, string>) =>
        app.api.inject({
          method: "POST",
          url: "/api/v1/auth/logout",
          headers: { cookie: cookies, ...headers },
          payload: {},
        });
      expect(
        (
          await logout({
            origin: "https://attacker.example.test",
            "x-tholi-csrf": account.csrfToken!,
          })
        ).statusCode,
      ).toBe(403);
      expect((await logout({ origin: options.webOrigin })).statusCode).toBe(
        403,
      );
      expect(app.store.revokeSession).not.toHaveBeenCalled();
      const sessions = await app.api.inject({
        url: "/api/v1/account/sessions",
        headers: { cookie: cookies },
      });
      expect(sessions.json().items[0]).toMatchObject({
        id: account.session.id,
        current: true,
      });
      expect(sessions.body).not.toMatch(/Hash|provider|csrf/);
      const result = await logout({
        origin: options.webOrigin,
        "x-tholi-csrf": account.csrfToken!,
      });
      expect(result.statusCode).toBe(200);
      expect(result.json()).toMatchObject({
        signedOut: true,
        providerLogoutUrl: options.endSessionEndpoint,
      });
      expect(
        (
          await app.api.inject({
            url: "/api/v1/account",
            headers: { cookie: cookies },
          })
        ).statusCode,
      ).toBe(401);
    } finally {
      await app.api.close();
    }
  });
  it("rejects arbitrary returns, unknown fields and mock account state without creating provider authority", async () => {
    const app = await application();
    try {
      for (const query of [
        "clientId=web&redirectUri=https://attacker.example.test",
        "clientId=unregistered",
        "clientId=web&plan=paid",
      ])
        expect(
          (await app.api.inject("/api/v1/auth/authorize?" + query)).statusCode,
        ).toBe(400);
      const response = await app.api.inject({
        url: "/api/v1/account",
        headers: {
          cookie: "tholi-demo-account=mock",
          authorization: "Bearer mock",
        },
      });
      expect(response.statusCode).toBe(401);
      expect(app.store.resolveIdentity).not.toHaveBeenCalled();
      expect(app.store.createSession).not.toHaveBeenCalled();
    } finally {
      await app.api.close();
    }
  });
});
