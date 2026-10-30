import {
  get,
  request as openRequest,
  type ClientRequest,
  type IncomingHttpHeaders,
} from "node:http";
import type { FastifyInstance } from "fastify";
import { afterEach, expect, test } from "vitest";
import { zodToJsonSchema } from "zod-to-json-schema";
import apiPackage from "../../../apps/api/package.json";
import { ApiError, duringServiceRequest } from "../../../apps/api/src/http";
import type { ServiceRequestContext } from "../../../apps/api/src/capabilities";
import { createServiceApi } from "../../../apps/api/src/server";
import type { ServiceRouteInventoryEntry } from "../../../apps/api/src/routes/service-inventory";
import {
  SERVICE_CONTRACT_VERSION,
  SERVICE_LIMITS,
  SERVICE_PROTOCOL,
  serviceCapabilitiesSchema,
  serviceAuthIntentSchema,
  serviceCheckoutIntentSchema,
  serviceErrorEnvelopeSchema,
  serviceHandshakeSuccessSchema,
  serviceHandshakeInputSchema,
  serviceInt8Schema,
  serviceQuantitySchema,
  serviceRevisionSchema,
  serviceExpectedRevisionSchema,
  servicePageQuerySchema,
  servicePageSchema,
  serviceSyncQuerySchema,
  serviceRequestPolicySchema,
  serviceRequestMetadataSchema,
} from "../../../packages/navigation-core/contracts-service";

const applications: FastifyInstance[] = [];
const releaseOperations: (() => void)[] = [];
afterEach(async () => {
  for (const release of releaseOperations.splice(0)) release();
  await Promise.all(applications.splice(0).map((app) => app.close()));
});

async function service(origins: string[] = []) {
  const app = await createServiceApi({ origins });
  applications.push(app);
  return app;
}

const handshake = (kind: "extension" | "web" | "desktop" = "extension") => ({
  protocol: SERVICE_PROTOCOL,
  versions: [SERVICE_CONTRACT_VERSION],
  client: { kind, version: "0.11.0" },
});

function expectCorrelation(response: {
  headers: Record<string, unknown>;
  json(): any;
}) {
  expect(response.headers["cache-control"]).toBe("no-store");
  expect(response.headers["x-request-id"]).toMatch(
    /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i,
  );
  const body = response.json();
  if (body.error) {
    serviceErrorEnvelopeSchema.parse(body);
    expect(body.error.requestId).toBe(response.headers["x-request-id"]);
  }
}

test("published capabilities describe the current service without implying future availability", async () => {
  const app = await service();
  const response = await app.inject({
    url: "/api/v1/capabilities",
    headers: { "x-request-id": "client-controlled-private-value" },
  });
  expect(response.statusCode).toBe(200);
  const capabilities = serviceCapabilitiesSchema.parse(response.json());
  expect(capabilities).toEqual({
    protocol: SERVICE_PROTOCOL,
    version: 1,
    implementationVersion: apiPackage.version,
    supportedVersions: [1],
    capabilities: ["capabilities", "handshake", "openapi"],
    availability: {
      authentication: false,
      accountData: false,
      decisions: false,
      billing: false,
    },
    limits: SERVICE_LIMITS,
  });
  expectCorrelation(response);
  expect(response.headers["x-request-id"]).not.toBe(
    "client-controlled-private-value",
  );
  const next = await app.inject({ url: "/api/v1/capabilities" });
  expect(next.headers["x-request-id"]).not.toBe(
    response.headers["x-request-id"],
  );
});

test.each(["extension", "web", "desktop"] as const)(
  "the %s client negotiates the service contract before sending account or page data",
  async (kind) => {
    const app = await service();
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/handshake",
      payload: handshake(kind),
    });
    expect(response.statusCode, response.body).toBe(200);
    expect(serviceHandshakeSuccessSchema.parse(response.json())).toMatchObject({
      protocol: SERVICE_PROTOCOL,
      version: 1,
    });
    expectCorrelation(response);
  },
);

test("unsupported versions and required capabilities fail negotiation explicitly", async () => {
  const app = await service();
  for (const payload of [
    { ...handshake(), versions: [2] },
    { ...handshake(), requiredCapabilities: ["decisions"] },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/handshake",
      payload,
    });
    expect(response.statusCode).toBe(409);
    expect(response.json()).toMatchObject({
      error: { code: "COMPATIBILITY_MISMATCH", retryable: false },
    });
    expectCorrelation(response);
  }
});

test("malformed and unknown handshake fields are rejected without reflecting submitted data", async () => {
  const app = await service();
  const secret = "private-page-content-and-provider-token";
  for (const payload of [
    { ...handshake(), observation: secret },
    { ...handshake(), client: { ...handshake().client, token: secret } },
    { ...handshake(), client: { kind: "unregistered", version: "0.11.0" } },
    { ...handshake(), versions: [] },
    { ...handshake(), versions: ["1"] },
    { ...handshake(), versions: [1, 1] },
    {
      ...handshake(),
      versions: Array.from({ length: 9 }, (_, index) => index + 1),
    },
    {
      ...handshake(),
      requiredCapabilities: Array.from({ length: 33 }, () => secret),
    },
    { protocol: SERVICE_PROTOCOL, versions: [1] },
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/handshake",
      payload,
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST", retryable: false },
    });
    expect(response.body).not.toContain(secret);
    expectCorrelation(response);
  }
  const malformed = await app.inject({
    method: "POST",
    url: "/api/v1/handshake",
    headers: { "content-type": "application/json" },
    payload: '{"private-page-content-and-provider-token":',
  });
  expect(malformed.statusCode).toBe(400);
  expect(malformed.body).not.toContain(secret);
  expectCorrelation(malformed);
  const query = await app.inject({
    url: "/api/v1/capabilities?private=" + secret,
  });
  expect(query.statusCode).toBe(400);
  expect(query.body).not.toContain(secret);
  expectCorrelation(query);
});

test("the handshake has its own small body budget and unsupported media types fail safely", async () => {
  const app = await service();
  const oversized = await app.inject({
    method: "POST",
    url: "/api/v1/handshake",
    payload: { ...handshake(), private: "x".repeat(8192) },
  });
  expect(oversized.statusCode).toBe(413);
  expect(oversized.json()).toMatchObject({
    error: { code: "PAYLOAD_TOO_LARGE", retryable: false },
  });
  expectCorrelation(oversized);
  const unsupported = await app.inject({
    method: "POST",
    url: "/api/v1/handshake",
    headers: { "content-type": "application/octet-stream" },
    payload: "private-content",
  });
  expect(unsupported.statusCode).toBe(415);
  expect(unsupported.json()).toMatchObject({
    error: { code: "UNSUPPORTED_MEDIA_TYPE" },
  });
  expect(unsupported.body).not.toContain("private-content");
  expectCorrelation(unsupported);
});

test("the service body budget rejects oversized input before a fake operation runs", async () => {
  const app = await service();
  let entered = false;
  app.post("/test-body-budget", async () => {
    entered = true;
    return { ok: true };
  });
  const response = await app.inject({
    method: "POST",
    url: "/test-body-budget",
    payload: { private: "x".repeat(SERVICE_LIMITS.maxBodyBytes) },
  });
  expect(response.statusCode).toBe(413);
  expect(entered).toBe(false);
  expectCorrelation(response);
});

test("public integer fields preserve PostgreSQL precision and enforce quantity and revision semantics", () => {
  for (const value of [
    "0",
    "-1",
    "9007199254740993",
    "9223372036854775807",
    "-9223372036854775808",
  ])
    expect(serviceInt8Schema.parse(value)).toBe(value);
  for (const value of [
    0,
    1n,
    "01",
    "-0",
    "+1",
    " 1",
    "1.0",
    "1e3",
    "9223372036854775808",
    "-9223372036854775809",
    "9".repeat(2048),
  ])
    expect(serviceInt8Schema.safeParse(value).success).toBe(false);
  expect(serviceQuantitySchema.parse("0")).toBe("0");
  expect(serviceQuantitySchema.safeParse("-1").success).toBe(false);
  expect(serviceRevisionSchema.parse("1")).toBe("1");
  expect(serviceRevisionSchema.safeParse("0").success).toBe(false);
  expect(serviceExpectedRevisionSchema.parse("0")).toBe("0");
});

test("pagination is bounded and opaque and accepts canonical HTTP query integers", () => {
  expect(servicePageQuerySchema.parse({})).toEqual({ limit: 50 });
  expect(serviceSyncQuerySchema.parse({})).toEqual({ after: "0", limit: 50 });
  expect(
    servicePageQuerySchema.parse({ limit: 100, cursor: "opaque_1-ABC" }),
  ).toEqual({ limit: 100, cursor: "opaque_1-ABC" });
  expect(servicePageQuerySchema.parse({ limit: "50" })).toEqual({ limit: 50 });
  for (const input of [
    { limit: "01" },
    { limit: "1e1" },
    { limit: " 1" },
    { limit: "1.0" },
    { limit: ["1", "2"] },
    { limit: 0 },
    { limit: 101 },
    { limit: 1.5 },
    { cursor: "https://private.test/record" },
    { cursor: "padded=" },
    { cursor: "x".repeat(513) },
    { tenant: "forged" },
  ])
    expect(servicePageQuerySchema.safeParse(input).success).toBe(false);
  const page = servicePageSchema(serviceRevisionSchema);
  expect(page.parse({ items: ["1", "2"], nextCursor: "next_1" })).toEqual({
    items: ["1", "2"],
    nextCursor: "next_1",
  });
  expect(
    page.safeParse({ items: Array.from({ length: 101 }, () => "1") }).success,
  ).toBe(false);
  expect(page.safeParse({ items: [], nextCursor: "../foreign" }).success).toBe(
    false,
  );
  expect(page.safeParse({ items: [], accountId: "forged" }).success).toBe(
    false,
  );
  expect(serviceSyncQuerySchema.safeParse({ after: "-1" }).success).toBe(false);
});

test("strict HTTP pagination accepts canonical query limits and rejects duplicate or malformed values", async () => {
  const app = await service();
  app.get(
    "/test-pagination",
    {
      schema: {
        querystring: zodToJsonSchema(servicePageQuerySchema, {
          target: "openApi3",
        }),
      },
    },
    (request) => servicePageQuerySchema.parse(request.query),
  );
  app.get(
    "/test-sync",
    {
      schema: {
        querystring: zodToJsonSchema(serviceSyncQuerySchema, {
          target: "openApi3",
        }),
      },
    },
    (request) => serviceSyncQuerySchema.parse(request.query),
  );
  const page = await app.inject({
    url: "/test-pagination?limit=50&cursor=opaque_1",
  });
  expect(page.statusCode).toBe(200);
  expect(page.json()).toEqual({ limit: 50, cursor: "opaque_1" });
  const sync = await app.inject({
    url: "/test-sync?limit=2&after=9007199254740993",
  });
  expect(sync.statusCode).toBe(200);
  expect(sync.json()).toEqual({ limit: 2, after: "9007199254740993" });
  for (const query of [
    "limit=0",
    "limit=101",
    "limit=1.5",
    "limit=1e1",
    "limit=01",
    "limit=%2050",
    "limit=50&limit=50",
    "limit=true",
    "cursor=" + "x".repeat(513),
  ]) {
    const invalid = await app.inject({ url: "/test-pagination?" + query });
    expect(invalid.statusCode, query).toBe(400);
    expectCorrelation(invalid);
  }
});

test("request metadata binds bounded logical keys and hashes without accepting client scope", () => {
  expect(serviceRequestPolicySchema.parse({})).toEqual({ timeoutMs: 25000 });
  const metadata = {
    requestId: "f0343546-5843-4ad3-aa61-57eb117608de",
    contractVersion: 1,
    deadlineAt: "2026-10-30T12:00:00.000Z",
    idempotencyKey: "logical-request:1",
    payloadHash: "a".repeat(64),
  };
  expect(serviceRequestMetadataSchema.parse(metadata)).toEqual(metadata);
  for (const input of [
    { timeoutMs: "1" },
    { timeoutMs: 0 },
    { timeoutMs: 25001 },
    { idempotencyKey: "private\nheader" },
    { idempotencyKey: "x".repeat(201) },
    { deadlineAt: "2026-10-30" },
  ])
    expect(serviceRequestPolicySchema.safeParse(input).success).toBe(false);
  for (const input of [
    { ...metadata, contractVersion: 2 },
    { ...metadata, payloadHash: "A".repeat(64) },
    { ...metadata, accountId: "forged" },
    { ...metadata, deadlineAt: "tomorrow" },
  ])
    expect(serviceRequestMetadataSchema.safeParse(input).success).toBe(false);
});

test("auth and checkout intents cannot nominate redirect URLs or grant client entitlements", () => {
  const returnIntent = { clientKind: "extension", destination: "client" };
  expect(
    serviceAuthIntentSchema.parse({
      action: "signup",
      returnIntent,
      planIntent: { mode: "free-cloud" },
    }),
  ).toMatchObject({ action: "signup", planIntent: { mode: "free-cloud" } });
  expect(
    serviceCheckoutIntentSchema.parse({
      planId: "synthetic-plan",
      planVersion: 1,
      returnIntent,
    }),
  ).toMatchObject({ planId: "synthetic-plan", planVersion: 1 });
  for (const input of [
    {
      action: "signin",
      returnIntent: { ...returnIntent, redirectUrl: "https://evil.test" },
    },
    {
      action: "signin",
      returnIntent,
      planIntent: { mode: "free-cloud", credits: "1000" },
    },
    {
      action: "signup",
      returnIntent,
      planIntent: { mode: "local", checkout: true },
    },
  ])
    expect(serviceAuthIntentSchema.safeParse(input).success).toBe(false);
  expect(
    serviceCheckoutIntentSchema.safeParse({
      planId: "synthetic-plan",
      planVersion: 1,
      returnIntent,
      checkoutUrl: "https://evil.test",
    }).success,
  ).toBe(false);
});

test("handshake POST and preflight permit only the configured exact website origin", async () => {
  const app = await service(["https://tholi.io"]);
  const response = await app.inject({
    method: "POST",
    url: "/api/v1/handshake",
    payload: handshake("web"),
    headers: { origin: "https://tholi.io", "x-tholi-timeout-ms": "1000" },
  });
  expect(response.statusCode).toBe(200);
  expect(response.headers["access-control-allow-origin"]).toBe(
    "https://tholi.io",
  );
  expect(String(response.headers.vary).toLowerCase()).toContain("origin");
  const preflight = await app.inject({
    method: "OPTIONS",
    url: "/api/v1/handshake",
    headers: {
      origin: "https://tholi.io",
      "access-control-request-method": "POST",
      "access-control-request-headers": "content-type,x-tholi-timeout-ms",
    },
  });
  expect(preflight.statusCode).toBe(204);
  expect(preflight.headers["access-control-allow-origin"]).toBe(
    "https://tholi.io",
  );
  expect(preflight.headers["access-control-allow-methods"]).toContain("POST");
  for (const origin of ["https://tholi.io.evil.test", "http://tholi.io"]) {
    const rejected = await app.inject({
      method: "POST",
      url: "/api/v1/handshake",
      payload: handshake("web"),
      headers: { origin },
    });
    expect(rejected.statusCode).toBe(403);
    expect(rejected.headers["access-control-allow-origin"]).toBeUndefined();
    expectCorrelation(rejected);
  }
});

test("the service OpenAPI describes live routes independently of legacy APIs", async () => {
  const app = await service();
  const response = await app.inject({ url: "/api/v1/openapi.json" });
  expect(response.statusCode).toBe(200);
  const specification = response.json();
  expect(specification.openapi).toMatch(/^3\./);
  expect(specification.info.title).toContain("Tholi");
  expect(specification.info.version).toBe(String(SERVICE_CONTRACT_VERSION));
  expect(specification.paths["/api/v1/capabilities"].get).toBeDefined();
  expect(specification.paths["/api/v1/handshake"].post).toBeDefined();
  expect(specification.paths["/api/v1/openapi.json"].get).toBeDefined();
  expect(specification.paths["/v1/plans"]).toBeUndefined();
  expect(specification.paths["/v2/plans"]).toBeUndefined();
  expect(specification.paths["/api/v1/decisions"]).toBeUndefined();
  expect(specification.paths["/api/v1/account"]).toBeUndefined();
  expectCorrelation(response);
  const example =
    specification.paths["/api/v1/handshake"].post.requestBody.content[
      "application/json"
    ].example;
  serviceHandshakeInputSchema.parse(example);
  const demonstrated = await app.inject({
    method: "POST",
    url: "/api/v1/handshake",
    payload: example,
  });
  expect(demonstrated.statusCode).toBe(200);
  serviceHandshakeSuccessSchema.parse(demonstrated.json());
  const inventory: ServiceRouteInventoryEntry[] =
    specification["x-tholi-route-inventory"];
  expect(new Set(inventory.map((entry) => entry.group))).toEqual(
    new Set([
      "discovery",
      "identity",
      "account",
      "organizations",
      "policies",
      "decisions",
      "usage",
      "credits",
      "plans",
      "jobs",
      "support",
      "files",
      "saved-data",
      "sync",
      "billing",
      "onboarding",
    ]),
  );
  for (const entry of inventory) {
    if (entry.status === "implemented") {
      expect(
        specification.paths[entry.path][entry.method.toLowerCase()].operationId,
      ).toBe(entry.operationId);
      continue;
    }
    expect(
      specification.paths[entry.path]?.[entry.method.toLowerCase()],
    ).toBeUndefined();
    const future = await app.inject({
      method: entry.method,
      url: entry.path.replace(
        /\{[^}]+\}/g,
        "f0343546-5843-4ad3-aa61-57eb117608de",
      ),
    });
    expect(future.statusCode, entry.operationId).toBe(404);
    expectCorrelation(future);
  }
});

test("relative request deadlines are bounded before operation admission", async () => {
  const app = await service();
  for (const timeout of [
    "0",
    "-1",
    "25001",
    "30000",
    "1.5",
    "1e3",
    "NaN",
    "10,20",
  ]) {
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/handshake",
      payload: handshake(),
      headers: { "x-tholi-timeout-ms": timeout },
    });
    expect(response.statusCode).toBe(400);
    expect(response.json()).toMatchObject({
      error: { code: "INVALID_REQUEST" },
    });
    expectCorrelation(response);
  }
});

test("request context uses the server correlation ID and the configured default or shorter deadline", async () => {
  const app = await service();
  app.get("/test-context", (request) =>
    duringServiceRequest(request, async (context) => ({
      requestId: context.requestId,
      remaining: context.deadlineAt - Date.now(),
      aborted: context.signal.aborted,
    })),
  );
  for (const timeout of [undefined, "500"]) {
    const response = await app.inject({
      url: "/test-context",
      headers: timeout ? { "x-tholi-timeout-ms": timeout } : {},
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      requestId: response.headers["x-request-id"],
      aborted: false,
    });
    expect(response.json().remaining).toBeGreaterThan(0);
    expect(response.json().remaining).toBeLessThanOrEqual(
      timeout ? Number(timeout) : SERVICE_LIMITS.defaultDeadlineMs,
    );
  }
});

function pendingOperation(app: FastifyInstance) {
  let reportEntered!: (context: ServiceRequestContext) => void;
  let release!: (result: { released: true }) => void;
  const entered = new Promise<ServiceRequestContext>((resolve) => {
    reportEntered = resolve;
  });
  const operation = new Promise<{ released: true }>((resolve) => {
    release = resolve;
  });
  releaseOperations.push(() => release({ released: true }));
  app.get("/test-pending", (request) =>
    duringServiceRequest(request, (context) => {
      reportEntered(context);
      // This fake deliberately ignores cancellation. The HTTP owner must bound it.
      return operation;
    }),
  );
  return entered;
}

test("the real HTTP deadline aborts even an operation that ignores cancellation", async () => {
  const app = await service();
  const entered = pendingOperation(app);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const pending = fetch(address + "/test-pending", {
    headers: { "x-tholi-timeout-ms": "25" },
    signal: AbortSignal.timeout(2000),
  });
  const context = await entered;
  const response = await pending;
  expect(response.status).toBe(504);
  expect(await response.json()).toMatchObject({
    error: {
      code: "DEADLINE_EXCEEDED",
      retryable: false,
      requestId: context.requestId,
    },
  });
  expect(context.signal.aborted).toBe(true);
  expect(context.signal.reason).toBeInstanceOf(ApiError);
  expect(context.signal.reason.code).toBe("DEADLINE_EXCEEDED");
});

test.each(["deadline", "shutdown"] as const)(
  "%s closes an unfinished HTTP request body before JSON parsing can finish",
  async (reason) => {
    const app = await service();
    let reportReceived!: () => void;
    const received = new Promise<void>((resolve) => {
      reportReceived = resolve;
    });
    app.addHook("onRequest", async (incoming) => {
      if (incoming.url === "/api/v1/handshake") reportReceived();
    });
    const address = await app.listen({ host: "127.0.0.1", port: 0 });
    let request: ClientRequest | undefined;
    try {
      const pending = new Promise<{
        status?: number;
        headers: IncomingHttpHeaders;
        body: string;
      }>((resolve, reject) => {
        request = openRequest(
          address + "/api/v1/handshake",
          {
            method: "POST",
            agent: false,
            headers: {
              "content-type": "application/json",
              "content-length": "1000",
              "x-tholi-timeout-ms": reason === "deadline" ? "25" : "25000",
            },
          },
          (incoming) => {
            let body = "";
            incoming.setEncoding("utf8");
            incoming.on("data", (chunk: string) => {
              body += chunk;
            });
            incoming.on("error", reject);
            incoming.on("end", () =>
              resolve({
                status: incoming.statusCode,
                headers: incoming.headers,
                body,
              }),
            );
          },
        );
        request.setTimeout(2000, () =>
          request?.destroy(
            new Error("The HTTP body deadline did not complete."),
          ),
        );
        request.on("error", reject);
        request.write('{"protocol":');
      });
      const [response] = await Promise.all([
        pending,
        reason === "shutdown"
          ? received.then(() => app.close())
          : Promise.resolve(),
      ]);
      expect(response.status).toBe(reason === "deadline" ? 504 : 503);
      expect(response.headers.connection).toBe("close");
      expect(response.headers["cache-control"]).toBe("no-store");
      expect(
        serviceErrorEnvelopeSchema.parse(JSON.parse(response.body)),
      ).toMatchObject({
        error: {
          code: reason === "deadline" ? "DEADLINE_EXCEEDED" : "UNAVAILABLE",
          retryable: reason === "shutdown",
          requestId: response.headers["x-request-id"],
        },
      });
    } finally {
      request?.destroy();
    }
  },
);

test("disconnect cancels the request operation without stopping later service requests", async () => {
  const app = await service();
  const entered = pendingOperation(app);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  let request: ClientRequest | undefined;
  try {
    request = get(address + "/test-pending", {
      agent: false,
      headers: { "x-tholi-timeout-ms": "25000" },
    });
    request.on("error", () => {});
    const context = await entered;
    const aborted = new Promise<void>((resolve) =>
      context.signal.addEventListener("abort", () => resolve(), { once: true }),
    );
    request.destroy();
    await aborted;
    expect(context.signal.reason).toBeInstanceOf(ApiError);
    expect(context.signal.reason).toMatchObject({
      statusCode: 499,
      code: "CANCELLED",
      retryable: false,
    });
    expect((await app.inject({ url: "/api/v1/capabilities" })).statusCode).toBe(
      200,
    );
  } finally {
    request?.destroy();
  }
});

test("shutdown aborts active request work before the HTTP listener finishes draining", async () => {
  const app = await service();
  const entered = pendingOperation(app);
  const address = await app.listen({ host: "127.0.0.1", port: 0 });
  const pending = fetch(address + "/test-pending", {
    headers: { "x-tholi-timeout-ms": "25000" },
    signal: AbortSignal.timeout(2000),
  });
  const context = await entered;
  const [response] = await Promise.all([pending, app.close()]);
  expect(response.status).toBe(503);
  expect(await response.json()).toMatchObject({
    error: { code: "UNAVAILABLE", retryable: true },
  });
  expect(context.signal.aborted).toBe(true);
  expect(context.signal.reason).toMatchObject({
    code: "UNAVAILABLE",
    retryable: true,
  });
});
