import {
  recognitionInputSchema,
  visualObservationSchema,
  validatePng,
} from "../../../packages/vision/contracts";
import Fastify from "fastify";
import cors from "@fastify/cors";
import swagger from "@fastify/swagger";
import { timingSafeEqual } from "node:crypto";
import { Worker } from "node:worker_threads";
import { resolve } from "node:path";
import { zodToJsonSchema } from "zod-to-json-schema";
import { z } from "zod";
import {
  planInputSchema,
  resultSchema,
  observationInputSchema,
  siteKnowledgeSchema,
} from "../../../packages/navigation-core/contracts";
import {
  savedTaskSchema,
  transitionEvidenceSchema,
  hash,
} from "../../../packages/page-model";
import { SqliteStorage } from "./storage";
import { interpretRequest } from "../../../packages/nlp/interpret";
import {
  planInputV2Schema,
  resultV2Schema,
  observationEnvelopeSchema,
  observationDeltaSchema,
} from "../../../packages/navigation-core/contracts-v2";
import { workflowGuides } from "../../../packages/navigation-core/guides";
const observeSchema = observationInputSchema
  .extend({ transition: transitionEvidenceSchema.optional() })
  .strict();
const originSchema = z.object({ origin: z.string().url().max(300) }).strict();
export interface ApiOptions {
  token: string;
  origins: string[];
  database: string;
  models: string;
  worker?: URL;
}
export async function createApi(options: ApiOptions) {
  if (options.token.length < 32)
    throw new Error("Use a generated token of at least 32 characters.");
  if (
    options.origins.some(
      (origin) => !/^chrome-extension:\/\/[a-p]{32}$/.test(origin),
    )
  )
    throw new Error(
      "CORS origins must explicitly name installed Chrome extensions.",
    );
  const app = Fastify({
    bodyLimit: 8 * 1024 * 1024,
    logger: false,
    ajv: { customOptions: { removeAdditional: false } },
  });
  const store = new SqliteStorage(options.database);
  // Delta assembly is bounded session memory. Only structural knowledge reaches SQLite.
  const observations = new Map<
    string,
    { page: import("../../../packages/page-model").PageSnapshot; used: number }
  >();
  const worker = new Worker(
    options.worker || new URL("./inference.js", import.meta.url),
    {
      workerData: {
        database: options.database,
        models: resolve(options.models) + "/",
      },
    },
  );
  const ocrWorker = new Worker(
    new URL("./ocr.js", options.worker || import.meta.url),
    { workerData: { models: resolve(options.models, "../ocr") } },
  );
  const ocrPending = new Map<
    string,
    {
      resolve: (value: unknown) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const failOcr = (error: Error) => {
    for (const p of ocrPending.values()) {
      clearTimeout(p.timer);
      p.reject(error);
    }
    ocrPending.clear();
  };
  ocrWorker.on("message", (m) => {
    const p = ocrPending.get(m.id);
    if (!p) return;
    clearTimeout(p.timer);
    ocrPending.delete(m.id);
    m.error ? p.reject(new Error(m.error)) : p.resolve(m.value);
  });
  ocrWorker.on("error", failOcr);
  ocrWorker.on("exit", () => failOcr(new Error("OCR worker stopped")));
  const recognize = (input: unknown, signal: AbortSignal) =>
    new Promise((resolve, reject) => {
      const id = crypto.randomUUID();
      const cancel = () => {
        const p = ocrPending.get(id);
        if (!p) return;
        clearTimeout(p.timer);
        ocrPending.delete(id);
        ocrWorker.postMessage({ type: "cancel", id });
        reject(new Error("OCR canceled"));
      };
      const timer = setTimeout(cancel, 30000);
      ocrPending.set(id, { resolve, reject, timer });
      signal.addEventListener("abort", cancel, { once: true });
      if (signal.aborted) {
        cancel();
        return;
      }
      ocrWorker.postMessage({ id, input });
    });
  const pending = new Map<
    string,
    {
      resolve: (v: any) => void;
      reject: (e: Error) => void;
      timer: ReturnType<typeof setTimeout>;
    }
  >();
  const fail = (error: Error) => {
    for (const job of pending.values()) {
      clearTimeout(job.timer);
      job.reject(error);
    }
    pending.clear();
  };
  worker.on("message", (m) => {
    const job = pending.get(m.id);
    if (!job) return;
    clearTimeout(job.timer);
    pending.delete(m.id);
    m.error ? job.reject(new Error(m.error)) : job.resolve(m.value);
  });
  worker.on("error", fail);
  worker.on("exit", () => fail(new Error("Inference worker stopped.")));
  const infer = (type: string, input: unknown, signal?: AbortSignal) =>
    new Promise<any>((resolve, reject) => {
      const id = crypto.randomUUID();
      const timer = setTimeout(() => {
        pending.delete(id);
        worker.postMessage({ type: "cancel", id });
        reject(new Error("Indexing timed out. Retry with the same request."));
      }, 120000);
      pending.set(id, { resolve, reject, timer });
      signal?.addEventListener(
        "abort",
        () => {
          const job = pending.get(id);
          if (job) {
            clearTimeout(job.timer);
            pending.delete(id);
            worker.postMessage({ type: "cancel", id });
            reject(new Error("Planning canceled."));
          }
        },
        { once: true },
      );
      if (signal?.aborted) {
        clearTimeout(timer);
        pending.delete(id);
        reject(new Error("Planning canceled."));
        return;
      }
      worker.postMessage({ id, type, input });
    });
  await app.register(cors, {
    origin: (origin, callback) =>
      callback(null, !origin || options.origins.includes(origin)),
    methods: ["GET", "POST", "DELETE"],
    allowedHeaders: ["Authorization", "Content-Type"],
    strictPreflight: true,
  });
  await app.register(swagger, {
    openapi: {
      info: { title: "Internet Navigator single-owner API", version: "0.8.0" },
      components: {
        securitySchemes: { bearer: { type: "http", scheme: "bearer" } },
      },
      security: [{ bearer: [] }],
    },
  });
  app.addHook("onRequest", async (req, reply) => {
    if (req.headers.origin && !options.origins.includes(req.headers.origin))
      return reply.code(403).send({ error: "Origin is not allowed." });
    if (req.method === "OPTIONS") return;
    const supplied = Buffer.from(
        (req.headers.authorization || "").replace(/^Bearer /, ""),
      ),
      expected = Buffer.from(options.token);
    if (
      supplied.length !== expected.length ||
      !timingSafeEqual(supplied, expected)
    )
      return reply.code(401).send({ error: "Bearer token required." });
  });
  app.setErrorHandler((error, _request, reply) => {
    const e = error as Error & { validation?: unknown };
    const invalid = e.validation || error instanceof z.ZodError;
    reply
      .code(invalid ? 400 : 503)
      .send({ error: invalid ? "Invalid API request." : e.message });
  });
  app.get("/v1/health", { schema: { tags: ["capabilities"] } }, async () => ({
    version: "0.9.0",
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
  app.get("/v1/openapi.json", async () => app.swagger());
  app.post(
    "/v1/observations",
    { schema: { body: zodToJsonSchema(observeSchema) } },
    async (req) => {
      const input = observeSchema.parse(req.body);
      await store.observe(input.observation, input.transition);
      return { ok: true, revision: input.observation.revision };
    },
  );
  app.post(
    "/v1/knowledge",
    { schema: { body: zodToJsonSchema(siteKnowledgeSchema) } },
    async (req) => {
      await store.mirror(siteKnowledgeSchema.parse(req.body));
      return { ok: true };
    },
  );
  app.post(
    "/v1/plans",
    {
      schema: {
        body: zodToJsonSchema(planInputSchema),
        response: { 200: zodToJsonSchema(resultSchema) },
      },
    },
    async (req, reply) => {
      const input = planInputSchema.parse(req.body);
      const controller = new AbortController();
      reply.raw.on("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });
      try {
        return resultSchema.parse(
          await infer("plan", input, controller.signal),
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("Indexing timed out")
        )
          throw error;
        const request =
          input.request || interpretRequest(input.text, input.context);
        request.id = input.requestId;
        return resultSchema.parse({
          requestId: input.requestId,
          documentId: input.documentId,
          revision: input.revision,
          status: "pending-indexing",
          request,
          reason:
            "Indexing has not finished. Retry this retained request on the current page.",
          activity: {
            embedded: 0,
            cacheHits: 0,
            llmCalls: 0,
            modelRevision: "751bff37182d3f1213fa05d7196b954e230abad9",
          },
        });
      }
    },
  );
  app.post(
    "/v1/suggestions",
    { schema: { body: zodToJsonSchema(planInputSchema) } },
    async (req) => {
      const input = planInputSchema.parse(req.body);
      return {
        requestId: input.requestId,
        documentId: input.documentId,
        revision: input.revision,
        suggestions: await infer("suggestions", input),
      };
    },
  );
  app.get(
    "/v1/routes",
    { schema: { querystring: zodToJsonSchema(originSchema) } },
    async (req) => ({
      routes: await store.tasks(originSchema.parse(req.query).origin),
    }),
  );
  app.post(
    "/v1/routes",
    { schema: { body: zodToJsonSchema(savedTaskSchema) } },
    async (req) => {
      await store.saveTask(savedTaskSchema.parse(req.body));
      return { ok: true };
    },
  );
  app.delete("/v1/routes/:id", async (req) => {
    const id = z.object({ id: z.string().max(100) }).parse(req.params).id;
    await store.deleteTask(id);
    return { ok: true };
  });
  app.post(
    "/v1/forget",
    { schema: { body: zodToJsonSchema(originSchema) } },
    async (req) => {
      await infer("reset", {});
      await store.forget(originSchema.parse(req.body).origin);
      return { ok: true };
    },
  );
  app.post("/v1/clear", async () => {
    await infer("reset", {});
    await store.clear();
    return { ok: true };
  });
  app.get("/v2/health", { schema: { tags: ["capabilities"] } }, async () => ({
    version: "0.9.0",
    status: "ok",
    protocols: [1, 2],
    capabilities: [
      "continuous-journeys",
      "return-routing",
      "cpu-ocr",
      "contextual-workflows",
      "incremental-observations",
      "session-only-entities",
      "manual-review-verification",
      "cpu-minilm",
    ],
    guides: workflowGuides.map((g) => ({
      id: g.id,
      version: g.version,
      platform: g.platform,
    })),
    llm: false,
  }));
  app.get("/v2/openapi.json", async () => app.swagger());
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
    async (req, reply) => {
      const parsed = recognitionInputSchema.safeParse(req.body);
      if (!parsed.success)
        return reply.code(400).send({ error: "Invalid bounded OCR capture" });
      try {
        validatePng(parsed.data);
      } catch {
        return reply
          .code(400)
          .send({ error: "Invalid PNG or image dimensions" });
      }
      const controller = new AbortController();
      req.raw.once("aborted", () => controller.abort());
      reply.raw.once("close", () => {
        if (!reply.raw.writableFinished) controller.abort();
      });
      try {
        return visualObservationSchema.parse(
          await recognize(parsed.data, controller.signal),
        );
      } catch {
        return reply
          .code(503)
          .send({ error: "OCR unavailable; use browser processing" });
      }
    },
  );

  app.post(
    "/v2/observations",
    {
      schema: {
        body: zodToJsonSchema(
          observationInputSchema
            .or(observationEnvelopeSchema)
            .or(observationDeltaSchema),
        ),
      },
    },
    async (req, reply) => {
      const input = observationInputSchema
        .or(observationEnvelopeSchema)
        .or(observationDeltaSchema)
        .parse(req.body);
      for (const [key, value] of observations)
        if (Date.now() - value.used > 300000) observations.delete(key);
      let page = input.observation;
      if ("upserts" in input) {
        const key = input.documentId + ":" + input.frameId,
          prior = observations.get(key)?.page;
        if (!page) {
          if (!prior || prior.revision !== input.baseRevision)
            return reply.code(409).send({
              error: "Fresh observation required; delta base is stale.",
            });
          const controls = new Map(prior.controls.map((c) => [c.id, c]));
          for (const id of input.removed) controls.delete(id);
          for (const c of input.upserts) controls.set(c.id, c);
          if (controls.size > 600)
            return reply
              .code(409)
              .send({ error: "Send a bounded fresh projection." });
          page = {
            ...prior,
            controls: [...controls.values()],
            revision: input.revision,
            coverage: input.coverage,
            partial: true,
          };
          page.fingerprint = hash(
            prior.fingerprint + "|delta|" + JSON.stringify(page.controls),
          );
          page.stateKey = page.pageKey + ":" + page.fingerprint;
        }
        observations.delete(key);
        observations.set(key, { page, used: Date.now() });
      } else if ("reference" in input) {
        const key = input.reference.documentId + ":" + input.reference.frameId;
        observations.delete(key);
        observations.set(key, { page: page!, used: Date.now() });
      }
      while (observations.size > 32)
        observations.delete(observations.keys().next().value!);
      if (!page)
        return reply.code(400).send({ error: "Observation required." });
      await store.observe(page);
      return { ok: true, revision: page.revision };
    },
  );
  app.post(
    "/v2/knowledge",
    { schema: { body: zodToJsonSchema(siteKnowledgeSchema) } },
    async (req) => {
      await store.mirror(siteKnowledgeSchema.parse(req.body));
      return { ok: true };
    },
  );
  app.post(
    "/v2/plans",
    {
      schema: {
        body: zodToJsonSchema(planInputV2Schema),
        response: { 200: zodToJsonSchema(resultV2Schema) },
      },
    },
    async (req, reply) => {
      const input = planInputV2Schema.parse(req.body),
        controller = new AbortController();
      reply.raw.on("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });
      try {
        return resultV2Schema.parse(
          await infer("plan", input, controller.signal),
        );
      } catch (error) {
        if (
          !(error instanceof Error) ||
          !error.message.includes("Indexing timed out")
        )
          throw error;
        const request =
          input.request ||
          interpretRequest(input.text, input.context, { clauses: true });
        request.id = input.requestId;
        return resultV2Schema.parse({
          requestId: input.requestId,
          documentId: input.documentId,
          revision: input.revision,
          contextRevision: input.contextRevision,
          protocolVersion: 2,
          status: "pending-indexing",
          request,
          workflow: input.workflow,
          reason:
            "Indexing has not finished. Retry this retained request on the current page.",
          activity: {
            embedded: 0,
            cacheHits: 0,
            llmCalls: 0,
            modelRevision: "751bff37182d3f1213fa05d7196b954e230abad9",
          },
        });
      }
    },
  );
  app.post(
    "/v2/suggestions",
    { schema: { body: zodToJsonSchema(planInputV2Schema) } },
    async (req) => {
      const input = planInputV2Schema.parse(req.body);
      return {
        requestId: input.requestId,
        documentId: input.documentId,
        revision: input.revision,
        contextRevision: input.contextRevision,
        suggestions: await infer("suggestions", input),
      };
    },
  );
  app.get(
    "/v2/routes",
    { schema: { querystring: zodToJsonSchema(originSchema) } },
    async (req) => ({
      routes: await store.tasks(originSchema.parse(req.query).origin),
    }),
  );
  app.post(
    "/v2/routes",
    { schema: { body: zodToJsonSchema(savedTaskSchema) } },
    async (req) => {
      await store.saveTask(savedTaskSchema.parse(req.body));
      return { ok: true };
    },
  );
  app.delete("/v2/routes/:id", async (req) => {
    await store.deleteTask(
      z.object({ id: z.string().max(100) }).parse(req.params).id,
    );
    return { ok: true };
  });
  app.post(
    "/v2/forget",
    { schema: { body: zodToJsonSchema(originSchema) } },
    async (req) => {
      const origin = originSchema.parse(req.body).origin;
      for (const [key, value] of observations)
        if (value.page.origin === origin) observations.delete(key);
      await infer("reset", {});
      await store.forget(origin);
      return { ok: true };
    },
  );
  app.post("/v2/clear", async () => {
    observations.clear();
    await infer("reset", {});
    await store.clear();
    return { ok: true };
  });
  app.addHook("onClose", async () => {
    fail(new Error("API closed."));
    failOcr(new Error("API closed"));
    await ocrWorker.terminate();
    await worker.terminate();
    store.close();
  });
  return app;
}
