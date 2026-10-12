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
} from "../../../packages/page-model";
import { SqliteStorage } from "./storage";
import { interpretRequest } from "../../../packages/nlp/interpret";
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
  const app = Fastify({ bodyLimit: 8 * 1024 * 1024, logger: false });
  const store = new SqliteStorage(options.database);
  const worker = new Worker(
    options.worker || new URL("./inference.js", import.meta.url),
    {
      workerData: {
        database: options.database,
        models: resolve(options.models) + "/",
      },
    },
  );
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
      info: { title: "Internet Navigator single-owner API", version: "0.7.0" },
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
    version: "0.7.0",
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
  app.addHook("onClose", async () => {
    fail(new Error("API closed."));
    await worker.terminate();
    store.close();
  });
  return app;
}
