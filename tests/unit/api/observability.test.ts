import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { createObservability } from "../../../apps/api/src/adapters/observability";
import { INFERENCE_RECONCILIATION_JOB_KIND } from "../../../apps/api/src/application/quotas";
import {
  correlationSchema,
  NO_OBSERVABILITY,
  OBSERVABILITY_DEFAULTS,
  type Observability,
  type ObservabilityOptions,
  type ObservationFields,
} from "../../../apps/api/src/application/observability";

const observers: Observability[] = [];
afterEach(async () => {
  await Promise.all(observers.splice(0).map((observer) => observer.close()));
});
function options(
  extra: Partial<ObservabilityOptions> = {},
): ObservabilityOptions {
  return {
    enabled: true,
    service: "tholi-api",
    ...OBSERVABILITY_DEFAULTS,
    ...extra,
  };
}
function fixture(
  extra: Partial<ObservabilityOptions> = {},
  fetcher?: typeof fetch,
) {
  const lines: string[] = [];
  const observer = createObservability(options(extra), {
    write: (line, done) => {
      lines.push(line);
      done();
    },
    ...(fetcher ? { fetch: fetcher } : {}),
  });
  observers.push(observer);
  return { observer, lines };
}

it("leaves disabled and unconfigured observation inert without context or transports", async () => {
  const fetcher = vi.fn(),
    write = vi.fn();
  const observer = createObservability(options({ enabled: false }), {
    fetch: fetcher,
    write,
  });
  expect(observer).toBe(NO_OBSERVABILITY);
  expect(createObservability()).toBe(NO_OBSERVABILITY);
  const span = observer.start("http.request");
  expect(span.correlation).toBeUndefined();
  observer.run(undefined, () => span.end("ok"));
  observer.metric("worker.active", 1);
  await observer.close();
  expect(fetcher).not.toHaveBeenCalled();
  expect(write).not.toHaveBeenCalled();
  expect(
    correlationSchema.safeParse({
      requestId: randomUUID(),
      traceId: "0".repeat(32),
      spanId: "1".repeat(16),
    }).success,
  ).toBe(false);
});

it("isolates concurrent async contexts and retains late completion during stop", async () => {
  const { observer, lines } = fixture();
  const first = observer.start(
    "http.request",
    { route: "getCurrentAccount" },
    { requestId: randomUUID() },
  );
  const second = observer.start(
    "http.request",
    {},
    { requestId: randomUUID() },
  );
  await Promise.all(
    [first, second].map((span) =>
      observer.run(span.correlation, async () => {
        await new Promise((resolve) => setTimeout(resolve, 1));
        expect(observer.current()).toEqual(span.correlation);
        const child = observer.start("identity.exchange", { provider: "oidc" });
        expect(child.correlation?.traceId).toBe(span.correlation?.traceId);
        expect(child.correlation?.spanId).not.toBe(span.correlation?.spanId);
        child.end("denied", { statusCode: 401, errorCode: "UNAUTHENTICATED" });
      }),
    ),
  );
  expect(observer.current()).toBeUndefined();
  observer.stop();
  first.end("ok");
  first.end("error");
  second.end("cancelled");
  await observer.close();
  const records = lines.flatMap((line) =>
    line
      .trim()
      .split("\n")
      .map((value) => JSON.parse(value)),
  );
  expect(records).toHaveLength(4);
  expect(
    records
      .filter((record) => record.operation === "identity.exchange")
      .every((record) => record.parentSpanId),
  ).toBe(true);
});

it("exports real OTLP HTTP JSON and stdout through the same strict privacy boundary", async () => {
  const captured: {
    path: string;
    body: string;
    contentType: string | undefined;
  }[] = [];
  const server = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(chunk));
    request.on("end", () => {
      captured.push({
        path: request.url!,
        body: Buffer.concat(chunks).toString("utf8"),
        contentType: request.headers["content-type"],
      });
      response.setHeader("Content-Type", "application/json");
      response.end("{}");
    });
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const port = (server.address() as { port: number }).port;
    const { observer, lines } = fixture({
      otlpEndpoint: `http://127.0.0.1:${port}`,
      allowLocal: true,
    });
    const secrets = [
      "screenshot-data:image/png;base64,PRIVATE",
      "goal-change-payroll",
      "https://private.example/payroll?token=secret",
      "raw-prompt-private",
      "Bearer SECRET-CREDENTIAL",
      "private@example.test",
      "SQL-PRIVATE-VALUE",
    ];
    const injected = {
      provider: "oidc",
      profile: "service",
      route: secrets[2],
      jobKind: secrets[1],
      errorCode: secrets[4],
      screenshot: secrets[0],
      goal: secrets[1],
      prompt: secrets[3],
      email: secrets[5],
      sql: secrets[6],
    } as unknown as ObservationFields;
    const root = observer.start(
      "http.request",
      { route: "getCurrentAccount" },
      { requestId: randomUUID(), jobId: randomUUID() },
    );
    observer.run(root.correlation, () => {
      const provider = observer.start("identity.exchange", injected);
      provider.end("denied", { ...injected, statusCode: 401 });
      observer.metric("database.pool.wait_ms", 4, injected);
      observer
        .start("job.attempt", {
          jobKind: INFERENCE_RECONCILIATION_JOB_KIND.kind,
        })
        .end("uncertain");
      observer.metric("job.queue.count", 1, {
        jobKind: INFERENCE_RECONCILIATION_JOB_KIND.kind,
        jobStatus: "uncertain",
      });
    });
    root.end("error", { statusCode: 500, errorCode: "INTERNAL_ERROR" });
    await observer.close();
    expect(new Set(captured.map((request) => request.path))).toEqual(
      new Set(["/v1/traces", "/v1/logs", "/v1/metrics"]),
    );
    expect(
      captured.every((request) => request.contentType === "application/json"),
    ).toBe(true);
    const serialized =
      lines.join("") + captured.map((request) => request.body).join("");
    for (const secret of secrets) expect(serialized).not.toContain(secret);
    const trace = JSON.parse(
      captured.find((request) => request.path === "/v1/traces")!.body,
    ).resourceSpans[0].scopeSpans[0].spans;
    expect(
      trace.every(
        (span: {
          kind: unknown;
          traceId: string;
          spanId: string;
          startTimeUnixNano: unknown;
        }) =>
          typeof span.kind === "number" &&
          /^[a-f0-9]{32}$/.test(span.traceId) &&
          /^[a-f0-9]{16}$/.test(span.spanId) &&
          typeof span.startTimeUnixNano === "string",
      ),
    ).toBe(true);
    const metrics = captured
      .filter((request) => request.path === "/v1/metrics")
      .map((request) => request.body)
      .join("");
    expect(metrics).not.toContain(root.correlation!.requestId);
    expect(metrics).not.toContain(root.correlation!.jobId);
    expect(metrics).not.toContain(root.correlation!.traceId);
    expect(metrics).toContain(INFERENCE_RECONCILIATION_JOB_KIND.kind);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

it("bounds queued records, stdout backpressure and shutdown while a sink stops responding", async () => {
  const payloads: string[] = [];
  const fetcher = vi.fn(async (_url: unknown, init?: RequestInit) => {
    payloads.push(String(init?.body));
    return Response.json({});
  });
  const write = vi.fn(
    (_value: string, _done: (error?: Error | null) => void) => {},
  );
  const observer = createObservability(
    options({
      otlpEndpoint: "http://telemetry:4318",
      allowLocal: true,
      queueMaxRecords: 2,
      batchSize: 1,
      exportTimeoutMs: 20,
      shutdownTimeoutMs: 100,
    }),
    { fetch: fetcher as typeof fetch, write },
  );
  observers.push(observer);
  observer.start("http.request").end("ok");
  await vi.waitFor(() => expect(write).toHaveBeenCalledOnce());
  for (let i = 0; i < 20; i++) observer.start("http.request").end("ok");
  const began = Date.now();
  await observer.close();
  expect(Date.now() - began).toBeLessThan(400);
  expect(write).toHaveBeenCalledOnce();
  const traces = payloads
    .filter((value) => value.includes('"resourceSpans"'))
    .flatMap((value) => JSON.parse(value).resourceSpans[0].scopeSpans[0].spans);
  expect(traces.length).toBeLessThanOrEqual(3);
  expect(payloads.join("")).toContain("tholi_telemetry_dropped_total");
  expect(observer.ready()).toBe(true);
});

it("does not follow redirects or retry permanent collector errors and bounds a stalled close", async () => {
  const calls: RequestInit[] = [];
  const { observer } = fixture(
    { otlpEndpoint: "https://collector.example.test", shutdownTimeoutMs: 100 },
    async (_url, init) => {
      calls.push(init!);
      return new Response("PRIVATE-COLLECTOR-ERROR", { status: 400 });
    },
  );
  observer.start("http.request").end("error");
  await observer.close();
  expect(calls).toHaveLength(3);
  expect(
    calls.every(
      (call) =>
        call.redirect === "manual" &&
        call.credentials === "omit" &&
        !Object.keys(call.headers!).includes("Authorization"),
    ),
  ).toBe(true);
  const stalled = fixture(
    { otlpEndpoint: "https://collector.example.test", shutdownTimeoutMs: 25 },
    async () => new Promise<Response>(() => {}),
  );
  stalled.observer.start("http.request").end("ok");
  const began = Date.now();
  await stalled.observer.close();
  expect(Date.now() - began).toBeLessThan(300);
});

it("keeps per-request byte limits while exporting many finite metric series", async () => {
  const bodies: string[] = [];
  const { observer } = fixture(
    {
      otlpEndpoint: "http://telemetry:4318",
      allowLocal: true,
      batchMaxBytes: 2048,
    },
    async (_url, init) => {
      bodies.push(String(init?.body));
      return Response.json({});
    },
  );
  for (let statusCode = 400; statusCode < 460; statusCode++)
    observer.metric("database.pool.wait_ms", 2, { statusCode });
  await observer.close();
  expect(bodies.length).toBeGreaterThan(1);
  expect(bodies.every((body) => Buffer.byteLength(body) <= 2048)).toBe(true);
});

it("keeps replica metric resource identities distinct and stable for their process lifetime", async () => {
  const resources: unknown[][] = [[], []];
  for (let index = 0; index < 2; index++) {
    const { observer } = fixture(
      { otlpEndpoint: "http://telemetry:4318", allowLocal: true },
      async (_url, init) => {
        const body = JSON.parse(String(init?.body));
        const rows =
          body.resourceSpans ?? body.resourceLogs ?? body.resourceMetrics;
        resources[index].push(rows[0].resource);
        return Response.json({});
      },
    );
    observer.start("http.request").end("ok");
    await observer.close();
  }
  const instances = resources.map((rows) =>
    rows.map(
      (value) =>
        (
          value as {
            attributes: { key: string; value: { stringValue: string } }[];
          }
        ).attributes.find(
          (attribute) => attribute.key === "service.instance.id",
        )!.value.stringValue,
    ),
  );
  expect(new Set(instances[0]).size).toBe(1);
  expect(new Set(instances[1]).size).toBe(1);
  expect(instances[0][0]).not.toBe(instances[1][0]);
});

it.each(["malformed", "partial"])(
  "does not retry an accepted collector envelope with %s acknowledgement",
  async (mode) => {
    const calls: string[] = [];
    const { observer } = fixture(
      { otlpEndpoint: "https://collector.example.test" },
      async (url) => {
        calls.push(String(url));
        return mode === "malformed"
          ? new Response("PRIVATE-COLLECTOR-ERROR", { status: 200 })
          : Response.json({
              partialSuccess: {
                rejectedSpans: "1",
                errorMessage: "PRIVATE-COLLECTOR-ERROR",
              },
            });
      },
    );
    observer.start("http.request").end("ok");
    await observer.close();
    expect(calls).toHaveLength(3);
    expect(calls.filter((url) => url.endsWith("/v1/traces"))).toHaveLength(1);
  },
);
