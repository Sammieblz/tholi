import type { ServiceRequestContext } from "../capabilities";
import {
  MODEL_LIMITS,
  awaitModelOperation,
  type ModelErrorCode,
} from "../application/model-contracts";

export function modelRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Shared deadline, cancellation and bounded decoding for every model transport. */
export function createModelHttp(
  context: ServiceRequestContext,
  failure: (code: ModelErrorCode, retryAfterMs?: number) => Error,
) {
  if (
    !Number.isSafeInteger(context.deadlineAt) ||
    context.deadlineAt <= 0 ||
    !context.signal ||
    typeof context.signal.addEventListener !== "function"
  )
    throw failure("INVALID_INPUT");
  if (context.signal.aborted) throw failure("CANCELLED");
  const remaining = context.deadlineAt - Date.now();
  if (remaining <= 0) throw failure("DEADLINE_EXCEEDED");
  if (remaining > MODEL_LIMITS.maxDeadlineMs) throw failure("BUDGET_EXCEEDED");
  const deadline = new AbortController();
  const timer = setTimeout(() => deadline.abort(), remaining);
  const signal = AbortSignal.any([context.signal, deadline.signal]);
  const current = () => {
    if (context.signal.aborted) throw failure("CANCELLED");
    if (deadline.signal.aborted || Date.now() >= context.deadlineAt)
      throw failure("DEADLINE_EXCEEDED");
  };
  async function within<T>(operation: () => Promise<T>): Promise<T> {
    current();
    const value = await awaitModelOperation(
      () => {
        current();
        return operation();
      },
      signal,
      () => failure(context.signal.aborted ? "CANCELLED" : "DEADLINE_EXCEEDED"),
    );
    current();
    return value;
  }
  async function json(response: Response, maxBytes: number): Promise<unknown> {
    current();
    if (
      response.redirected ||
      !/^application\/json(?:\s*;|$)/i.test(
        response.headers.get("content-type") || "",
      ) ||
      !response.body
    ) {
      void response.body?.cancel().catch(() => {});
      throw failure("INVALID_OUTPUT");
    }
    const reader = response.body.getReader(),
      chunks: Uint8Array[] = [];
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    let bytes = 0;
    try {
      for (;;) {
        const part = await within(() => reader.read());
        if (part.done) break;
        bytes += part.value.byteLength;
        if (bytes > maxBytes) {
          cancel();
          throw failure("BUDGET_EXCEEDED");
        }
        chunks.push(part.value);
      }
      try {
        return JSON.parse(
          new TextDecoder("utf-8", { fatal: true }).decode(
            Buffer.concat(chunks),
          ),
        );
      } catch {
        throw failure("INVALID_OUTPUT");
      }
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
  }
  return { signal, current, within, json, close: () => clearTimeout(timer) };
}

/** Never expose a provider error body or follow its redirect. */
export function checkModelHttpResponse(
  response: Response,
  failure: (code: ModelErrorCode, retryAfterMs?: number) => Error,
) {
  if (response.ok) return;
  void response.body?.cancel().catch(() => {});
  const header = response.headers.get("retry-after");
  const seconds =
    header && /^\d+$/.test(header)
      ? Math.min(60000, Number(header) * 1000)
      : undefined;
  throw failure(
    response.status === 429
      ? "THROTTLED"
      : [401, 403].includes(response.status)
        ? "CONFIGURATION"
        : "UNAVAILABLE",
    seconds,
  );
}
