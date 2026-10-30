import { afterEach, expect, test, vi } from "vitest";
import { get, type ClientRequest } from "node:http";
import type { FastifyInstance } from "fastify";
import type {
  LocalWorkers,
  NavigationRepository,
  PrivateCapabilities,
  RuntimeResource,
} from "../../../apps/api/src/capabilities";
import apiPackage from "../../../apps/api/package.json";
import { createApi, createServiceApi } from "../../../apps/api/src/server";
import { duringServiceRequest } from "../../../apps/api/src/http";
import { createObservability } from "../../../apps/api/src/adapters/observability";
import { OBSERVABILITY_DEFAULTS } from "../../../apps/api/src/application/observability";
import type { NavigationRequest } from "../../../packages/navigation-core/contracts";
import type { WorkflowContext } from "../../../packages/navigation-core/workflow-contracts";
import { MODEL_REVISION } from "../../../packages/nlp/constants";
import { fixture } from "../../integration/nlp/fixtures";

const localRuntime = vi.hoisted(() => ({
  sqliteImport: vi.fn(),
  modelImport: vi.fn(),
  ocrImport: vi.fn(),
  worker: vi.fn(() => {
    throw new Error("This profile must not construct a local model worker.");
  }),
}));
vi.mock("../../../apps/api/src/storage", () => {
  localRuntime.sqliteImport();
  return {
    SqliteStorage: vi.fn(() => {
      throw new Error("This profile must not open SQLite.");
    }),
  };
});
vi.mock("@huggingface/transformers", () => {
  localRuntime.modelImport();
  return { env: {}, pipeline: vi.fn() };
});
vi.mock("tesseract.js", () => {
  localRuntime.ocrImport();
  return { createWorker: vi.fn(), OEM: {}, PSM: {} };
});
vi.mock("node:worker_threads", () => ({ Worker: localRuntime.worker }));

const applications: FastifyInstance[] = [];
test("HTTP correlation reaches nested provider work without recording private request data", async () => {
  const records: string[] = [];
  const observer = createObservability(
    { ...OBSERVABILITY_DEFAULTS, enabled: true, service: "tholi-api" },
    {
      write(value, completed) {
        records.push(value);
        completed();
      },
    },
  );
  const app = track(
    await createServiceApi({ origins: [] }, [], { observability: observer }),
  );
  app.post("/test-correlation", async (request) =>
    duringServiceRequest(request, async () => {
      const span = observer.start("identity.exchange", { provider: "oidc" });
      span.end("error");
      throw new Error("PRIVATE_PROVIDER_BODY_SENTINEL");
    }),
  );
  const response = await app.inject({
    method: "POST",
    url: "/test-correlation?code=PRIVATE_AUTHCODE_SENTINEL",
    headers: { authorization: "Bearer PRIVATE_CREDENTIAL_SENTINEL" },
    payload: {
      screenshot: "PRIVATE_IMAGE_SENTINEL",
      goal: "PRIVATE_GOAL_SENTINEL",
    },
  });
  expect(response.statusCode).toBe(500);
  await app.close();
  const parsed = records
    .join("")
    .trim()
    .split("\n")
    .map((value) => JSON.parse(value));
  const http = parsed.find((record) => record.operation === "http.request");
  const provider = parsed.find(
    (record) => record.operation === "identity.exchange",
  );
  expect(http.correlation.requestId).toBe(response.headers["x-request-id"]);
  expect(provider.correlation.requestId).toBe(http.correlation.requestId);
  expect(provider.correlation.traceId).toBe(http.correlation.traceId);
  expect(provider.parentSpanId).toBe(http.correlation.spanId);
  expect(http).toMatchObject({ outcome: "error", fields: { statusCode: 500 } });
  expect(records.join("")).not.toMatch(
    /PRIVATE_|test-correlation|Bearer|authorization|screenshot|goal/,
  );
});
afterEach(async () => {
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

function track(app: FastifyInstance) {
  applications.push(app);
  return app;
}

function resource(name = "database"): RuntimeResource {
  return {
    name,
    ready: vi.fn(() => true),
    stop: vi.fn(),
    close: vi.fn(),
  };
}

function privateCapabilities(): PrivateCapabilities {
  const repository: NavigationRepository = {
    get: vi.fn(async () => undefined),
    observe: vi.fn(async () => {
      throw new Error("No observation is expected in this profile test.");
    }),
    mirror: vi.fn(async () => {}),
    tasks: vi.fn(async () => []),
    saveTask: vi.fn(async () => {}),
    deleteTask: vi.fn(async () => {}),
    forget: vi.fn(async () => {}),
    clear: vi.fn(async () => {}),
  };
  const workers: LocalWorkers = {
    ...resource("local-workers"),
    infer: vi.fn(async () => undefined),
    recognize: vi.fn(async () => {
      throw new Error("No OCR is expected in this profile test.");
    }),
  };
  return { repository, workers, resources: [workers] };
}

function expectNoLocalRuntime() {
  expect(localRuntime.sqliteImport).not.toHaveBeenCalled();
  expect(localRuntime.modelImport).not.toHaveBeenCalled();
  expect(localRuntime.ocrImport).not.toHaveBeenCalled();
  expect(localRuntime.worker).not.toHaveBeenCalled();
}

test("service health starts independently of private storage and model runtimes", async () => {
  const app = track(await createServiceApi({ origins: [] }));
  const live = await app.inject({ url: "/health/live" });
  expect(live.statusCode).toBe(200);
  expect(live.json()).toMatchObject({
    status: "ok",
    profile: "service",
    version: apiPackage.version,
    capabilities: [],
  });
  const ready = await app.inject({ url: "/health/ready" });
  expect(ready.statusCode).toBe(200);
  expect(ready.json()).toMatchObject({
    status: "ready",
    profile: "service",
    version: apiPackage.version,
  });
  for (const url of ["/v1/health", "/v2/health", "/v1/openapi.json"]) {
    const unavailable = await app.inject({
      url,
      headers: { authorization: "Bearer " + "a".repeat(64) },
    });
    expect(unavailable.statusCode).toBe(404);
    expect(unavailable.json()).toMatchObject({
      error: {
        code: "NOT_FOUND",
        requestId: expect.any(String),
        retryable: false,
      },
    });
  }
  expectNoLocalRuntime();
});

test("service health uses only configured exact website origins", async () => {
  const app = track(await createServiceApi({ origins: ["https://tholi.io"] }));
  const allowed = await app.inject({
    url: "/health/live",
    headers: { origin: "https://tholi.io" },
  });
  expect(allowed.statusCode).toBe(200);
  expect(allowed.headers["access-control-allow-origin"]).toBe(
    "https://tholi.io",
  );
  for (const origin of [
    "https://tholi.io.evil.test",
    "http://tholi.io",
    "https://unlisted.test",
  ]) {
    const rejected = await app.inject({
      url: "/health/live",
      headers: { origin },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.json()).toMatchObject({
      error: { code: "FORBIDDEN", retryable: false },
    });
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
  }
  const noOrigins = track(await createServiceApi({ origins: [] }));
  expect(
    (
      await noOrigins.inject({
        url: "/health/live",
        headers: { origin: "https://tholi.io" },
      })
    ).statusCode,
  ).toBe(403);
});

test("liveness avoids dependency probes while readiness fails safely", async () => {
  const dependency = resource();
  const ready = vi.mocked(dependency.ready);
  const app = track(await createServiceApi({ origins: [] }, [dependency]));
  const initialCalls = ready.mock.calls.length;
  expect((await app.inject({ url: "/health/live" })).statusCode).toBe(200);
  expect(ready).toHaveBeenCalledTimes(initialCalls);
  ready.mockReturnValue(false);
  const unavailable = await app.inject({ url: "/health/ready" });
  expect(unavailable.statusCode).toBe(503);
  expect(unavailable.json()).toMatchObject({ status: "not-ready" });
  const secret = "database-password-and-provider-token-must-stay-private";
  ready.mockImplementation(() => {
    throw new Error(secret);
  });
  const failed = await app.inject({ url: "/health/ready" });
  expect(failed.statusCode).toBe(503);
  expect(failed.json()).toMatchObject({ status: "not-ready" });
  expect(failed.body).not.toContain(secret);
  ready.mockReturnValue(true);
  expect((await app.inject({ url: "/health/ready" })).statusCode).toBe(200);
});

test("shutdown stops application work before draining active HTTP responses", async () => {
  const events: string[] = [];
  let releaseHandler!: () => void;
  const stopped = new Promise<void>((resolve) => {
    releaseHandler = resolve;
  });
  let reportEntered!: () => void;
  const entered = new Promise<void>((resolve) => {
    reportEntered = resolve;
  });
  const dependencies = ["local-workers", "database"].map((name) => ({
    name,
    ready: vi.fn(() => true),
    stop: vi.fn(async () => {
      events.push(name + ":stop");
      if (name === "local-workers") releaseHandler();
    }),
    close: vi.fn(async () => {
      events.push(name + ":close");
    }),
  }));
  const app = track(await createServiceApi({ origins: [] }, dependencies));
  app.get("/active-work", async () => {
    reportEntered();
    await stopped;
    events.push("handler-released");
    return { stopped: true };
  });
  let request: ClientRequest | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    const deadline = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () =>
          reject(
            new Error("Shutdown did not release active application work."),
          ),
        2000,
      );
    });
    const response = new Promise<{ status: number | undefined; body: string }>(
      (resolve, reject) => {
        request = get(
          address + "/active-work",
          { agent: false },
          (incoming) => {
            let body = "";
            incoming.setEncoding("utf8");
            incoming.on("data", (chunk: string) => {
              body += chunk;
            });
            incoming.on("end", () =>
              resolve({ status: incoming.statusCode, body }),
            );
            incoming.on("error", reject);
          },
        );
        request.on("error", reject);
      },
    );
    void response.catch(() => {});
    await Promise.race([entered, deadline]);
    const [, completed] = await Promise.race([
      Promise.all([app.close(), response]),
      deadline,
    ]);
    expect(completed.status).toBe(503);
    expect(JSON.parse(completed.body)).toMatchObject({
      error: { code: "UNAVAILABLE", retryable: true },
    });
    await app.close();
    for (const dependency of dependencies) {
      expect(dependency.stop).toHaveBeenCalledTimes(1);
      expect(dependency.close).toHaveBeenCalledTimes(1);
      expect(events.indexOf(dependency.name + ":stop")).toBeLessThan(
        events.indexOf(dependency.name + ":close"),
      );
    }
    expect(events.indexOf("local-workers:stop")).toBeLessThan(
      events.indexOf("handler-released"),
    );
    expect(events.indexOf("handler-released")).toBeLessThan(
      events.indexOf("local-workers:close"),
    );
  } finally {
    releaseHandler();
    request?.destroy();
    clearTimeout(timer);
    await app.close();
  }
});

test("service errors keep status, correlation and safe structured messages", async () => {
  const app = track(await createServiceApi({ origins: [] }));
  const secret = "private-database-url-and-raw-model-response";
  app.get("/unexpected-error", async () => {
    throw new Error(secret);
  });
  app.post(
    "/validated-command",
    {
      schema: {
        body: {
          type: "object",
          required: ["count"],
          properties: { count: { type: "integer", minimum: 0 } },
          additionalProperties: false,
        },
      },
    },
    async () => ({ ok: true }),
  );
  const invalid = await app.inject({
    method: "POST",
    url: "/validated-command",
    payload: { count: -1 },
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.json()).toMatchObject({
    error: {
      code: expect.any(String),
      message: expect.any(String),
      requestId: expect.any(String),
      retryable: false,
    },
  });
  const unexpected = await app.inject({ url: "/unexpected-error" });
  expect(unexpected.statusCode).toBe(500);
  expect(unexpected.json()).toMatchObject({
    error: {
      code: "INTERNAL_ERROR",
      message: expect.any(String),
      requestId: expect.any(String),
      retryable: false,
    },
  });
  expect(unexpected.body).not.toContain(secret);
  expect(unexpected.json().error.requestId).not.toBe(
    invalid.json().error.requestId,
  );
});

test("injected private capabilities retain private authentication and OpenAPI contracts", async () => {
  const token = "a".repeat(64);
  const origin = "chrome-extension://" + "a".repeat(32);
  const capabilities = privateCapabilities();
  const app = track(
    await createApi(
      { token, origins: [origin], database: "unused.sqlite", models: "unused" },
      capabilities,
    ),
  );
  const headers = { authorization: "Bearer " + token, origin };
  for (const version of [1, 2]) {
    const unauthenticated = await app.inject({ url: `/v${version}/health` });
    expect(unauthenticated.statusCode).toBe(401);
    expect(unauthenticated.headers["cache-control"]).toBe("no-store");
    expect(unauthenticated.json()).toEqual({ error: "Bearer token required." });
    const health = await app.inject({ url: `/v${version}/health`, headers });
    expect(health.statusCode).toBe(200);
    expect(health.headers["cache-control"]).toBe("no-store");
    expect(health.json()).toMatchObject({
      version: apiPackage.version,
      llm: false,
    });
    const specification = await app.inject({
      url: `/v${version}/openapi.json`,
      headers,
    });
    expect(specification.statusCode).toBe(200);
    expect(specification.headers["cache-control"]).toBe("no-store");
    expect(specification.json().info).toMatchObject({
      title: "Tholi single-owner API",
      version: apiPackage.version,
    });
    expect(specification.json().paths[`/v${version}/plans`]).toBeDefined();
  }
  const forbidden = await app.inject({
    url: "/v1/health",
    headers: { ...headers, origin: "https://tholi.io" },
  });
  expect(forbidden.statusCode).toBe(403);
  expect(forbidden.headers["cache-control"]).toBe("no-store");
  expect(forbidden.json()).toEqual({ error: "Origin is not allowed." });
  const invalid = await app.inject({
    method: "POST",
    url: "/v1/observations",
    headers,
    payload: {},
  });
  expect(invalid.statusCode).toBe(400);
  expect(invalid.headers["cache-control"]).toBe("no-store");
  expect(invalid.json()).toEqual({ error: "Invalid API request." });
  expect(capabilities.workers.infer).not.toHaveBeenCalled();
  expect(capabilities.workers.recognize).not.toHaveBeenCalled();
  expectNoLocalRuntime();
});

test.each([1, 2] as const)(
  "v%i indexing timeout retains the request and matching identity stamps",
  async (version) => {
    const token = "a".repeat(64);
    const origin = "chrome-extension://" + "a".repeat(32);
    const capabilities = privateCapabilities();
    vi.mocked(capabilities.workers.infer).mockRejectedValue(
      new Error("Indexing timed out. Retry with the same request."),
    );
    const app = track(
      await createApi(
        {
          token,
          origins: [origin],
          database: "unused.sqlite",
          models: "unused",
        },
        capabilities,
      ),
    );
    const requestId = crypto.randomUUID();
    const retained: NavigationRequest = {
      id: requestId,
      original: "Find Languages",
      tasks: [
        {
          id: crypto.randomUUID(),
          original: "Find Languages",
          operation: "locate",
          target: "Languages",
          qualifiers: [],
          exclusions: [],
          scope: "page",
          status: "active",
        },
      ],
      active: 0,
      status: "active",
      createdAt: 1700000000000,
    };
    const workflow: WorkflowContext = {
      id: crypto.randomUUID(),
      requestTaskId: retained.tasks[0].id,
      guideId: "retained-guide",
      guideVersion: "1",
      original: retained.original,
      objective: "Find Languages",
      outcome: "locate",
      revision: 17,
      entities: [],
      exclusions: [],
      activeMilestone: 0,
      verified: [],
      status: "waiting",
      reason: "Waiting for indexing.",
    };
    const observation = fixture();
    const stamps = {
      requestId,
      documentId: "retained-native-document",
      revision: 1,
    };
    const input = {
      ...stamps,
      text: retained.original,
      observation,
      request: retained,
      strategy: "fastest",
      ...(version === 2
        ? { protocolVersion: 2, contextRevision: 17, workflow }
        : {}),
    };
    const response = await app.inject({
      method: "POST",
      url: `/v${version}/plans`,
      headers: { authorization: "Bearer " + token, origin },
      payload: input,
    });
    expect(response.statusCode, response.body).toBe(200);
    const pending = response.json();
    expect(pending).toMatchObject({
      ...stamps,
      status: "pending-indexing",
      request: retained,
      activity: {
        embedded: 0,
        cacheHits: 0,
        llmCalls: 0,
        modelRevision: MODEL_REVISION,
      },
    });
    expect(pending.reason).toContain("Retry this retained request");
    expect(pending.plan).toBeUndefined();
    if (version === 2)
      expect(pending).toMatchObject({
        protocolVersion: 2,
        contextRevision: 17,
        workflow,
      });
    else {
      expect(pending.protocolVersion).toBeUndefined();
      expect(pending.contextRevision).toBeUndefined();
    }
    expect(capabilities.workers.infer).toHaveBeenCalledExactlyOnceWith(
      "plan",
      expect.objectContaining(input),
      expect.any(AbortSignal),
    );
    expectNoLocalRuntime();
  },
  15000,
);
