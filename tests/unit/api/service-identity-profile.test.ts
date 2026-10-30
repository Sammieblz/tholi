import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { parseServiceConfig } from "../../../apps/api/src/config";
import { createServiceApi } from "../../../apps/api/src/server";
import { IdentityService } from "../../../apps/api/src/application/identity";
import type {
  IdentityProvider,
  IdentityStore,
} from "../../../apps/api/src/application/identity-contracts";
import { SERVICE_ROUTES } from "../../../apps/api/src/routes/service-inventory";

const runtime = vi.hoisted(() => ({
  imported: vi.fn(),
  create: vi.fn(),
  sqlImported: vi.fn(),
}));
vi.mock("pg", () => {
  runtime.sqlImported();
  return {
    Pool: vi.fn(() => {
      throw new Error(
        "A composed profile fixture must not construct PostgreSQL connections.",
      );
    }),
  };
});
vi.mock("../../../apps/api/src/adapters/service-identity", () => {
  runtime.imported();
  return {
    createIdentityRuntime: runtime.create.mockImplementation(() => {
      throw new Error(
        "This profile test must not open a service database or provider connection.",
      );
    }),
  };
});

const applications: FastifyInstance[] = [];
afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
  vi.clearAllMocks();
});
const chromiumOrigin = "chrome-extension://" + "a".repeat(32);
const firefoxOrigin = "moz-extension://12345678-1234-1234-1234-123456789abc";
function configured() {
  const options = parseServiceConfig({
    NODE_ENV: "production",
    THOLI_SERVICE_ORIGINS: "https://tholi.io,https://help.tholi.io",
    THOLI_SERVICE_PUBLIC_ORIGIN: "https://api.tholi.io",
    THOLI_DATABASE_URL:
      "postgresql://runtime:synthetic@unreachable.invalid/tholi",
    THOLI_IDENTITY_ISSUER: "https://identity.tholi.io/realms/tholi",
    THOLI_IDENTITY_AUTHORIZATION_ENDPOINT:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/auth",
    THOLI_IDENTITY_TOKEN_ENDPOINT:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/token",
    THOLI_IDENTITY_JWKS_URI:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/certs",
    THOLI_IDENTITY_LOGOUT_ENDPOINT:
      "https://identity.tholi.io/realms/tholi/protocol/openid-connect/logout",
    THOLI_IDENTITY_CLIENT_ID: "tholi-service",
    THOLI_IDENTITY_CLIENT_SECRET_KEY:
      "synthetic-client-secret-for-profile-tests",
    THOLI_IDENTITY_FLOW_SECRET_KEY: Buffer.alloc(32, 9).toString("base64url"),
    THOLI_IDENTITY_WEB_ORIGIN: "https://tholi.io",
    THOLI_IDENTITY_CHROMIUM_CALLBACKS:
      "https://" + "a".repeat(32) + ".chromiumapp.org/",
    THOLI_IDENTITY_FIREFOX_CALLBACKS:
      "https://synthetic.extensions.allizom.org/",
  }).options;
  const unexpected = vi.fn(async (): Promise<never> => {
    throw new Error(
      "No authenticated identity or state mutation is granted by this fixture.",
    );
  });
  const store: IdentityStore = {
    createFlow: unexpected,
    consumeFlow: unexpected,
    resolveIdentity: unexpected,
    createBroker: unexpected,
    consumeBroker: unexpected,
    createSession: unexpected,
    authenticateSession: vi.fn(async () => null),
    rotateSession: unexpected,
    listSessions: unexpected,
    revokeSession: unexpected,
    revokeAllSessions: unexpected,
    revokeProviderSessions: unexpected,
  };
  const provider: IdentityProvider = {
    authorize: () => {
      throw new Error("Provider authorization is not used by a profile test.");
    },
    exchange: unexpected,
    verifyLogout: unexpected,
    logoutUrl: () => {
      throw new Error("Provider logout is not used by a profile test.");
    },
  };
  return {
    options,
    store,
    unexpected,
    service: new IdentityService(options.identity!, store, provider),
  };
}
async function track(application: Promise<FastifyInstance>) {
  const app = await application;
  applications.push(app);
  return app;
}

describe("configured service identity composition", () => {
  it("keeps an unconfigured service free of identity persistence and account routes", async () => {
    const app = await track(
      createServiceApi({ origins: ["https://tholi.io"] }),
    );
    const capabilities = await app.inject({ url: "/api/v1/capabilities" });
    expect(capabilities.json().availability).toEqual({
      authentication: false,
      accountData: false,
      decisions: false,
      billing: false,
    });
    expect((await app.inject({ url: "/api/v1/account" })).statusCode).toBe(404);
    expect(
      (await app.inject({ url: "/api/v1/auth/authorize?clientId=web" }))
        .statusCode,
    ).toBe(404);
    expect(runtime.imported).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.sqlImported).not.toHaveBeenCalled();
  });

  it("describes actual identity routes and cookie security without advertising inference or billing", async () => {
    const { options, service, unexpected } = configured();
    const app = await track(
      createServiceApi(options, [], { identity: service }),
    );
    const capabilities = (
      await app.inject({ url: "/api/v1/capabilities" })
    ).json();
    expect(capabilities.capabilities).toEqual([
      "capabilities",
      "handshake",
      "openapi",
      "authentication",
      "account-security",
    ]);
    expect(capabilities.availability).toEqual({
      authentication: true,
      accountData: true,
      decisions: false,
      billing: false,
    });
    const specification = (
      await app.inject({ url: "/api/v1/openapi.json" })
    ).json();
    expect(specification.components.securitySchemes).toMatchObject({
      NativeBearer: { type: "http", scheme: "bearer" },
      WebSession: {
        type: "apiKey",
        in: "cookie",
        name: "__Host-tholi_session",
      },
    });
    const inventory = specification[
      "x-tholi-route-inventory"
    ] as (typeof SERVICE_ROUTES)[number][];
    expect(inventory).toHaveLength(SERVICE_ROUTES.length);
    for (const entry of inventory) {
      const routeExists = app.hasRoute({
        method: entry.method,
        url: entry.path.replace(/\{([^}]+)\}/g, ":$1"),
      });
      expect(entry.status, entry.operationId).toBe(
        routeExists ? "implemented" : "planned",
      );
      if (entry.status === "implemented")
        expect(
          specification.paths[entry.path]?.[entry.method.toLowerCase()]
            ?.operationId,
        ).toBe(entry.operationId);
    }
    expect(
      inventory.find((entry) => entry.operationId === "getCurrentAccount")
        ?.status,
    ).toBe("implemented");
    expect(
      inventory.find((entry) => entry.operationId === "updateCurrentAccount")
        ?.status,
    ).toBe("planned");
    expect(unexpected).not.toHaveBeenCalled();
    expect(runtime.imported).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
    expect(runtime.sqlImported).not.toHaveBeenCalled();
  });

  it("grants credentialed CORS only to the exact website and admits registered native transport without cookies", async () => {
    const { options, service, store } = configured();
    const app = await track(
      createServiceApi(options, [], { identity: service }),
    );
    for (const origin of [
      "https://tholi.io",
      "https://help.tholi.io",
      chromiumOrigin,
      firefoxOrigin,
    ]) {
      const response = await app.inject({
        method: "OPTIONS",
        url: "/api/v1/auth/logout",
        headers: {
          origin,
          "access-control-request-method": "POST",
          "access-control-request-headers":
            "content-type,authorization,x-tholi-csrf",
        },
      });
      expect(response.statusCode).toBe(204);
      expect(response.headers["access-control-allow-origin"]).toBe(origin);
      expect(response.headers["access-control-allow-credentials"]).toBe(
        origin === "https://tholi.io" ? "true" : undefined,
      );
      expect(response.headers.vary).toMatch(/Origin/);
    }
    for (const origin of [
      chromiumOrigin,
      firefoxOrigin,
      "https://help.tholi.io",
    ])
      expect(
        (
          await app.inject({
            url: "/api/v1/account",
            headers: {
              origin,
              cookie: "__Host-tholi_session=" + "a".repeat(43),
            },
          })
        ).statusCode,
      ).toBe(403);
    expect(store.authenticateSession).not.toHaveBeenCalled();
    for (const origin of [
      "https://tholi.io.attacker.test",
      "chrome-extension://" + "b".repeat(32),
      "moz-extension://invalid",
      "null",
    ]) {
      const response = await app.inject({
        url: "/api/v1/capabilities",
        headers: { origin },
      });
      expect(response.statusCode).toBe(403);
      expect(response.headers["access-control-allow-origin"]).toBeUndefined();
    }
  });

  it("never promotes a legacy private bearer into an account or native session", async () => {
    const { options, service, store, unexpected } = configured();
    const app = await track(
      createServiceApi(options, [], { identity: service }),
    );
    const authorization = "Bearer " + "a".repeat(64);
    const account = await app.inject({
      url: "/api/v1/account",
      headers: { authorization, origin: chromiumOrigin },
    });
    expect(account.statusCode).toBe(401);
    expect(account.json()).toMatchObject({
      error: { code: "UNAUTHENTICATED", retryable: false },
    });
    expect(store.authenticateSession).toHaveBeenCalledTimes(1);
    for (const url of ["/v1/health", "/v2/health", "/v1/openapi.json"])
      expect(
        (await app.inject({ url, headers: { authorization } })).statusCode,
      ).toBe(404);
    expect(unexpected).not.toHaveBeenCalled();
    expect(runtime.create).not.toHaveBeenCalled();
  });
});
