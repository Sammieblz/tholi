import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { runDatabaseCommand } from "../../../apps/api/src/database/cli";
import {
  parsePrivateConfig,
  parseWorkerConfig,
  parseDatabaseConfig,
  parseServiceConfig,
  validateApiOptions,
  validatePrivateConnection,
  validateServiceOptions,
  validateIdentityOptions,
  validateObjectStorageOptions,
  validateSmtpOptions,
  SERVICE_TRANSPORT_DEFAULTS,
  validateServiceTransportPolicy,
  type ApiOptions,
} from "../../../apps/api/src/config";
import type { IdentityOptions } from "../../../apps/api/src/application/identity-contracts";

const chrome = "chrome-extension://" + "a".repeat(32);
const firefox = "moz-extension://12345678-1234-1234-1234-123456789abc";
const privateOptions: ApiOptions = {
  token: "a".repeat(64),
  origins: [chrome, firefox],
  database: "data/navigator.sqlite",
  models: "assets/models",
};

const supportEnvironment = () => ({
  THOLI_SUPPORT_ENABLED: "true",
  THOLI_FILE_LINK_SECRET_KEY: Buffer.alloc(32, 5).toString("base64url"),
  THOLI_OBJECT_ENDPOINT: "https://objects.example.test",
  THOLI_OBJECT_REGION: "region-1",
  THOLI_OBJECT_BUCKET: "tholi-private",
  THOLI_OBJECT_ACCESS_KEY: "synthetic-access",
  THOLI_OBJECT_SECRET_KEY: "synthetic-secret",
});

describe("service-only transport policy", () => {
  it("defaults to no trusted proxy and keeps private configuration independent", () => {
    expect(parseServiceConfig({}).options.transport).toEqual(
      SERVICE_TRANSPORT_DEFAULTS,
    );
    expect(
      parseServiceConfig({ THOLI_SERVICE_TRUSTED_PROXIES: "" }).options
        .transport?.trustedProxies,
    ).toEqual([]);
    const legacy = parsePrivateConfig({});
    expect(
      parsePrivateConfig({
        THOLI_SERVICE_TRUSTED_PROXIES: "*",
        THOLI_SERVICE_RATE_LIMIT_MAX: "0",
      }),
    ).toEqual(legacy);
  });
  it("accepts only explicit bounded literal proxy entries and snapshots caller settings", () => {
    const trustedProxies = ["127.0.0.1", "::1", "10.0.0.0/8", "2001:db8::/32"];
    const policy = validateServiceTransportPolicy({ trustedProxies });
    trustedProxies.push("192.0.2.1");
    expect(policy.trustedProxies).toHaveLength(4);
    expect(
      parseServiceConfig({ THOLI_SERVICE_TRUSTED_PROXIES: "127.0.0.1, ::1" })
        .options.transport?.trustedProxies,
    ).toEqual(["127.0.0.1", "::1"]);
    for (const entries of [
      true,
      1,
      "loopback",
      ["loopback"],
      ["*"],
      ["localhost"],
      ["0.0.0.0/0"],
      ["::/0"],
      ["::/32"],
      ["::ffff:0:0/96"],
      ["10.0.0.0/1"],
      ["127.0.0.1/33"],
      ["127.0.0.1/032"],
      ["127.0.0.1", "127.0.0.1"],
      Array.from({ length: 33 }, (_, i) => `192.0.2.${i}`),
    ])
      expect(() =>
        validateServiceTransportPolicy({ trustedProxies: entries as string[] }),
      ).toThrow();
  });
  it("validates every direct and environment budget before service construction", () => {
    for (const transport of [null, false, 1, "", []])
      expect(() =>
        validateServiceOptions({ origins: [], transport: transport as never }),
      ).toThrow("transport");
    for (const [name, value] of Object.entries({
      rateLimitMax: 0,
      rateLimitWindowMs: 999,
      rateLimitMaxClients: 65537,
      headersTimeoutMs: 0,
      requestTimeoutMs: 24999,
      connectionTimeoutMs: 25000,
      keepAliveTimeoutMs: 0,
      maxRequestsPerSocket: 0,
      maxHeaderBytes: 65536,
    }))
      expect(() =>
        validateServiceOptions({ origins: [], transport: { [name]: value } }),
      ).toThrow("transport");
    for (const [key, value] of Object.entries({
      THOLI_SERVICE_RATE_LIMIT_MAX: "0",
      THOLI_SERVICE_RATE_LIMIT_WINDOW_MS: "1e3",
      THOLI_SERVICE_RATE_LIMIT_MAX_CLIENTS: "65537",
      THOLI_SERVICE_HEADERS_TIMEOUT_MS: "0",
      THOLI_SERVICE_REQUEST_TIMEOUT_MS: "24999",
      THOLI_SERVICE_CONNECTION_TIMEOUT_MS: "25000",
      THOLI_SERVICE_KEEP_ALIVE_TIMEOUT_MS: "-1",
      THOLI_SERVICE_MAX_REQUESTS_PER_SOCKET: "1.5",
      THOLI_SERVICE_MAX_HEADER_BYTES: "65536",
      THOLI_SERVICE_TRUSTED_PROXIES: "127.0.0.1,",
    }))
      expect(() => parseServiceConfig({ [key]: value })).toThrow();
    expect(() =>
      validateServiceTransportPolicy({
        trustedProxies: [],
        arbitrary: true,
      } as never),
    ).toThrow();
  });
});

describe("explicit mail and storage composition", () => {
  it("requires identity for support and keeps SMTP credentials out of the HTTP profile", () => {
    expect(() => parseServiceConfig(supportEnvironment())).toThrow("identity");
    const env: Record<string, string> = {
      ...identityEnvironment(),
      ...supportEnvironment(),
    };
    const configured = parseServiceConfig(env).options;
    expect(configured.support?.objects.endpoint).toBe(
      env.THOLI_OBJECT_ENDPOINT,
    );
    expect(JSON.stringify(configured)).not.toContain("smtp");
    expect(
      parseServiceConfig({ ...env, THOLI_SUPPORT_ENABLED: "false" }).options
        .support,
    ).toBeUndefined();
    expect(() =>
      parseServiceConfig({
        ...env,
        THOLI_FILE_LINK_SECRET_KEY: env.THOLI_IDENTITY_FLOW_SECRET_KEY,
      }),
    ).toThrow("dedicated");
    expect(() =>
      validateServiceOptions({
        ...configured,
        support: {
          ...configured.support!,
          options: {
            ...configured.support!.options,
            publicOrigin: "https://elsewhere.test",
          },
        },
      }),
    ).toThrow("API origin");
    for (const name of [
      "THOLI_OBJECT_ENDPOINT",
      "THOLI_OBJECT_ACCESS_KEY",
      "THOLI_OBJECT_SECRET_KEY",
      "THOLI_FILE_LINK_SECRET_KEY",
    ]) {
      const missing: Record<string, string | undefined> = { ...env };
      delete missing[name];
      expect(() => parseServiceConfig(missing)).toThrow();
    }
    for (const endpoint of [
      "http://objects.example.test",
      "https://user:sentinel@objects.example.test",
      "https://objects.example.test/prefix",
      "https://objects.example.test?sentinel=private",
    ]) {
      expect(() =>
        parseServiceConfig({ ...env, THOLI_OBJECT_ENDPOINT: endpoint }),
      ).toThrow();
    }
  });

  it("gives the worker only explicitly enabled transports and confines capture to local development", () => {
    const database = {
      THOLI_DATABASE_WORKER_URL: "postgresql://worker:synthetic@postgres/tholi",
    };
    expect(parseWorkerConfig(database).support).toBeUndefined();
    const env = {
      ...database,
      ...supportEnvironment(),
      NODE_ENV: "development",
      THOLI_OBJECT_ENDPOINT: "http://storage:8333",
      THOLI_SMTP_HOST: "mail",
      THOLI_SMTP_PORT: "1025",
      THOLI_SMTP_LOCAL_CAPTURE: "true",
      THOLI_SMTP_REQUIRE_TLS: "false",
      THOLI_SMTP_FROM: "tholi@example.invalid",
      THOLI_SMTP_SUPPORT_RECIPIENT: "support@example.invalid",
    };
    const configured = parseWorkerConfig(env).support!;
    expect(configured.mail.localCapture).toBe(true);
    expect(JSON.stringify(configured)).not.toContain("fileLinkSecret");
    expect(() =>
      parseWorkerConfig({ ...env, NODE_ENV: "production" }),
    ).toThrow();
    expect(() =>
      parseWorkerConfig({ ...env, THOLI_SMTP_HOST: "external.example.test" }),
    ).toThrow("isolated local");
    expect(() =>
      validateSmtpOptions({ ...configured.mail, localCapture: false }),
    ).toThrow("TLS");
    expect(() =>
      validateSmtpOptions({ ...configured.mail, user: "user" }, true),
    ).toThrow("together");
    expect(() =>
      validateSmtpOptions(
        {
          ...configured.mail,
          from: "valid@example.invalid\r\nBcc: another@example.invalid",
        },
        true,
      ),
    ).toThrow();
    expect(() =>
      validateObjectStorageOptions(
        { ...configured.objects, maxBytes: 9999999 },
        true,
      ),
    ).toThrow();
    expect(() =>
      parseServiceConfig({
        ...identityEnvironment(),
        ...supportEnvironment(),
        THOLI_SUPPORT_ENABLED: "yes",
      }),
    ).toThrow("availability");
  });
});

function identityEnvironment(local = false): Record<string, string> {
  const provider = local
    ? "http://localhost:18080"
    : "https://identity.tholi.io";
  const transport = local ? "http://oidc:8080" : provider;
  const webOrigin = local ? "http://127.0.0.1:5174" : "https://tholi.io";
  return {
    NODE_ENV: local ? "development" : "production",
    THOLI_SERVICE_ORIGINS: webOrigin,
    THOLI_SERVICE_PUBLIC_ORIGIN: local
      ? "http://127.0.0.1:8788"
      : "https://api.tholi.io",
    THOLI_DATABASE_URL:
      "postgresql://runtime:synthetic-password@postgres/tholi",
    THOLI_IDENTITY_ISSUER: provider + "/realms/tholi",
    THOLI_IDENTITY_AUTHORIZATION_ENDPOINT:
      provider + "/realms/tholi/protocol/openid-connect/auth",
    THOLI_IDENTITY_TOKEN_ENDPOINT:
      transport + "/realms/tholi/protocol/openid-connect/token",
    THOLI_IDENTITY_JWKS_URI:
      transport + "/realms/tholi/protocol/openid-connect/certs",
    THOLI_IDENTITY_LOGOUT_ENDPOINT:
      provider + "/realms/tholi/protocol/openid-connect/logout",
    THOLI_IDENTITY_CLIENT_ID: "tholi-service",
    THOLI_IDENTITY_CLIENT_SECRET_KEY:
      "synthetic-client-secret-for-configuration-only",
    THOLI_IDENTITY_FLOW_SECRET_KEY: Buffer.alloc(32, 7).toString("base64url"),
    THOLI_IDENTITY_WEB_ORIGIN: webOrigin,
    THOLI_IDENTITY_CHROMIUM_CALLBACKS:
      "https://" + "a".repeat(32) + ".chromiumapp.org/",
    THOLI_IDENTITY_FIREFOX_CALLBACKS:
      "https://synthetic.extensions.allizom.org/",
  };
}

describe("API configuration profiles", () => {
  it("isolates worker credentials and bounds concurrency, lease, heartbeat and connection budgets", () => {
    const env = {
      THOLI_DATABASE_WORKER_URL:
        "postgresql://worker:synthetic@localhost/tholi",
    };
    const config = parseWorkerConfig(env);
    expect(config.database.max).toBe(4);
    expect(config.options).toMatchObject({
      concurrency: 2,
      leaseMs: 30000,
      heartbeatMs: 10000,
    });
    expect(() =>
      parseWorkerConfig({ THOLI_DATABASE_URL: env.THOLI_DATABASE_WORKER_URL }),
    ).toThrow("THOLI_DATABASE_WORKER_URL");
    for (const invalid of [
      { THOLI_DATABASE_POOL_MAX: "5" },
      { THOLI_WORKER_CONCURRENCY: "3" },
      { THOLI_WORKER_POLL_MS: "0" },
      { THOLI_WORKER_LEASE_MS: "9999" },
      { THOLI_WORKER_HEARTBEAT_MS: "15000" },
      { THOLI_WORKER_SCHEDULE_MS: "NaN" },
    ])
      expect(() => parseWorkerConfig({ ...env, ...invalid })).toThrow();
  });
  it("refuses synthetic database seed outside the explicit development profile", async () => {
    for (const env of [
      { NODE_ENV: "production", THOLI_ALLOW_DEV_SEED: "true" },
      { NODE_ENV: "development", THOLI_ALLOW_DEV_SEED: "false" },
      {},
    ])
      await expect(runDatabaseCommand("seed", env)).rejects.toThrow(
        "development profile",
      );
    await expect(runDatabaseCommand("reset")).rejects.toThrow(
      "migrate, verify, seed or retry-job",
    );
  });
  it("requires explicit PostgreSQL credentials and separates migration pool budgets", () => {
    const runtime = "postgresql://runtime:local@localhost/tholi";
    const migration = "postgresql://migrator:local@localhost/tholi";
    expect(parseDatabaseConfig({ THOLI_DATABASE_URL: runtime })).toEqual({
      connectionString: runtime,
      max: 8,
    });
    expect(
      parseDatabaseConfig(
        { THOLI_DATABASE_MIGRATION_URL: migration },
        "migration",
      ),
    ).toEqual({ connectionString: migration, max: 1 });
    expect(() =>
      parseDatabaseConfig({ THOLI_DATABASE_URL: runtime }, "migration"),
    ).toThrow("THOLI_DATABASE_MIGRATION_URL");
    expect(() =>
      parseDatabaseConfig({
        PGDATABASE: "implicit",
        NAVIGATOR_DATA_DIR: "private",
      }),
    ).toThrow("THOLI_DATABASE_URL");
    for (const value of ["0", "33", "1e1", "1.2", "NaN"])
      expect(() =>
        parseDatabaseConfig({
          THOLI_DATABASE_URL: runtime,
          THOLI_DATABASE_POOL_MAX: value,
        }),
      ).toThrow("budget");
    expect(() =>
      parseDatabaseConfig(
        {
          THOLI_DATABASE_MIGRATION_URL: migration,
          THOLI_DATABASE_POOL_MAX: "3",
        },
        "migration",
      ),
    ).toThrow("budget");
    for (const connection of [
      "navigator.sqlite",
      "https://example.test",
      "file:///private",
    ])
      expect(() =>
        parseDatabaseConfig({ THOLI_DATABASE_URL: connection }),
      ).toThrow();
  });
  it("retains loopback legacy defaults independently of service configuration", () => {
    const cwd = resolve("profile-fixture");
    expect(
      parsePrivateConfig(
        {
          PORT: "9000",
          THOLI_SERVICE_HOST: "0.0.0.0",
          THOLI_SERVICE_ORIGINS: "*",
        },
        cwd,
      ),
    ).toEqual({
      directory: resolve(cwd, ".navigator-api"),
      connectionPath: resolve(cwd, ".navigator-api/connection.json"),
      database: resolve(cwd, ".navigator-api/navigator.sqlite"),
      models: resolve(cwd, "assets/models"),
      origins: undefined,
      listen: { host: "127.0.0.1", port: 8787 },
    });
  });

  it("retains NAVIGATOR paths, port and explicit extension-origin overrides", () => {
    const config = parsePrivateConfig({
      NAVIGATOR_DATA_DIR: "private-data",
      NAVIGATOR_MODELS: "private-models",
      NAVIGATOR_PORT: "9876",
      NAVIGATOR_EXTENSION_ORIGINS: `${chrome}, ${firefox}`,
    });
    expect(config.directory).toBe(resolve("private-data"));
    expect(config.models).toBe(resolve("private-models"));
    expect(config.origins).toEqual([chrome, firefox]);
    expect(config.listen).toEqual({ host: "127.0.0.1", port: 9876 });
    expect(
      parsePrivateConfig({ NAVIGATOR_EXTENSION_ORIGINS: "" }).origins,
    ).toEqual([]);
  });

  it.each(["", "0", "65536", "1.5", "-1", "1e3", " 8787", "8x"])(
    "rejects invalid ports before startup: %j",
    (port) => {
      expect(() => parsePrivateConfig({ NAVIGATOR_PORT: port })).toThrow();
      expect(() => parseServiceConfig({ PORT: port })).toThrow();
    },
  );

  it("keeps service defaults separate from legacy credentials and origins", () => {
    expect(
      parseServiceConfig({
        NAVIGATOR_PORT: "9876",
        NAVIGATOR_DATA_DIR: "legacy",
        NAVIGATOR_EXTENSION_ORIGINS: chrome,
      }),
    ).toEqual({
      options: { origins: [], transport: SERVICE_TRANSPORT_DEFAULTS },
      listen: { host: "127.0.0.1", port: 8788 },
    });
  });

  it("accepts platform ports and explicit service listen/origin settings", () => {
    expect(parseServiceConfig({ PORT: "8080" }).listen.port).toBe(8080);
    expect(
      parseServiceConfig({
        PORT: "8080",
        THOLI_SERVICE_PORT: "8080",
        THOLI_SERVICE_HOST: "0.0.0.0",
        THOLI_SERVICE_ORIGINS: "https://tholi.io, http://localhost:5173",
      }),
    ).toEqual({
      options: {
        origins: ["https://tholi.io", "http://localhost:5173"],
        transport: SERVICE_TRANSPORT_DEFAULTS,
      },
      listen: { host: "0.0.0.0", port: 8080 },
    });
    expect(parseServiceConfig({ THOLI_SERVICE_HOST: "::1" }).listen.host).toBe(
      "::1",
    );
    expect(() =>
      parseServiceConfig({ PORT: "8080", THOLI_SERVICE_PORT: "9000" }),
    ).toThrow(/agree/);
    expect(() =>
      parseServiceConfig({ THOLI_SERVICE_HOST: "http://0.0.0.0" }),
    ).toThrow(/host/);
  });

  it("defaults to the cloud-free model policy and fails closed for live or unknown providers", () => {
    expect(parseServiceConfig({ THOLI_MODEL_PROVIDER: "fake" })).toEqual(
      parseServiceConfig({}),
    );
    for (const provider of ["gemini", "unknown", ""])
      expect(() =>
        parseServiceConfig({
          THOLI_MODEL_PROVIDER: provider,
          THOLI_GEMINI_OPT_IN: "true",
          THOLI_GEMINI_SPEND_LIMIT_USD: "1",
        }),
      ).toThrow();
  });

  it.each([
    "*",
    "null",
    "https://*.example.com",
    "https://tholi.io/path",
    "https://tholi.io/",
    "https://user:secret@tholi.io",
    "https://tholi.io?secret=value",
    "https://tholi.io#fragment",
    chrome,
  ])("rejects non-exact service origins: %j", (origin) => {
    expect(() => validateServiceOptions({ origins: [origin] })).toThrow(
      /origins/,
    );
  });

  it("does not allow website or wildcard origins into the private profile", () => {
    expect(validateApiOptions(privateOptions).origins).toEqual([
      chrome,
      firefox,
    ]);
    for (const origin of [
      "https://tholi.io",
      "chrome-extension://*",
      "moz-extension://*",
    ])
      expect(() =>
        validateApiOptions({ ...privateOptions, origins: [origin] }),
      ).toThrow(/extensions/);
  });

  it.each([
    null,
    { ...privateOptions, token: null },
    { ...privateOptions, token: "short" },
    { ...privateOptions, token: " ".repeat(64) },
    { ...privateOptions, origins: "*" },
    { ...privateOptions, origins: [32] },
    { ...privateOptions, database: "" },
    { ...privateOptions, database: "data\0file" },
    { ...privateOptions, models: 32 },
    { ...privateOptions, worker: "file:///worker.js" },
    { ...privateOptions, worker: new URL("https://example.com/worker.js") },
  ])("rejects malformed programmatic private options", (options) => {
    expect(() => validateApiOptions(options as ApiOptions)).toThrow();
  });

  it("rejects malformed stored connections instead of inventing an identity", () => {
    for (const connection of [
      null,
      {},
      { token: "short", origins: [] },
      { token: "a".repeat(64), origins: ["*"] },
    ])
      expect(() => validatePrivateConnection(connection)).toThrow();
    expect(
      validatePrivateConnection({
        token: privateOptions.token,
        origins: [chrome],
      }),
    ).toEqual({
      token: privateOptions.token,
      origins: [chrome],
    });
  });

  it.each([false, true])(
    "selects explicit portable identity and runtime database settings (local=%s)",
    (local) => {
      const env = identityEnvironment(local);
      const { options } = parseServiceConfig(env);
      expect(options.database).toEqual({
        connectionString: env.THOLI_DATABASE_URL,
        max: 8,
      });
      expect(options.identity).toMatchObject({
        issuer: env.THOLI_IDENTITY_ISSUER,
        tokenEndpoint: env.THOLI_IDENTITY_TOKEN_ENDPOINT,
        jwksUri: env.THOLI_IDENTITY_JWKS_URI,
        callbackUrl: env.THOLI_SERVICE_PUBLIC_ORIGIN + "/api/v1/auth/callback",
        secureCookies: !local,
        requireVerifiedEmail: true,
        accessLifetimeMs: 300_000,
        sessionLifetimeMs: 43_200_000,
        clients: [
          {
            id: "web",
            kind: "web",
            redirectUris: [
              env.THOLI_IDENTITY_WEB_ORIGIN + "/account",
              env.THOLI_IDENTITY_WEB_ORIGIN + "/download",
            ],
          },
          {
            id: "extension-chromium",
            kind: "extension",
            redirectUris: [env.THOLI_IDENTITY_CHROMIUM_CALLBACKS],
          },
          {
            id: "extension-firefox",
            kind: "extension",
            redirectUris: [env.THOLI_IDENTITY_FIREFOX_CALLBACKS],
          },
        ],
      });
      expect(options.identity).not.toHaveProperty("database");
    },
  );

  it("refuses incomplete identity profiles without echoing supplied secrets", () => {
    const complete = identityEnvironment();
    for (const missing of [
      "THOLI_IDENTITY_ISSUER",
      "THOLI_DATABASE_URL",
      "THOLI_IDENTITY_CLIENT_ID",
      "THOLI_IDENTITY_CLIENT_SECRET_KEY",
      "THOLI_IDENTITY_FLOW_SECRET_KEY",
      "THOLI_IDENTITY_WEB_ORIGIN",
      "THOLI_SERVICE_PUBLIC_ORIGIN",
      "THOLI_IDENTITY_TOKEN_ENDPOINT",
      "THOLI_IDENTITY_AUTHORIZATION_ENDPOINT",
      "THOLI_IDENTITY_JWKS_URI",
      "THOLI_IDENTITY_LOGOUT_ENDPOINT",
    ]) {
      const env = { ...complete };
      delete env[missing];
      expect(() => parseServiceConfig(env)).toThrow();
    }
    const secret = "PRIVATE_CONFIGURATION_SENTINEL";
    try {
      parseServiceConfig({
        ...complete,
        THOLI_IDENTITY_CLIENT_SECRET_KEY: secret,
      });
      throw new Error("Expected rejection");
    } catch (error) {
      expect(String(error)).not.toContain(secret);
      expect(String(error)).toContain("identity configuration");
    }
    const options = parseServiceConfig(complete).options;
    expect(() =>
      validateServiceOptions({
        origins: options.origins,
        identity: options.identity,
      }),
    ).toThrow("database");
    expect(() =>
      validateServiceOptions({
        origins: options.origins,
        database: options.database,
      }),
    ).toThrow("database");
  });

  it.each([
    [
      "THOLI_IDENTITY_ISSUER",
      "https://user:secret@identity.tholi.io/realms/tholi",
    ],
    [
      "THOLI_IDENTITY_TOKEN_ENDPOINT",
      "https://identity.tholi.io/token?credential=PRIVATE_SENTINEL",
    ],
    ["THOLI_IDENTITY_JWKS_URI", "https://identity.tholi.io/keys#fragment"],
    ["THOLI_IDENTITY_AUTHORIZATION_ENDPOINT", "javascript:alert(1)"],
    ["THOLI_IDENTITY_LOGOUT_ENDPOINT", "http://identity.tholi.io/logout"],
    ["THOLI_SERVICE_PUBLIC_ORIGIN", "https://api.tholi.io/prefix"],
    ["THOLI_IDENTITY_WEB_ORIGIN", "https://tholi.io/account"],
    [
      "THOLI_IDENTITY_CHROMIUM_CALLBACKS",
      "https://approved.chromiumapp.org/#token",
    ],
  ])(
    "rejects unsafe identity URL in %s without exposing its value",
    (name, value) => {
      try {
        parseServiceConfig({ ...identityEnvironment(), [name]: value });
        throw new Error("Expected rejection");
      } catch (error) {
        expect(String(error)).not.toContain(value);
        expect(String(error)).not.toContain("PRIVATE_SENTINEL");
        expect(String(error)).not.toContain("Expected rejection");
      }
    },
  );

  it("validates strict identity clients, callback ownership and bounded lifetimes", () => {
    const configured = parseServiceConfig(identityEnvironment()).options;
    const identity = configured.identity!;
    const invalid: IdentityOptions[] = [
      { ...identity, unexpected: true } as IdentityOptions,
      { ...identity, clients: [...identity.clients, identity.clients[0]] },
      {
        ...identity,
        clients: [
          {
            ...identity.clients[0],
            redirectUris: ["https://elsewhere.test/account"],
          },
        ],
      },
      {
        ...identity,
        clients: [
          {
            ...identity.clients[0],
            redirectUris: [
              ...identity.clients[0].redirectUris,
              identity.clients[0].redirectUris[0],
            ],
          },
        ],
      },
      {
        ...identity,
        clients: [
          {
            ...identity.clients[0],
            unexpected: true,
          } as IdentityOptions["clients"][number],
        ],
      },
      {
        ...identity,
        clients: [
          { ...identity.clients[1], redirectUris: ["http://localhost:4567/"] },
        ],
      },
      { ...identity, callbackUrl: "https://api.tholi.io/api/v1/other" },
      {
        ...identity,
        flowEncryptionKey: Buffer.alloc(31).toString("base64url"),
      },
      { ...identity, secureCookies: false },
      { ...identity, accessLifetimeMs: 59_999 },
      { ...identity, accessLifetimeMs: 900_001 },
      { ...identity, sessionLifetimeMs: 299_999 },
      { ...identity, sessionLifetimeMs: 43_200_001 },
      { ...identity, accessLifetimeMs: 600_000, sessionLifetimeMs: 300_000 },
    ];
    for (const input of invalid)
      expect(() => validateIdentityOptions(input)).toThrow();
    expect(() =>
      validateServiceOptions({ ...configured, origins: [] }),
    ).toThrow("configured service origin");
    expect(() =>
      parseServiceConfig({
        ...identityEnvironment(),
        THOLI_IDENTITY_CLIENTS: "not-json",
      }),
    ).toThrow("registered identity clients");
    expect(() =>
      parseServiceConfig({
        ...identityEnvironment(),
        THOLI_IDENTITY_ACCESS_LIFETIME_MS: "1e5",
      }),
    ).toThrow("identity configuration");
    expect(() =>
      parseServiceConfig({
        ...identityEnvironment(),
        THOLI_IDENTITY_SESSION_LIFETIME_MS: "Infinity",
      }),
    ).toThrow("identity configuration");
  });

  it("requires a usable same-site cookie topology and confines HTTP development exceptions", () => {
    const production = parseServiceConfig(identityEnvironment()).options
      .identity!;
    expect(() =>
      validateIdentityOptions({
        ...production,
        callbackUrl: "https://elsewhere.test/api/v1/auth/callback",
      }),
    ).toThrow("domain topology");
    const local = parseServiceConfig(identityEnvironment(true)).options
      .identity!;
    expect(() =>
      validateIdentityOptions({
        ...local,
        callbackUrl: "http://localhost:8788/api/v1/auth/callback",
      }),
    ).toThrow("domain topology");
    expect(() =>
      validateIdentityOptions({
        ...local,
        tokenEndpoint: "http://untrusted-network.test/token",
      }),
    ).toThrow("verified HTTPS");
    expect(() =>
      validateIdentityOptions({ ...local, webOrigin: "http://0.0.0.0:5174" }),
    ).toThrow();
  });
});
