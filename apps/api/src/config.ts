import { BlockList, isIP } from "node:net";
import { isAbsolute, resolve } from "node:path";
import { z } from "zod";
import type { DatabaseOptions } from "./database/postgres";
import type { IdentityOptions } from "./application/identity-contracts";
import type {
  ObjectStorageOptions,
  SmtpOptions,
  SupportOptions,
} from "./application/support-contracts";
import { SUPPORT_LIMITS } from "../../../packages/navigation-core/contracts-support";
import { SERVICE_LIMITS } from "../../../packages/navigation-core/contracts-service";
import {
  OBSERVABILITY_DEFAULTS,
  validateObservabilityOptions,
  type ObservabilityOptions,
} from "./application/observability";
import {
  MODEL_LIMITS,
  resolveModelBudget,
  type ModelBudget,
} from "./application/model-contracts";
import {
  validateVertexModelOptions,
  type VertexModelOptions,
} from "./adapters/vertex-navigation-model";

export interface ApiOptions {
  token: string;
  origins: string[];
  database: string;
  models: string;
  worker?: URL;
}

export interface ServiceApiOptions {
  origins: string[];
  observability?: ObservabilityOptions;
  transport?: Partial<ServiceTransportPolicy>;
  identity?: IdentityOptions;
  database?: DatabaseOptions;
  support?: SupportRuntimeOptions;
  navigation?: { provider: "fake" };
}

/** Replica-local delivery limits, separate from identity, account and credit authority. */
export interface ServiceTransportPolicy {
  trustedProxies: readonly string[];
  rateLimitMax: number;
  rateLimitWindowMs: number;
  rateLimitMaxClients: number;
  headersTimeoutMs: number;
  requestTimeoutMs: number;
  connectionTimeoutMs: number;
  keepAliveTimeoutMs: number;
  maxRequestsPerSocket: number;
  maxHeaderBytes: number;
}

export const SERVICE_TRANSPORT_DEFAULTS: Readonly<ServiceTransportPolicy> =
  Object.freeze({
    trustedProxies: Object.freeze([]),
    rateLimitMax: 300,
    rateLimitWindowMs: 60000,
    rateLimitMaxClients: 4096,
    headersTimeoutMs: 10000,
    requestTimeoutMs: 30000,
    connectionTimeoutMs: 35000,
    keepAliveTimeoutMs: 5000,
    maxRequestsPerSocket: 100,
    maxHeaderBytes: 16384,
  });

export function validateServiceTransportPolicy(
  input: Partial<ServiceTransportPolicy> = {},
): ServiceTransportPolicy {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid service transport policy.");
  const parsed = z
    .object({
      trustedProxies: z.array(z.string().min(1).max(80)).max(32),
      rateLimitMax: z.number().int().min(1).max(6000),
      rateLimitWindowMs: z.number().int().min(1000).max(60000),
      rateLimitMaxClients: z.number().int().min(1).max(65536),
      headersTimeoutMs: z
        .number()
        .int()
        .min(100)
        .max(SERVICE_LIMITS.maxDeadlineMs),
      requestTimeoutMs: z
        .number()
        .int()
        .min(SERVICE_LIMITS.maxDeadlineMs)
        .max(60000),
      connectionTimeoutMs: z.number().int().min(30000).max(120000),
      keepAliveTimeoutMs: z.number().int().min(100).max(30000),
      maxRequestsPerSocket: z.number().int().min(1).max(1000),
      maxHeaderBytes: z.number().int().min(1024).max(32768),
    })
    .strict()
    .safeParse({ ...SERVICE_TRANSPORT_DEFAULTS, ...input });
  if (!parsed.success) throw new Error("Invalid service transport policy.");
  const policy = parsed.data;
  for (const entry of policy.trustedProxies) {
    const [address, prefix, ...extra] = entry.split("/");
    const family = isIP(address);
    if (
      !family ||
      extra.length ||
      (prefix !== undefined &&
        (!/^(0|[1-9]\d{0,2})$/.test(prefix) ||
          Number(prefix) < (family === 4 ? 8 : 32) ||
          Number(prefix) > (family === 4 ? 32 : 128)))
    )
      throw new Error(
        "Trusted proxies must be bounded literal IP addresses or CIDRs.",
      );
    // IPv6 prefixes containing every mapped IPv4 address are also catch-alls.
    if (family === 6 && prefix !== undefined && Number(prefix) < 104) {
      const range = new BlockList();
      range.addSubnet(address, Number(prefix), "ipv6");
      if (range.check("::ffff:0:0", "ipv6"))
        throw new Error(
          "Trusted proxy ranges cannot include all IPv4 addresses.",
        );
    }
  }
  if (new Set(policy.trustedProxies).size !== policy.trustedProxies.length)
    throw new Error("Trusted proxy entries must be distinct.");
  return policy;
}

export interface SupportRuntimeOptions {
  options: SupportOptions;
  objects: ObjectStorageOptions;
  fileLinkSecret: string;
}

export interface ListenOptions {
  host: string;
  port: number;
}

export type Environment = Readonly<Record<string, string | undefined>>;

export type ModelExperimentConfig = {
  budget: ModelBudget;
  timeoutMs: number;
} & (
  | { provider: "fake" }
  | { provider: "vertex"; options: VertexModelOptions; stateDirectory: string }
);

/** Explicit experiment composition; ordinary HTTP/Compose remains cloud-free. */
export function parseModelExperimentConfig(
  env: Environment,
): ModelExperimentConfig {
  const provider = environmentValue(env, "THOLI_MODEL_PROVIDER") ?? "fake";
  if (provider !== "fake" && provider !== "vertex")
    throw new Error("Unsupported model experiment provider.");
  const suffixes = {
    maxInputTokens: "MAX_INPUT_TOKENS",
    maxOutputTokens: "MAX_OUTPUT_TOKENS",
    maxResponseBytes: "MAX_RESPONSE_BYTES",
    maxImages: "MAX_IMAGES",
    maxImageBytes: "MAX_IMAGE_BYTES",
    maxImagePixels: "MAX_IMAGE_PIXELS",
  } as const;
  const budget = resolveModelBudget(
    Object.fromEntries(
      Object.entries(suffixes).map(([key, suffix]) => [
        key,
        environmentBudget(
          env,
          `THOLI_MODEL_${suffix}`,
          MODEL_LIMITS[key as keyof typeof suffixes],
          key === "maxImages" ? 0 : 1,
          MODEL_LIMITS[key as keyof typeof suffixes],
        ),
      ]),
    ),
  );
  const timeoutMs = environmentBudget(
    env,
    "THOLI_MODEL_TIMEOUT_MS",
    20000,
    1000,
    MODEL_LIMITS.maxDeadlineMs,
  );
  if (provider === "fake") return { provider, budget, timeoutMs };
  const options = validateVertexModelOptions({
    api: requiredEnvironment(env, "THOLI_MODEL_API"),
    project: requiredEnvironment(env, "THOLI_MODEL_PROJECT"),
    location: requiredEnvironment(env, "THOLI_MODEL_REGION"),
    model: requiredEnvironment(env, "THOLI_MODEL_ID"),
    retentionProfile: requiredEnvironment(env, "THOLI_MODEL_RETENTION_PROFILE"),
  });
  const configuredState = requiredEnvironment(
    env,
    "THOLI_MODEL_EXPERIMENT_STATE_DIR",
  );
  if (!isAbsolute(configuredState))
    throw new Error("Model experiment state requires an absolute directory.");
  const stateDirectory = resolve(configuredState);
  return { provider, options, budget, timeoutMs, stateDirectory };
}

/** Explicit, bounded telemetry. Ambient provider credentials and metadata are ignored. */
export function parseObservabilityConfig(
  env: Environment,
  service: ObservabilityOptions["service"],
): ObservabilityOptions | undefined {
  const enabled = env.THOLI_OBSERVABILITY_ENABLED;
  if (enabled !== undefined && !["true", "false"].includes(enabled))
    throw new Error("Invalid observability availability configuration.");
  if (enabled !== "true") return undefined;
  const local = env.THOLI_OTLP_ALLOW_LOCAL;
  if (local !== undefined && !["true", "false"].includes(local))
    throw new Error("Invalid local telemetry configuration.");
  if (local === "true" && env.NODE_ENV !== "development")
    throw new Error(
      "Local telemetry requires the explicit development profile.",
    );
  return validateObservabilityOptions({
    ...OBSERVABILITY_DEFAULTS,
    enabled: true,
    service,
    ...(env.THOLI_OTLP_ENDPOINT
      ? { otlpEndpoint: env.THOLI_OTLP_ENDPOINT }
      : {}),
    allowLocal: local === "true",
  });
}

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
  const transport = validateServiceTransportPolicy(options.transport);
  const observability = options.observability
    ? validateObservabilityOptions(options.observability, "tholi-api")
    : undefined;
  let navigation: ServiceApiOptions["navigation"];
  if (options.navigation !== undefined) {
    const parsed = z
      .object({ provider: z.literal("fake") })
      .strict()
      .safeParse(options.navigation);
    if (!parsed.success)
      throw new Error("Invalid navigation transport configuration.");
    navigation = parsed.data;
  }
  if (!!options.identity !== !!options.database)
    throw new Error(
      "Identity requires explicit service database configuration.",
    );
  if (!options.identity) {
    if (navigation)
      throw new Error(
        "Navigation transport requires the composed identity profile.",
      );
    if (options.support)
      throw new Error("Support requires the composed identity profile.");
    return { origins, transport, ...(observability ? { observability } : {}) };
  }
  const identity = validateIdentityOptions(options.identity);
  if (!origins.includes(identity.webOrigin))
    throw new Error(
      "The identity website must be a configured service origin.",
    );
  if (
    options.support &&
    (options.support.options.publicOrigin !==
      new URL(identity.callbackUrl).origin ||
      options.support.fileLinkSecret === identity.flowEncryptionKey)
  )
    throw new Error(
      "Support requires the configured API origin and a dedicated signing key.",
    );
  return {
    origins,
    transport,
    identity,
    ...(observability ? { observability } : {}),
    database: { ...options.database! },
    ...(navigation ? { navigation } : {}),
    ...(options.support
      ? {
          support: validateSupportRuntime(
            options.support,
            !identity.secureCookies,
          ),
        }
      : {}),
  };
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
const secretKeySchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]{43}$/)
  .refine(
    (value) =>
      Buffer.from(value, "base64url").length === 32 &&
      Buffer.from(value, "base64url").toString("base64url") === value,
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
    flowEncryptionKey: secretKeySchema,
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

function requiredEnvironment(env: Environment, name: string): string {
  const value = environmentValue(env, name);
  if (!value) throw new Error(`Missing ${name}.`);
  return value;
}

function environmentBudget(
  env: Environment,
  name: string,
  fallback: number,
  minimum: number,
  maximum: number,
) {
  const text = environmentValue(env, name);
  const value =
    text === undefined ? fallback : /^\d+$/.test(text) ? Number(text) : NaN;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum)
    throw new Error(`Invalid ${name} budget.`);
  return value;
}

const timeoutSchema = z.number().int().min(1000).max(15000);
const boundedCredential = z
  .string()
  .min(1)
  .max(512)
  .regex(/^[^\r\n\0]+$/);
const mailAddressSchema = z
  .string()
  .email()
  .max(254)
  .regex(/^[^\r\n\0]+$/);
const loopbackHost = (host: string) =>
  ["localhost", "127.0.0.1", "[::1]"].includes(host);

/** Explicit S3-compatible endpoint and credentials, without an ambient cloud chain. */
export function validateObjectStorageOptions(
  input: ObjectStorageOptions,
  allowLocal = false,
): ObjectStorageOptions {
  const parsed = z
    .object({
      endpoint: identityOriginSchema,
      region: z
        .string()
        .min(1)
        .max(80)
        .regex(/^[a-zA-Z0-9-]+$/),
      bucket: z
        .string()
        .min(3)
        .max(63)
        .regex(/^[a-z0-9][a-z0-9.-]*[a-z0-9]$/),
      accessKey: boundedCredential,
      secretKey: boundedCredential,
      maxBytes: z.literal(SUPPORT_LIMITS.maxFileBytes),
      timeoutMs: timeoutSchema,
    })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    throw new Error("Invalid private object storage configuration.");
  const endpoint = new URL(parsed.data.endpoint);
  if (
    endpoint.protocol !== "https:" &&
    !(
      allowLocal &&
      (endpoint.hostname === "storage" || loopbackHost(endpoint.hostname))
    )
  )
    throw new Error(
      "Private object storage requires HTTPS outside local development.",
    );
  return parsed.data;
}

/** Capture is a local-only mode; external SMTP always verifies encrypted transport. */
export function validateSmtpOptions(
  input: SmtpOptions,
  allowLocal = false,
): SmtpOptions {
  const parsed = z
    .object({
      host: z.string().min(1).max(253),
      port: z.number().int().min(1).max(65535),
      secure: z.boolean(),
      requireTLS: z.boolean(),
      from: mailAddressSchema,
      supportRecipient: mailAddressSchema,
      user: boundedCredential.optional(),
      password: boundedCredential.optional(),
      localCapture: z.boolean(),
      timeoutMs: timeoutSchema,
    })
    .strict()
    .safeParse(input);
  if (!parsed.success)
    throw new Error("Invalid notification mail configuration.");
  const value = parsed.data;
  parseHost(value.host);
  if (!!value.user !== !!value.password)
    throw new Error("SMTP credentials must be configured together.");
  if (value.localCapture) {
    if (
      !allowLocal ||
      !(value.host === "mail" || loopbackHost(value.host)) ||
      value.port !== 1025 ||
      value.user ||
      value.secure ||
      value.requireTLS
    )
      throw new Error("Mail capture requires the isolated local SMTP service.");
  } else if (!value.secure && !value.requireTLS) {
    throw new Error("Notification mail requires verified TLS.");
  }
  return value;
}

function validateSupportRuntime(
  input: SupportRuntimeOptions,
  allowLocal: boolean,
): SupportRuntimeOptions {
  const options = z
    .object({
      publicOrigin: identityOriginSchema,
      linkLifetimeMs: z
        .number()
        .int()
        .min(1000)
        .max(SUPPORT_LIMITS.maxLinkLifetimeMs),
    })
    .strict()
    .safeParse(input.options);
  if (
    !options.success ||
    !secretKeySchema.safeParse(input.fileLinkSecret).success
  )
    throw new Error("Invalid support service configuration.");
  const url = new URL(options.data.publicOrigin);
  if (url.protocol !== "https:" && !(allowLocal && loopbackHost(url.hostname)))
    throw new Error(
      "Support service requires HTTPS outside local development.",
    );
  return {
    options: options.data,
    objects: validateObjectStorageOptions(input.objects, allowLocal),
    fileLinkSecret: input.fileLinkSecret,
  };
}

function supportEnabled(env: Environment): boolean {
  const enabled = environmentValue(env, "THOLI_SUPPORT_ENABLED");
  if (enabled !== undefined && !["true", "false"].includes(enabled))
    throw new Error("Invalid support availability configuration.");
  return enabled === "true";
}

function parseObjectStorageConfig(env: Environment) {
  return validateObjectStorageOptions(
    {
      endpoint: requiredEnvironment(env, "THOLI_OBJECT_ENDPOINT"),
      region: requiredEnvironment(env, "THOLI_OBJECT_REGION"),
      bucket: requiredEnvironment(env, "THOLI_OBJECT_BUCKET"),
      accessKey: requiredEnvironment(env, "THOLI_OBJECT_ACCESS_KEY"),
      secretKey: requiredEnvironment(env, "THOLI_OBJECT_SECRET_KEY"),
      maxBytes: SUPPORT_LIMITS.maxFileBytes,
      timeoutMs: environmentBudget(
        env,
        "THOLI_OBJECT_TIMEOUT_MS",
        5000,
        1000,
        15000,
      ),
    },
    env.NODE_ENV === "development",
  );
}

function parseMailConfig(env: Environment) {
  const flag = (name: string, fallback: boolean) => {
    const value = environmentValue(env, name);
    if (value === undefined) return fallback;
    if (!["true", "false"].includes(value)) throw new Error(`Invalid ${name}.`);
    return value === "true";
  };
  return validateSmtpOptions(
    {
      host: requiredEnvironment(env, "THOLI_SMTP_HOST"),
      port: parsePort(environmentValue(env, "THOLI_SMTP_PORT"), 587),
      secure: flag("THOLI_SMTP_SECURE", false),
      requireTLS: flag("THOLI_SMTP_REQUIRE_TLS", true),
      from: requiredEnvironment(env, "THOLI_SMTP_FROM"),
      supportRecipient: requiredEnvironment(
        env,
        "THOLI_SMTP_SUPPORT_RECIPIENT",
      ),
      user: environmentValue(env, "THOLI_SMTP_USER"),
      password: environmentValue(env, "THOLI_SMTP_PASSWORD"),
      localCapture: flag("THOLI_SMTP_LOCAL_CAPTURE", false),
      timeoutMs: environmentBudget(
        env,
        "THOLI_SMTP_TIMEOUT_MS",
        5000,
        1000,
        15000,
      ),
    },
    env.NODE_ENV === "development",
  );
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
  purpose: "runtime" | "migration" | "worker" = "runtime",
): DatabaseOptions {
  const name =
    purpose === "migration"
      ? "THOLI_DATABASE_MIGRATION_URL"
      : purpose === "worker"
        ? "THOLI_DATABASE_WORKER_URL"
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
    maxText === undefined
      ? purpose === "migration"
        ? 1
        : purpose === "worker"
          ? 4
          : 8
      : Number(maxText);
  if (
    !Number.isSafeInteger(max) ||
    max < 1 ||
    max > (purpose === "migration" ? 2 : purpose === "worker" ? 4 : 32)
  )
    throw new Error("Invalid PostgreSQL pool budget.");
  return { connectionString, max };
}

/** Independent worker profile. No identity, HTTP-session or model credentials. */
export function parseWorkerConfig(env: Environment) {
  const budget = (
    name: string,
    fallback: number,
    minimum: number,
    maximum: number,
  ) => {
    return environmentBudget(env, name, fallback, minimum, maximum);
  };
  const leaseMs = budget("THOLI_WORKER_LEASE_MS", 30000, 10000, 120000);
  const heartbeatMs = budget("THOLI_WORKER_HEARTBEAT_MS", 10000, 1000, 30000);
  if (heartbeatMs * 2 >= leaseMs)
    throw new Error("Worker heartbeat must be less than half its lease.");
  return {
    database: parseDatabaseConfig(env, "worker"),
    observability: parseObservabilityConfig(env, "tholi-worker"),
    options: {
      concurrency: budget("THOLI_WORKER_CONCURRENCY", 2, 1, 2),
      pollMs: budget("THOLI_WORKER_POLL_MS", 1000, 100, 10000),
      leaseMs,
      heartbeatMs,
      maxBackoffMs: budget("THOLI_WORKER_MAX_BACKOFF_MS", 60000, 1000, 60000),
      scheduleIntervalMs: budget(
        "THOLI_WORKER_SCHEDULE_MS",
        60000,
        1000,
        3600000,
      ),
    },
    healthFile: environmentValue(env, "THOLI_WORKER_HEALTH_FILE"),
    ...(supportEnabled(env)
      ? {
          support: {
            mail: parseMailConfig(env),
            objects: parseObjectStorageConfig(env),
            allowLocal: env.NODE_ENV === "development",
          },
        }
      : {}),
  };
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
  const need = (name: string) => requiredEnvironment(env, name);
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
  // The operator experiment is separate. HTTP inference requires the explicit
  // authenticated and consented transport milestone before any live adapter.
  const model = environmentValue(env, "THOLI_MODEL_PROVIDER") ?? "fake";
  if (model !== "fake")
    throw new Error(
      "The HTTP service remains cloud-free. Live HTTP adapters require production quota admission; use the separately approved model experiment.",
    );
  const navigation = environmentValue(
    env,
    "THOLI_NAVIGATION_TRANSPORT_ENABLED",
  );
  if (
    navigation !== undefined &&
    navigation !== "true" &&
    navigation !== "false"
  )
    throw new Error("Invalid navigation transport availability configuration.");
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
  const trustedProxies =
    env.THOLI_SERVICE_TRUSTED_PROXIES === ""
      ? undefined
      : environmentValue(env, "THOLI_SERVICE_TRUSTED_PROXIES");
  const identity = parseIdentityConfig(env);
  if (supportEnabled(env) && !identity)
    throw new Error("Support requires the composed identity profile.");
  return {
    options: validateServiceOptions({
      origins: parseOrigins(env, "THOLI_SERVICE_ORIGINS", true) ?? [],
      observability: parseObservabilityConfig(env, "tholi-api"),
      transport: {
        ...Object.fromEntries(
          Object.entries({
            rateLimitMax: "RATE_LIMIT_MAX",
            rateLimitWindowMs: "RATE_LIMIT_WINDOW_MS",
            rateLimitMaxClients: "RATE_LIMIT_MAX_CLIENTS",
            headersTimeoutMs: "HEADERS_TIMEOUT_MS",
            requestTimeoutMs: "REQUEST_TIMEOUT_MS",
            connectionTimeoutMs: "CONNECTION_TIMEOUT_MS",
            keepAliveTimeoutMs: "KEEP_ALIVE_TIMEOUT_MS",
            maxRequestsPerSocket: "MAX_REQUESTS_PER_SOCKET",
            maxHeaderBytes: "MAX_HEADER_BYTES",
          }).map(([key, suffix]) => [
            key,
            environmentBudget(
              env,
              `THOLI_SERVICE_${suffix}`,
              SERVICE_TRANSPORT_DEFAULTS[
                key as keyof Omit<ServiceTransportPolicy, "trustedProxies">
              ],
              1,
              120000,
            ),
          ]),
        ),
        trustedProxies: trustedProxies
          ? trustedProxies.split(",").map((entry) => entry.trim())
          : [],
      },
      ...(identity ? { identity, database: parseDatabaseConfig(env) } : {}),
      ...(navigation === "true"
        ? { navigation: { provider: "fake" as const } }
        : {}),
      ...(supportEnabled(env)
        ? {
            support: {
              options: {
                publicOrigin: requiredEnvironment(
                  env,
                  "THOLI_SERVICE_PUBLIC_ORIGIN",
                ),
                linkLifetimeMs: environmentBudget(
                  env,
                  "THOLI_SUPPORT_LINK_LIFETIME_MS",
                  SUPPORT_LIMITS.maxLinkLifetimeMs,
                  1000,
                  SUPPORT_LIMITS.maxLinkLifetimeMs,
                ),
              },
              objects: parseObjectStorageConfig(env),
              fileLinkSecret: requiredEnvironment(
                env,
                "THOLI_FILE_LINK_SECRET_KEY",
              ),
            },
          }
        : {}),
    }),
    listen: {
      host: parseHost(environmentValue(env, "THOLI_SERVICE_HOST")),
      port: parsePort(servicePort ?? platformPort, 8788),
    },
  };
}
