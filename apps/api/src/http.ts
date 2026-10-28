import Fastify, { type FastifyInstance, type FastifyRequest } from "fastify";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import apiPackage from "../package.json" with { type: "json" };
import type { RuntimeResource } from "./capabilities";

export type ApiProfile = "legacy-private" | "service";

export class ApiError extends Error {
  constructor(
    readonly statusCode: number,
    readonly code: string,
    message: string,
    readonly retryable = false,
  ) {
    super(message);
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
    bodyLimit: (profile === "legacy-private" ? 8 : 0.5) * 1024 * 1024,
    logger: false,
    requestIdHeader: false,
    genReqId: () => randomUUID(),
    ajv: { customOptions: { removeAdditional: false } },
  });
  let draining = false;
  let stopping: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  let stopFailed = false;
  const stop = () => {
    draining = true;
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
            : new ApiError(503, "UNAVAILABLE", "Service unavailable.", true));
    return reply.code(safe.statusCode).send(serviceError(request, safe));
  });
  if (profile === "service") {
    app.addHook("onRequest", async (request, reply) => {
      reply.header("X-Request-Id", request.id);
      reply.header("Cache-Control", "no-store");
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
    const ready = await lifecycle.ready();
    reply.header("Cache-Control", "no-store");
    return reply.code(ready ? 200 : 503).send({
      ...metadata,
      status: ready ? "ready" : "not-ready",
    });
  });
}
