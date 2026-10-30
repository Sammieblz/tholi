import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import apiPackage from "../package.json" with { type: "json" };
import type { RuntimeResource, ServiceRequestContext } from "./capabilities";
import {
  SERVICE_LIMITS,
  SERVICE_TIMEOUT_HEADER,
  type ServiceErrorCode,
} from "../../../packages/navigation-core/contracts-service";

export type ApiProfile = "legacy-private" | "service";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: ServiceErrorCode,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
  }
}

const requestContexts = new WeakMap<FastifyRequest, ServiceRequestContext>();

/** Bound the response even when an adapter ignores cancellation. It must not be retried blindly. */
export async function duringServiceRequest<T>(
  request: FastifyRequest,
  operation: (context: ServiceRequestContext) => Promise<T> | T,
): Promise<T> {
  const context = requestContexts.get(request);
  if (!context) throw new Error("Service request context is unavailable.");
  context.signal.throwIfAborted();
  let abort!: () => void;
  const interrupted = new Promise<never>((_resolve, reject) => {
    abort = () => reject(context.signal.reason);
    context.signal.addEventListener("abort", abort, { once: true });
  });
  try {
    return await Promise.race([
      Promise.resolve().then(() => {
        context.signal.throwIfAborted();
        return operation(context);
      }),
      interrupted,
    ]);
  } finally {
    context.signal.removeEventListener("abort", abort);
  }
}

function serviceError(request: FastifyRequest, error: ApiError) {
  return {
    error: {
      code: error.code,
      message: error.message,
      requestId: request.id,
      retryable: error.retryable,
    },
  };
}

export async function createHttpApi(
  profile: ApiProfile,
  resources: readonly RuntimeResource[],
  configure: (
    app: FastifyInstance,
    lifecycle: { ready(): Promise<boolean> },
  ) => Promise<void>,
) {
  const app = Fastify({
    bodyLimit:
      profile === "legacy-private"
        ? 8 * 1024 * 1024
        : SERVICE_LIMITS.maxBodyBytes,
    logger: false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    ajv: {
      customOptions: {
        removeAdditional: false,
        ...(profile === "service" ? { coerceTypes: false } : {}),
      },
    },
  });
  let draining = false;
  let stopping: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let stopFailed = false;
  const requests = new Set<AbortController>();
  const stop = () => {
    draining = true;
    for (const request of requests)
      request.abort(
        new ApiError(503, "UNAVAILABLE", "Service is stopping.", true),
      );
    return (stopping ??= Promise.allSettled(
      resources.map((resource) =>
        Promise.resolve().then(() => resource.stop()),
      ),
    ).then((results) => {
      stopFailed = results.some((result) => result.status === "rejected");
    }));
  };
  const close = () =>
    (closing ??= (async () => {
      await stop();
      const errors: unknown[] = [];
      for (const resource of resources) {
        try {
          await resource.close();
        } catch (error) {
          errors.push(error);
        }
      }
      if (stopFailed || errors.length)
        throw new Error("API resource cleanup failed.");
    })());

  // Cancel application work before Fastify waits for in-flight HTTP responses.
  app.addHook("preClose", stop);
  app.addHook("onClose", close);
  app.setErrorHandler((error, request, reply) => {
    if (reply.sent || reply.raw.destroyed) return;
    const caught = error as Error & {
      validation?: unknown;
      statusCode?: number;
    };
    const invalid = caught.validation || error instanceof z.ZodError;
    if (profile === "legacy-private") {
      return reply
        .code(
          error instanceof ApiError ? error.statusCode : invalid ? 400 : 503,
        )
        .send({ error: invalid ? "Invalid API request." : caught.message });
    }
    const known = error instanceof ApiError ? error : undefined;
    const status = Number(caught.statusCode);
    const safe =
      known ??
      (invalid || status === 400
        ? new ApiError(400, "INVALID_REQUEST", "Invalid API request.")
        : status === 413
          ? new ApiError(
              413,
              "PAYLOAD_TOO_LARGE",
              "Request exceeds the size limit.",
            )
          : status === 415
            ? new ApiError(
                415,
                "UNSUPPORTED_MEDIA_TYPE",
                "Unsupported content type.",
              )
            : new ApiError(500, "INTERNAL_ERROR", "Request failed."));
    return reply.code(safe.statusCode).send(serviceError(request, safe));
  });
  if (profile === "service") {
    app.addHook("onRequest", async (request, reply) => {
      reply.header("X-Request-Id", request.id);
      reply.header("Cache-Control", "no-store");
      if (draining)
        throw new ApiError(503, "UNAVAILABLE", "Service is stopping.", true);
      const timeoutHeader = request.headers[SERVICE_TIMEOUT_HEADER];
      if (
        timeoutHeader !== undefined &&
        (typeof timeoutHeader !== "string" ||
          !/^[1-9]\d{0,4}$/.test(timeoutHeader) ||
          Number(timeoutHeader) > SERVICE_LIMITS.maxDeadlineMs)
      )
        throw new ApiError(400, "INVALID_REQUEST", "Invalid API request.");
      const timeout = Math.min(
        timeoutHeader === undefined
          ? SERVICE_LIMITS.defaultDeadlineMs
          : Number(timeoutHeader),
        SERVICE_LIMITS.defaultDeadlineMs,
      );
      const controller = new AbortController();
      const context: ServiceRequestContext = Object.freeze({
        requestId: request.id,
        deadlineAt: Date.now() + timeout,
        signal: controller.signal,
      });
      requestContexts.set(request, context);
      requests.add(controller);
      const timer = setTimeout(() => {
        const error = new ApiError(
          504,
          "DEADLINE_EXCEEDED",
          "Request deadline exceeded.",
        );
        controller.abort(error);
      }, timeout);
      timer.unref();
      const disconnect = () => {
        if (!reply.raw.writableFinished)
          controller.abort(
            new ApiError(499, "CANCELLED", "Request was cancelled."),
          );
        cleanup();
      };
      const cleanup = () => {
        clearTimeout(timer);
        requests.delete(controller);
        request.raw.removeListener("aborted", disconnect);
        reply.raw.removeListener("close", disconnect);
        reply.raw.removeListener("finish", cleanup);
        controller.signal.removeEventListener("abort", interrupt);
      };
      const interrupt = () => {
        const error: unknown = controller.signal.reason;
        // Bound the receive phase too, including shutdown during an incomplete upload.
        if (
          error instanceof ApiError &&
          error.code !== "CANCELLED" &&
          !reply.sent &&
          !reply.raw.destroyed
        )
          reply
            .header("Connection", "close")
            .code(error.statusCode)
            .send(serviceError(request, error));
      };
      controller.signal.addEventListener("abort", interrupt, { once: true });
      request.raw.once("aborted", disconnect);
      reply.raw.once("close", disconnect);
      reply.raw.once("finish", cleanup);
    });
    app.setNotFoundHandler((request, reply) =>
      reply
        .code(404)
        .send(
          serviceError(
            request,
            new ApiError(404, "NOT_FOUND", "Route not found."),
          ),
        ),
    );
  }

  const lifecycle = {
    stop,
    close,
    async ready() {
      if (draining) return false;
      const checks = await Promise.all(
        resources.map(async (resource) => {
          let timer: ReturnType<typeof setTimeout> | undefined;
          try {
            return await Promise.race([
              Promise.resolve().then(() => resource.ready()),
              new Promise<boolean>((resolve) => {
                timer = setTimeout(() => resolve(false), 1000);
              }),
            ]);
          } catch {
            return false;
          } finally {
            clearTimeout(timer);
          }
        }),
      );
      return !draining && checks.every(Boolean);
    },
  };
  try {
    await configure(app, lifecycle);
    return app;
  } catch (error) {
    await app.close().catch(() => {});
    await lifecycle.close().catch(() => {});
    throw error;
  }
}

export function registerHealth(
  app: FastifyInstance,
  profile: ApiProfile,
  lifecycle: { ready(): Promise<boolean> },
) {
  const metadata = { profile, version: apiPackage.version };
  app.get("/health/live", async (_request, reply) => {
    reply.header("Cache-Control", "no-store");
    return { ...metadata, status: "ok", capabilities: [] };
  });
  app.get("/health/ready", async (_request, reply) => {
    const ready =
      profile === "service"
        ? await duringServiceRequest(_request, () => lifecycle.ready())
        : await lifecycle.ready();
    reply.header("Cache-Control", "no-store");
    return reply.code(ready ? 200 : 503).send({
      ...metadata,
      status: ready ? "ready" : "not-ready",
    });
  });
}
