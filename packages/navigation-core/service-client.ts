import type { z } from "zod";
import {
  SERVICE_LIMITS,
  serviceErrorEnvelopeSchema,
} from "./contracts-service";

/** One URL policy for the website configuration and trusted native settings. */
export function serviceOrigin(value: string): string {
  const url = new URL(value);
  if (
    url.origin !== value ||
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
    throw new Error("Use an HTTPS service origin or a loopback HTTP origin.");
  return url.origin;
}

export class ServiceClientError extends Error {
  constructor(
    readonly code: string,
    readonly status: number,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
    this.name = "ServiceClientError";
  }
}

export interface ServiceRequestOptions {
  method?: "GET" | "POST" | "DELETE";
  body?: unknown;
  credentials?: "include" | "omit";
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Storage, cookies and bearer credentials remain with their client-specific owners. */
export async function serviceRequest<T>(
  origin: string,
  path: `/api/v1/${string}`,
  schema: z.ZodType<T>,
  options: ServiceRequestOptions = {},
): Promise<T> {
  const base = serviceOrigin(origin);
  const target = new URL(path, base);
  if (
    target.origin !== base ||
    !target.pathname.startsWith("/api/v1/") ||
    target.hash
  )
    throw new ServiceClientError(
      "INVALID_REQUEST",
      0,
      "Invalid service request.",
    );
  const body =
    options.body === undefined ? undefined : JSON.stringify(options.body);
  if (
    body &&
    new TextEncoder().encode(body).byteLength > SERVICE_LIMITS.maxBodyBytes
  )
    throw new ServiceClientError(
      "PAYLOAD_TOO_LARGE",
      0,
      "The account request is too large.",
    );
  const signal = AbortSignal.any([
    AbortSignal.timeout(SERVICE_LIMITS.maxDeadlineMs),
    ...(options.signal ? [options.signal] : []),
  ]);
  let response: Response;
  let text = "";
  try {
    response = await fetch(target.href, {
      method: options.method ?? "GET",
      body,
      credentials: options.credentials ?? "omit",
      cache: "no-store",
      redirect: "error",
      referrerPolicy: "no-referrer",
      signal,
      headers: {
        Accept: "application/json",
        ...(body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing account response.");
    const decoder = new TextDecoder();
    let bytes = 0;
    try {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > SERVICE_LIMITS.maxBodyBytes)
          throw new Error("Oversized account response.");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
  } catch {
    throw new ServiceClientError(
      signal.aborted ? "CANCELLED" : "UNAVAILABLE",
      0,
      signal.aborted
        ? "The account request was cancelled. Try again when you are ready."
        : "Tholi accounts could not be reached. Local guidance is still available.",
    );
  }
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new ServiceClientError(
      "INVALID_RESPONSE",
      response.status,
      "The account service returned an invalid response.",
    );
  }
  if (!response.ok) {
    const parsed = serviceErrorEnvelopeSchema.safeParse(value);
    throw new ServiceClientError(
      parsed.success ? parsed.data.error.code : "UNAVAILABLE",
      response.status,
      parsed.success
        ? parsed.data.error.message
        : "The account request could not be completed.",
      parsed.success && parsed.data.error.retryable,
    );
  }
  const parsed = schema.safeParse(value);
  if (!parsed.success)
    throw new ServiceClientError(
      "INVALID_RESPONSE",
      response.status,
      "The account response is not supported by this version of Tholi.",
    );
  return parsed.data;
}
