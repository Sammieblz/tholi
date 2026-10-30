import { isIP } from "node:net";
import { resolve } from "node:path";
import { z } from "zod";
import type { DatabaseOptions } from "./database/postgres";
import type { IdentityOptions } from "./application/identity-contracts";

export interface ApiOptions {
  token: string;
  origins: string[];
  database: string;
  models: string;
  worker?: URL;
}

export interface ServiceApiOptions {
  origins: string[];
  identity?: IdentityOptions;
  database?: DatabaseOptions;
}

export interface ListenOptions {
  host: string;
  port: number;
}

export type Environment = Readonly<Record<string, string | undefined>>;

function requiredText(value: unknown, name: string): string {
  if (typeof value !== "string" || !value.trim() || value.includes("\0"))
    throw new Error(`Invalid ${name}.`);
  return value;
}

function validateToken(value: unknown): string {
  const token = requiredText(value, "private API token");
  if (token.length < 32 || /\s/.test(token))
    throw new Error("Use a generated token of at least 32 characters.");
  return token;
}

function validateOrigins(value: unknown, service: boolean): string[] {
  if (
    !Array.isArray(value) ||
    value.some((origin) => typeof origin !== "string")
  )
    throw new Error("Origins must be an array of exact origins.");
  for (const origin of value) {
    if (service) {
      let url: URL;
      try {
        url = new URL(origin);
      } catch {
        throw new Error("Service origins must be exact HTTP or HTTPS origins.");
      }
      if (
        !["http:", "https:"].includes(url.protocol) ||
        url.origin !== origin ||
        url.hostname.includes("*")
      )
        throw new Error("Service origins must be exact HTTP or HTTPS origins.");
    } else if (
      !/^chrome-extension:\/\/[a-p]{32}$/.test(origin) &&
      !/^moz-extension:\/\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
        origin,
      )
    )
      throw new Error(
        "CORS origins must explicitly name installed Chromium or Firefox extensions.",
      );
  }
  return [...value];
}

export function validateApiOptions(options: ApiOptions): ApiOptions {
  if (!options || typeof options !== "object")
    throw new Error("Invalid private API configuration.");
  const token = validateToken(options.token);
  const origins = validateOrigins(options.origins, false);
  const database = requiredText(options.database, "database path");
  const models = requiredText(options.models, "model path");
  if (
    options.worker !== undefined &&
    (!(options.worker instanceof URL) || options.worker.protocol !== "file:")
  )
    throw new Error("Inference worker must use a local file URL.");
  return {
    token,
    origins,
    database,
    models,
    ...(options.worker ? { worker: options.worker } : {}),
  };
}

export function validateServiceOptions(
  options: ServiceApiOptions,
): ServiceApiOptions {
  if (!options || typeof options !== "object")
    throw new Error("Invalid service configuration.");
  const origins = validateOrigins(options.origins, true);
  if (!!options.identity !== !!options.database)
    throw new Error(
      "Identity requires explicit service database configuration.",
    );
  if (!options.identity) return { origins };
  const identity = validateIdentityOptions(options.identity);
  if (!origins.includes(identity.webOrigin))
    throw new Error(
      "The identity website must be a configured service origin.",
    );
  return { origins, identity, database: { ...options.database! } };
}

function identityUrl(value: string): URL | undefined {
  try {
    return new URL(value);
  } catch {
    return undefined;
  }
}
const identityUrlSchema = z
  .string()
  .url()
  .max(2048)
  .refine((value) => {
    const url = identityUrl(value);
    return (
      !!url &&
      ["http:", "https:"].includes(url.protocol) &&
      !url.username &&
      !url.password &&
      !url.hash &&
      !url.search
    );
  });
const identityOriginSchema = identityUrlSchema.refine(
  (value) => identityUrl(value)?.origin === value,
);
const identityOptionsSchema = z
  .object({
    issuer: identityUrlSchema,
    authorizationEndpoint: identityUrlSchema,
    tokenEndpoint: identityUrlSchema,
    jwksUri: identityUrlSchema,
    endSessionEndpoint: identityUrlSchema,
    clientId: z.string().min(1).max(100),
    clientSecret: z.string().min(32).max(512),
    callbackUrl: identityUrlSchema,
    webOrigin: identityOriginSchema,
    clients: z
      .array(
        z
          .object({
            id: z
              .string()
              .min(1)
              .max(80)
              .regex(/^[a-zA-Z0-9][a-zA-Z0-9._-]*$/),
            kind: z.enum(["web", "extension", "desktop"]),
            redirectUris: z.array(identityUrlSchema).min(1).max(8),
          })
          .strict(),
      )
      .min(1)
      .max(16),
    flowEncryptionKey: z
      .string()
      .regex(/^[A-Za-z0-9_-]{43}$/)
      .refine(
        (value) =>
          Buffer.from(value, "base64url").length === 32 &&
          Buffer.from(value, "base64url").toString("base64url") === value,
      ),
    secureCookies: z.boolean(),
    requireVerifiedEmail: z.boolean(),
    accessLifetimeMs: z
      .number()
      .int()
      .min(60000)
      .max(15 * 60000),
    sessionLifetimeMs: z
      .number()
      .int()
      .min(5 * 60000)
      .max(12 * 60 * 60000),
  })
  .strict();

export function validateIdentityOptions(
  input: IdentityOptions,
): IdentityOptions {
  const result = identityOptionsSchema.safeParse(input);
  if (!result.success)
    throw new Error("Invalid service identity configuration.");
  const options = result.data;
  const urls = [
    options.issuer,
    options.authorizationEndpoint,
    options.tokenEndpoint,
    options.jwksUri,
    options.endSessionEndpoint,
    options.callbackUrl,
    options.webOrigin,
  ];
  const loopback = (host: string) =>
    ["localhost", "127.0.0.1", "[::1]"].includes(host);
  const local =
    !options.secureCookies &&
    [options.issuer, options.callbackUrl, options.webOrigin].every((value) =>
      loopback(new URL(value).hostname),
    );
  for (const value of urls) {
    const url = new URL(value);
    if (
      url.protocol !== "https:" &&
      !(local && (loopback(url.hostname) || url.hostname === "oidc"))
    )
      throw new Error(
        "Identity transport requires verified HTTPS outside local development.",
      );
  }
  if (!options.secureCookies && !local)
    throw new Error(
      "Insecure identity cookies are limited to loopback development.",
    );
  const webUrl = new URL(options.webOrigin);
  const callbackUrl = new URL(options.callbackUrl);
  if (
    webUrl.protocol !== callbackUrl.protocol ||
    !(
      webUrl.hostname === callbackUrl.hostname ||
      (!local &&
        (webUrl.hostname.endsWith(`.${callbackUrl.hostname}`) ||
          callbackUrl.hostname.endsWith(`.${webUrl.hostname}`)))
    )
  )
    throw new Error(
      "Cookie authentication requires matching local hosts or a shared website/API domain topology.",
    );
  if (
    new URL(options.callbackUrl).pathname !== "/api/v1/auth/callback" ||
    options.accessLifetimeMs > options.sessionLifetimeMs
  )
    throw new Error("Invalid identity callback or session lifetime.");
  const ids = new Set<string>();
  for (const client of options.clients) {
    if (ids.has(client.id))
      throw new Error("Identity client IDs must be distinct.");
    ids.add(client.id);
    if (new Set(client.redirectUris).size !== client.redirectUris.length)
      throw new Error("Identity client callbacks must be distinct.");
    for (const redirect of client.redirectUris) {
      const url = new URL(redirect);
      if (url.protocol !== "https:" && !(local && loopback(url.hostname)))
        throw new Error("Identity callback requires HTTPS or local loopback.");
      if (client.kind === "web" && url.origin !== options.webOrigin)
        throw new Error(
          "Website returns must remain on the configured website.",
        );
    }
  }
  return options;
}

function environmentValue(env: Environment, name: string): string | undefined {
  const value = env[name];
  return value === undefined ? undefined : requiredText(value, name);
}

function parsePort(value: string | undefined, fallback: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value))
    throw new Error("Port must be an integer from 1 to 65535.");
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1 || port > 65535)
    throw new Error("Port must be an integer from 1 to 65535.");
  return port;
}

function parseHost(value: string | undefined): string {
  const host = value ?? "127.0.0.1";
  if (
    !isIP(host) &&
    !/^(?=.{1,253}$)[a-z\d](?:[a-z\d-]*[a-z\d])?(?:\.[a-z\d](?:[a-z\d-]*[a-z\d])?)*$/i.test(
      host,
    )
  )
    throw new Error("Service host must be an IP address or hostname.");
  return host;
}

function parseOrigins(
  env: Environment,
  name: string,
  service: boolean,
): string[] | undefined {
  const value = env[name];
  if (value === undefined) return undefined;
  if (typeof value !== "string") throw new Error(`Invalid ${name}.`);
  return validateOrigins(
    value
      .split(",")
      .map((origin) => origin.trim())
      .filter(Boolean),
    service,
  );
}

/** Explicit service configuration; never read legacy SQLite paths or ambient PG*. */
export function parseDatabaseConfig(
  env: Environment,
  purpose: "runtime" | "migration" = "runtime",
): DatabaseOptions {
  const name =
    purpose === "migration"
      ? "THOLI_DATABASE_MIGRATION_URL"
      : "THOLI_DATABASE_URL";
  const connectionString = environmentValue(env, name);
  if (!connectionString) throw new Error(`Missing ${name}.`);
  let url: URL;
  try {
    url = new URL(connectionString);
  } catch {
    throw new Error("Invalid PostgreSQL connection configuration.");
  }
  if (!["postgres:", "postgresql:"].includes(url.protocol))
    throw new Error("A PostgreSQL connection URL is required.");
  const maxText = environmentValue(env, "THOLI_DATABASE_POOL_MAX");
  if (maxText !== undefined && !/^\d+$/.test(maxText))
    throw new Error("Invalid PostgreSQL pool budget.");
  const max =
    maxText === undefined ? (purpose === "migration" ? 1 : 8) : Number(maxText);
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > (purpose === "migration" ? 2 : 32)
  )
    throw new Error("Invalid PostgreSQL pool budget.");
  return { connectionString, max };
}

export function parsePrivateConfig(env: Environment, cwd = process.cwd()) {
  const directory = resolve(
    cwd,
    environmentValue(env, "NAVIGATOR_DATA_DIR") ?? ".navigator-api",
  );
  const models = resolve(
    cwd,
    environmentValue(env, "NAVIGATOR_MODELS") ?? "assets/models",
  );
  const port = parsePort(environmentValue(env, "NAVIGATOR_PORT"), 8787);
  const origins = parseOrigins(env, "NAVIGATOR_EXTENSION_ORIGINS", false);
  return {
    directory,
    connectionPath: resolve(directory, "connection.json"),
    database: resolve(directory, "navigator.sqlite"),
    models,
    origins,
    listen: { host: "127.0.0.1", port },
  };
}

export function validatePrivateConnection(value: unknown): {
  token: string;
  origins: string[];
} {
  if (!value || typeof value !== "object")
    throw new Error("Invalid private API connection settings.");
  const connection = value as Record<string, unknown>;
  return {
    token: validateToken(connection.token),
    origins: validateOrigins(connection.origins, false),
  };
}

function parseIdentityConfig(env: Environment): IdentityOptions | undefined {
  const issuer = environmentValue(env, "THOLI_IDENTITY_ISSUER");
  if (!issuer) {
    if (
      Object.entries(env).some(
        ([key, value]) => key.startsWith("THOLI_IDENTITY_") && value,
      )
    )
      throw new Error("Incomplete service identity configuration.");
    return undefined;
  }
  const need = (name: string) => {
    const value = environmentValue(env, name);
    if (!value) throw new Error(`Missing ${name}.`);
    return value;
  };
  const webOrigin = need("THOLI_IDENTITY_WEB_ORIGIN");
  const publicOrigin = need("THOLI_SERVICE_PUBLIC_ORIGIN");
  if (!identityOriginSchema.safeParse(publicOrigin).success)
    throw new Error("The public service URL must be an exact origin.");
  const clients: IdentityOptions["clients"][number][] = [
    {
      id: "web",
      kind: "web",
      redirectUris: [`${webOrigin}/account`, `${webOrigin}/download`],
    },
  ];
  for (const [id, name] of [
    ["extension-chromium", "THOLI_IDENTITY_CHROMIUM_CALLBACKS"],
    ["extension-firefox", "THOLI_IDENTITY_FIREFOX_CALLBACKS"],
  ]) {
    const redirects = env[name]
      ?.split(",")
      .map((value) => value.trim())
      .filter(Boolean);
    if (redirects?.length)
      clients.push({ id, kind: "extension", redirectUris: redirects });
  }
  const customClients = environmentValue(env, "THOLI_IDENTITY_CLIENTS");
  let selectedClients = clients;
  if (customClients) {
    try {
      selectedClients = JSON.parse(customClients);
    } catch {
      throw new Error("Invalid registered identity clients.");
    }
  }
  const lifetime = (name: string, fallback: number) => {
    const value = environmentValue(env, name);
    return value === undefined
      ? fallback
      : /^\d+$/.test(value)
        ? Number(value)
        : NaN;
  };
  return validateIdentityOptions({
    issuer,
    authorizationEndpoint: need("THOLI_IDENTITY_AUTHORIZATION_ENDPOINT"),
    tokenEndpoint: need("THOLI_IDENTITY_TOKEN_ENDPOINT"),
    jwksUri: need("THOLI_IDENTITY_JWKS_URI"),
    endSessionEndpoint: need("THOLI_IDENTITY_LOGOUT_ENDPOINT"),
    clientId: need("THOLI_IDENTITY_CLIENT_ID"),
    clientSecret: need("THOLI_IDENTITY_CLIENT_SECRET_KEY"),
    callbackUrl: `${publicOrigin}/api/v1/auth/callback`,
    webOrigin,
    clients: selectedClients,
    flowEncryptionKey: need("THOLI_IDENTITY_FLOW_SECRET_KEY"),
    secureCookies: env.NODE_ENV !== "development",
    requireVerifiedEmail: true,
    accessLifetimeMs: lifetime("THOLI_IDENTITY_ACCESS_LIFETIME_MS", 5 * 60000),
    sessionLifetimeMs: lifetime(
      "THOLI_IDENTITY_SESSION_LIFETIME_MS",
      12 * 60 * 60000,
    ),
  });
}

export function parseServiceConfig(env: Environment) {
  // This composition root has no live model adapter yet. Fail closed instead of
  // accepting an opt-in flag or a budget that this version cannot enforce.
  const model = environmentValue(env, "THOLI_MODEL_PROVIDER") ?? "fake";
  if (model !== "fake")
    throw new Error(
      "Only the cloud-free fake model policy is available. Live inference and enforced spending limits require the model adapter milestone (#39).",
    );
  const platformPort = environmentValue(env, "PORT");
  const servicePort = environmentValue(env, "THOLI_SERVICE_PORT");
  if (
    platformPort !== undefined &&
    servicePort !== undefined &&
    parsePort(platformPort, 8788) !== parsePort(servicePort, 8788)
  )
    throw new Error(
      "PORT and THOLI_SERVICE_PORT must agree when both are set.",
    );
  const identity = parseIdentityConfig(env);
  return {
    options: validateServiceOptions({
      origins: parseOrigins(env, "THOLI_SERVICE_ORIGINS", true) ?? [],
      ...(identity ? { identity, database: parseDatabaseConfig(env) } : {}),
    }),
    listen: {
      host: parseHost(environmentValue(env, "THOLI_SERVICE_HOST")),
      port: parsePort(servicePort ?? platformPort, 8788),
    },
  };
}
