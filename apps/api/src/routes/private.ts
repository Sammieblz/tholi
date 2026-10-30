import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { timingSafeEqual } from "node:crypto";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import apiPackage from "../../package.json" with { type: "json" };
import {
  planInputSchema,
  resultSchema,
  observationInputSchema,
  siteKnowledgeSchema,
} from "../../../../packages/navigation-core/contracts";
import {
  planInputV2Schema,
  resultV2Schema,
  observationEnvelopeSchema,
  observationDeltaSchema,
} from "../../../../packages/navigation-core/contracts-v2";
import {
  recognitionInputSchema,
  visualObservationSchema,
  validatePng,
} from "../../../../packages/vision/contracts";
import {
  savedTaskSchema,
  transitionEvidenceSchema,
} from "../../../../packages/page-model";
import { workflowGuides } from "../../../../packages/navigation-core/guides";
import { createNavigationService } from "../application/navigation";
import { registerHealth } from "../http";
import type { ApiOptions } from "../config";
import type { PrivateCapabilities } from "../capabilities";

const observeSchema = observationInputSchema
  .extend({ transition: transitionEvidenceSchema.optional() })
  .strict();
const incrementalSchema = observationInputSchema
  .or(observationEnvelopeSchema)
  .or(observationDeltaSchema);
const originSchema = z.object({ origin: z.string().url().max(300) }).strict();
const routeIdSchema = z.object({ id: z.string().max(100) });

async function duringRequest<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: (signal: AbortSignal) => Promise<T>,
) {
  const controller = new AbortController();
  const abort = () => controller.abort();
  const close = () => {
    if (!reply.raw.writableEnded) controller.abort();
  };
  request.raw.once("aborted", abort);
  reply.raw.once("close", close);
  try {
    return await operation(controller.signal);
  } finally {
    request.raw.removeListener("aborted", abort);
    reply.raw.removeListener("close", close);
  }
}

export async function registerPrivateApi(
  app: FastifyInstance,
  options: ApiOptions,
  capabilities: PrivateCapabilities,
  lifecycle: { ready(): Promise<boolean> },
) {
  const service = createNavigationService(
    capabilities.repository,
    capabilities.workers,
  );
  await app.register(cors, {
    origin: (origin, callback) =>
      callback(null, !origin || options.origins.includes(origin)),
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    strictPreflight: true,
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Tholi single-owner API", version: apiPackage.version },
      components: {
        securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      },
      security: [{ bearer: [] }],
    },
  });
  app.addHook("onRequest", async (request, reply) => {
    reply.header("Cache-Control", "no-store");
    if (
      request.headers.origin &&
      !options.origins.includes(request.headers.origin)
    )
      return reply.code(403).send({ error: "Origin is not allowed." });
    if (request.method === "OPTIONS") return;
    const supplied = Buffer.from(
      (request.headers.authorization || "").replace(/^Bearer /, ""),
    );
    const expected = Buffer.from(options.token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return reply.code(401).send({ error: "Bearer token required." });
  });
  registerHealth(app, "legacy-private", lifecycle);
  app.get("/v1/health", { schema: { tags: ["capabilities"] } }, async () => ({
    version: apiPackage.version,
    status: "ok",
    capabilities: [
      "english-nlp",
      "cpu-minilm",
      "hybrid-retrieval",
      "task-queue",
      "sqlite",
    ],
    llm: false,
  }));
  app.get("/v2/health", { schema: { tags: ["capabilities"] } }, async () => ({
    version: apiPackage.version,
    status: "ok",
    protocols: [1, 2],
    ocrEngines: ["tesseract-6.0.1-eng-fast"],
    capabilities: [
      "continuous-journeys",
      "settings-navigation",
      "return-routing",
      "cpu-ocr",
      "contextual-workflows",
      "incremental-observations",
      "session-only-entities",
      "manual-review-verification",
      "cpu-minilm",
    ],
    guides: workflowGuides.map(({ id, version, platform }) => ({
      id,
      version,
      platform,
    })),
    llm: false,
  }));
  // Both public namespaces use one service and one observation cache.
  for (const version of [1, 2] as const) {
    const prefix = `/v${version}`;
    const planSchema = version === 1 ? planInputSchema : planInputV2Schema;
    const responseSchema = version === 1 ? resultSchema : resultV2Schema;
    app.get(prefix + "/openapi.json", async () => app.swagger());
    app.post(
      prefix + "/observations",
      {
        schema: {
          body: zodToJsonSchema(
            version === 1 ? observeSchema : incrementalSchema,
          ),
        },
      },
      async (request, reply) => {
        if (version === 1) {
          const input = observeSchema.parse(request.body);
          return service.observe(input.observation, input.transition);
        }
        const result = await service.observeIncremental(
          incrementalSchema.parse(request.body),
        );
        if (result.status !== "observed")
          return reply
            .code(result.status === "conflict" ? 409 : 400)
            .send({ error: result.reason });
        return { ok: true, revision: result.revision };
      },
    );
    app.post(
      prefix + "/knowledge",
      { schema: { body: zodToJsonSchema(siteKnowledgeSchema) } },
      async (request) => {
        await service.repository.mirror(
          siteKnowledgeSchema.parse(request.body),
        );
        return { ok: true };
      },
    );
    app.post(
      prefix + "/plans",
      {
        schema: {
          body: zodToJsonSchema(planSchema),
          response: { 200: zodToJsonSchema(responseSchema) },
        },
      },
      async (request, reply) =>
        responseSchema.parse(
          await duringRequest(request, reply, (signal) =>
            service.plan(planSchema.parse(request.body), version, signal),
          ),
        ),
    );
    app.post(
      prefix + "/suggestions",
      { schema: { body: zodToJsonSchema(planSchema) } },
      async (request, reply) =>
        duringRequest(request, reply, (signal) =>
          service.suggestions(planSchema.parse(request.body), version, signal),
        ),
    );
    app.get(
      prefix + "/routes",
      { schema: { querystring: zodToJsonSchema(originSchema) } },
      async (request) => ({
        routes: await service.repository.tasks(
          originSchema.parse(request.query).origin,
        ),
      }),
    );
    app.post(
      prefix + "/routes",
      { schema: { body: zodToJsonSchema(savedTaskSchema) } },
      async (request) => {
        await service.repository.saveTask(savedTaskSchema.parse(request.body));
        return { ok: true };
      },
    );
    app.delete(prefix + "/routes/:id", async (request) => {
      await service.repository.deleteTask(
        routeIdSchema.parse(request.params).id,
      );
      return { ok: true };
    });
    app.post(
      prefix + "/forget",
      { schema: { body: zodToJsonSchema(originSchema) } },
      async (request) =>
        service.forget(originSchema.parse(request.body).origin, version),
    );
    app.post(prefix + "/clear", async () => service.clear(version));
  }
  app.post(
    "/v2/ocr",
    {
      bodyLimit: 6 * 1024 * 1024,
      schema: {
        body: zodToJsonSchema(recognitionInputSchema),
        response: {
          200: zodToJsonSchema(visualObservationSchema),
          400: { type: "object", properties: { error: { type: "string" } } },
          503: { type: "object", properties: { error: { type: "string" } } },
        },
      },
    },
    async (request, reply) => {
      const parsed = recognitionInputSchema.safeParse(request.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid bounded OCR capture" });
      try {
        validatePng(parsed.data);
      } catch {
        return reply
          .code(400)
          .send({ error: "Invalid PNG or image dimensions" });
      }
      try {
        return visualObservationSchema.parse(
          await duringRequest(request, reply, (signal) =>
            capabilities.workers.recognize(parsed.data, signal),
          ),
        );
      } catch {
        return reply
          .code(503)
          .send({ error: "OCR unavailable; use browser processing" });
      }
    },
  );
}
