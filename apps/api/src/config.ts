import { isIP } from "node:net";
import { resolve } from "node:path";

export interface ApiOptions {
  token: string;
  origins: string[];
  database: string;
  models: string;
  worker?: URL;
}

export interface ServiceApiOptions {
  origins: string[];
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
  return { origins: validateOrigins(options.origins, true) };
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
  return {
    options: validateServiceOptions({
      origins: parseOrigins(env, "THOLI_SERVICE_ORIGINS", true) ?? [],
    }),
    listen: {
      host: parseHost(environmentValue(env, "THOLI_SERVICE_HOST")),
      port: parsePort(servicePort ?? platformPort, 8788),
    },
  };
}
