import type { z } from "zod";
import {
  SERVICE_LIMITS,
  SERVICE_TIMEOUT_HEADER,
  serviceErrorEnvelopeSchema,
  serviceTimeoutSchema,
} from "./contracts-service";
import { NAVIGATION_TRANSPORT_LIMITS } from "./contracts-navigation";
import { awaitAbortableOperation } from "./abort";

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
  profile?: "navigation";
  timeoutMs?: number;
  beforeSend?: () => Promise<void>;
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
  const navigation = options.profile === "navigation";
  if (
    target.origin !== base ||
    !target.pathname.startsWith("/api/v1/") ||
    target.hash ||
    (options.profile !== undefined && !navigation) ||
    (navigation &&
      (options.method !== "POST" ||
        target.search !== "" ||
        !/^\/api\/v1\/workspaces\/[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}\/decisions$/i.test(
          target.pathname,
        )))
  )
    throw new ServiceClientError(
      "INVALID_REQUEST",
      0,
      "Invalid service request.",
    );
  let body: string | undefined;
  try {
    body =
      options.body === undefined ? undefined : JSON.stringify(options.body);
  } catch {
    throw new ServiceClientError(
      "INVALID_REQUEST",
      0,
      "The service request is invalid.",
    );
  }
  const limits = navigation
    ? NAVIGATION_TRANSPORT_LIMITS
    : {
        maxBodyBytes: SERVICE_LIMITS.maxBodyBytes,
        maxResponseBytes: SERVICE_LIMITS.maxBodyBytes,
      };
  if (body && new TextEncoder().encode(body).byteLength > limits.maxBodyBytes)
    throw new ServiceClientError(
      "PAYLOAD_TOO_LARGE",
      0,
      navigation
        ? "The guidance request is too large."
        : "The account request is too large.",
    );
  const timeout = serviceTimeoutSchema.safeParse(
    options.timeoutMs ?? SERVICE_LIMITS.maxDeadlineMs,
  );
  if (!timeout.success)
    throw new ServiceClientError(
      "INVALID_REQUEST",
      0,
      "The service deadline is invalid.",
    );
  const deadline = AbortSignal.timeout(timeout.data);
  const expiresAt = performance.now() + timeout.data;
  const signal = AbortSignal.any([
    deadline,
    ...(options.signal ? [options.signal] : []),
  ]);
  let response: Response;
  let text = "";
  const interrupted = () =>
    new ServiceClientError(
      navigation && deadline.aborted && !options.signal?.aborted
        ? "DEADLINE_EXCEEDED"
        : "CANCELLED",
      0,
      navigation
        ? "The guidance request was cancelled or expired. Refresh Tholi before trying again."
        : "The account request was cancelled. Try again when you are ready.",
    );
  try {
    response = await awaitAbortableOperation(
      async () => {
        await options.beforeSend?.();
        signal.throwIfAborted();
        const remainingMs = Math.floor(expiresAt - performance.now());
        if (remainingMs <= 0)
          throw new ServiceClientError(
            "DEADLINE_EXCEEDED",
            0,
            "The service request expired before it could be sent.",
          );
        return fetch(target.href, {
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
            ...(options.timeoutMs === undefined
              ? {}
              : { [SERVICE_TIMEOUT_HEADER]: String(remainingMs) }),
          },
        });
      },
      signal,
      interrupted,
    );
    if (
      navigation &&
      (response.redirected ||
        !/^application\/json(?:\s*;|$)/i.test(
          response.headers.get("content-type") ?? "",
        ))
    ) {
      void response.body?.cancel().catch(() => {});
      throw new ServiceClientError(
        "INVALID_RESPONSE",
        response.status,
        "The guidance service returned an invalid response.",
      );
    }
    const reader = response.body?.getReader();
    if (!reader) throw new Error("Missing account response.");
    const decoder = new TextDecoder("utf-8", { fatal: navigation });
    let bytes = 0;
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    try {
      for (;;) {
        const chunk = await awaitAbortableOperation(
          () => reader.read(),
          signal,
          interrupted,
        );
        if (chunk.done) break;
        bytes += chunk.value.byteLength;
        if (bytes > limits.maxResponseBytes)
          throw new Error("Oversized account response.");
        text += decoder.decode(chunk.value, { stream: true });
      }
      text += decoder.decode();
    } finally {
      signal.removeEventListener("abort", cancel);
      cancel();
      reader.releaseLock();
    }
    if (signal.aborted) throw interrupted();
  } catch (error) {
    if (signal.aborted) throw interrupted();
    if (error instanceof ServiceClientError) throw error;
    throw new ServiceClientError(
      "UNAVAILABLE",
      0,
      navigation
        ? "The guidance service could not be reached."
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
