import { afterEach, expect, it, vi } from "vitest";
import { runObservabilityChecks } from "../../../scripts/lib/observability-validation.mjs";

afterEach(() => vi.useRealTimers());

const origin = {
  requestId: "00000000-0000-4000-8000-000000000001",
  traceId: "a".repeat(32),
  spanId: "1".repeat(16),
};
const failedProviderRequestId = "00000000-0000-4000-8000-000000000002";
const providerTrace = "b".repeat(32);
const jobId = "00000000-0000-4000-8000-000000000003";
const sentinel = "SYNTHETIC_PRIVATE_SENTINEL";
const families = [
  "tholi_operation_count_total",
  "tholi_operation_duration_ms_bucket",
  "tholi_worker_healthy",
  "tholi_database_pool_total",
  "tholi_job_retries_total",
];
const allMetrics = families
  .map((name) => `${name}{service_name="tholi-worker"} 1`)
  .join("\n");
const collector = `${origin.traceId}\n${providerTrace}\ntholi_operation_duration_ms\ntholi_worker_healthy`;
const records = [
  {
    operation: "http.request",
    correlation: {
      requestId: failedProviderRequestId,
      traceId: providerTrace,
      spanId: "2".repeat(16),
    },
  },
  {
    operation: "identity.exchange",
    outcome: "error",
    parentSpanId: "2".repeat(16),
    correlation: {
      requestId: failedProviderRequestId,
      traceId: providerTrace,
      spanId: "3".repeat(16),
    },
  },
  { operation: "http.request", correlation: origin },
  ...["4", "5"].map((span) => ({
    operation: "job.attempt",
    correlation: { ...origin, jobId, spanId: span.repeat(16) },
  })),
  ...["not-sent", "accepted"].map((outcome) => ({
    operation: "smtp.send",
    outcome,
    correlation: { ...origin, jobId },
  })),
]
  .map((record) => JSON.stringify(record))
  .join("\n");

function fixture(scrapes: string[], collectors: string[] = [collector]) {
  let scrapeCount = 0;
  let collectorCount = 0;
  const compose = vi.fn(async (args: string[]) => {
    if (args[0] === "exec")
      return scrapes[Math.min(scrapeCount++, scrapes.length - 1)];
    if (args[0] === "logs") {
      if (args.at(-1) === "api") return records;
      if (args.at(-1) === "telemetry")
        return collectors[Math.min(collectorCount++, collectors.length - 1)];
    }
    return "";
  });
  const runPostgresImage = vi.fn(async (args: string[] = []) =>
    args.includes("submit")
      ? { passed: true, jobId, correlation: origin, failedProviderRequestId }
      : { passed: true, jobId, correlation: origin, attempts: 2 },
  );
  return { compose, runPostgresImage, sentinel };
}

it("waits for actual retry metrics after correlated stdout and collector records arrive", async () => {
  vi.useFakeTimers();
  const input = fixture([
    allMetrics.replace(/^tholi_job_retries_total.*$/m, ""),
    allMetrics,
  ]);
  const pending = runObservabilityChecks(input);
  await vi.advanceTimersByTimeAsync(250);
  await expect(pending).resolves.toMatchObject({
    passed: true,
    attempts: 2,
    noRawRecordsRetained: true,
  });
  expect(
    input.compose.mock.calls.filter(([args]) => args[0] === "exec"),
  ).toHaveLength(2);
});

it("waits for all required collector signals within the same collection deadline", async () => {
  vi.useFakeTimers();
  const input = fixture([allMetrics], [origin.traceId, collector]);
  const pending = runObservabilityChecks(input);
  await vi.advanceTimersByTimeAsync(250);
  await expect(pending).resolves.toMatchObject({ passed: true });
  expect(
    input.compose.mock.calls.filter(([args]) => args[0] === "exec"),
  ).toHaveLength(2);
});

it("requires actual exact-family samples and reports only fixed missing names at fifteen seconds", async () => {
  vi.useFakeTimers();
  const missing = allMetrics.replace(
    /^tholi_job_retries_total.*$/m,
    "# HELP tholi_job_retries_total PRIVATE_UNRETAINED_METADATA\ntholi_job_retries_total_unrelated 1",
  );
  const input = fixture([missing]);
  const began = Date.now();
  const pending = runObservabilityChecks(input).then(
    () => "unexpected pass",
    (error: Error) => error.message,
  );
  await vi.advanceTimersByTimeAsync(15000);
  expect(await pending).toBe(
    "Local observability check failed: actual portable Prometheus metrics (missing: tholi_job_retries_total).",
  );
  expect(Date.now() - began).toBe(15000);
});

it.each([sentinel, origin.requestId, origin.traceId, jobId])(
  "rejects metric identifier leakage immediately on every scrape: %s",
  async (leaked) => {
    vi.useFakeTimers();
    const input = fixture([allMetrics + "\n# PRIVATE " + leaked, allMetrics]);
    await expect(runObservabilityChecks(input)).rejects.toThrow(
      "Local observability check failed: private and request identifiers absent from metric labels.",
    );
    expect(
      input.compose.mock.calls.filter(([args]) => args[0] === "exec"),
    ).toHaveLength(1);
  },
);

it("checks privacy again when a later metric scrape arrives", async () => {
  vi.useFakeTimers();
  const input = fixture([
    allMetrics.replace(/^tholi_job_retries_total.*$/m, ""),
    allMetrics + "\n# PRIVATE " + sentinel,
    allMetrics,
  ]);
  const pending = runObservabilityChecks(input).catch(
    (error: Error) => error.message,
  );
  await vi.advanceTimersByTimeAsync(250);
  expect(await pending).toBe(
    "Local observability check failed: private and request identifiers absent from metric labels.",
  );
  expect(
    input.compose.mock.calls.filter(([args]) => args[0] === "exec"),
  ).toHaveLength(2);
});

it("checks late collector records for private sentinels before scraping again", async () => {
  vi.useFakeTimers();
  const input = fixture(
    [allMetrics],
    [origin.traceId, collector + "\n" + sentinel],
  );
  const pending = runObservabilityChecks(input).catch(
    (error: Error) => error.message,
  );
  await vi.advanceTimersByTimeAsync(250);
  expect(await pending).toBe(
    "Local observability check failed: private sentinels absent from actual logs and collector.",
  );
  expect(
    input.compose.mock.calls.filter(([args]) => args[0] === "exec"),
  ).toHaveLength(1);
});

it("passes remaining collection time to Compose and the in-container scrape deadline", async () => {
  vi.useFakeTimers();
  const input = fixture([allMetrics]);
  const compose = vi.fn(async (args: string[], _timeout?: number) => {
    if (args[0] === "logs" && args.at(-1) === "api")
      vi.setSystemTime(Date.now() + 12000);
    return input.compose(args);
  });
  await expect(
    runObservabilityChecks({ ...input, compose }),
  ).resolves.toMatchObject({ passed: true });
  expect(
    compose.mock.calls
      .filter(([args]) => args[0] === "logs")
      .every(([, timeout]) => timeout === 15000),
  ).toBe(true);
  const scrape = compose.mock.calls.find(([args]) => args[0] === "exec")!;
  expect(scrape[1]).toBe(3000);
  expect(scrape[0].at(-1)).toContain("AbortSignal.timeout(3000)");
});

it("redacts transport failures instead of retaining collector command diagnostics", async () => {
  const input = fixture([allMetrics]);
  const compose = async (args: string[]) => {
    if (args[0] === "exec") throw Error("PRIVATE_RAW_COLLECTOR_STDERR");
    return input.compose(args);
  };
  await expect(runObservabilityChecks({ ...input, compose })).rejects.toThrow(
    "Local observability check failed: actual Prometheus scrape.",
  );
});
