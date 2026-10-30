import { createHash } from "node:crypto";

function requireCheck(value, phase) {
  if (!value)
    throw new Error("Local observability check failed: " + phase + ".");
}

const requiredMetricFamilies = [
  "tholi_operation_count_total",
  "tholi_operation_duration_ms_bucket",
  "tholi_worker_healthy",
  "tholi_database_pool_total",
  "tholi_job_retries_total",
];

function inspectRecords(records, collector, submitted) {
  const origin = submitted.correlation;
  const failedHttp = records.find(
    (record) =>
      record.operation === "http.request" &&
      record.correlation?.requestId === submitted.failedProviderRequestId,
  );
  const attempts = records.filter(
    (record) =>
      record.operation === "job.attempt" &&
      record.correlation?.jobId === submitted.jobId,
  );
  const mail = records.filter(
    (record) =>
      record.operation === "smtp.send" &&
      record.correlation?.jobId === submitted.jobId,
  );
  return [
    [
      "actual failed OIDC request and provider parent span",
      failedHttp &&
        records.some(
          (record) =>
            record.operation === "identity.exchange" &&
            record.outcome !== "ok" &&
            record.correlation?.requestId ===
              submitted.failedProviderRequestId &&
            record.correlation.traceId === failedHttp.correlation.traceId &&
            record.parentSpanId === failedHttp.correlation.spanId,
        ),
    ],
    [
      "actual enqueue HTTP origin",
      records.some(
        (record) =>
          record.operation === "http.request" &&
          record.correlation?.requestId === origin.requestId &&
          record.correlation.traceId === origin.traceId,
      ),
    ],
    [
      "retried worker preserves trace with fresh attempt spans",
      attempts.length >= 2 &&
        new Set(attempts.map((record) => record.correlation.spanId)).size ===
          attempts.length &&
        attempts.every(
          (record) =>
            record.correlation.traceId === origin.traceId &&
            record.correlation.requestId === origin.requestId,
        ),
    ],
    [
      "actual interrupted and accepted SMTP attempts",
      mail.some((record) => record.outcome === "not-sent") &&
        mail.some((record) => record.outcome === "accepted"),
    ],
    [
      "actual collector traces logs and metrics",
      !!failedHttp &&
        collector.includes(origin.traceId) &&
        collector.includes(failedHttp.correlation.traceId) &&
        collector.includes("tholi_operation_duration_ms") &&
        collector.includes("tholi_worker_healthy"),
    ],
  ];
}

/** Inspect only this disposable stack. Raw records and credentials are not retained. */
export async function runObservabilityChecks({
  compose,
  runPostgresImage,
  sentinel,
}) {
  const since = new Date().toISOString();
  const probe = (...args) =>
    runPostgresImage([
      "node",
      "/app/postgres-check.mjs",
      "--telemetry-runtime-probe",
      ...args,
    ]);
  let submitted;
  await compose(["stop", "mail"], 30000);
  try {
    submitted = await probe("submit");
    requireCheck(
      submitted.passed &&
        submitted.jobId &&
        submitted.correlation &&
        submitted.failedProviderRequestId,
      "failed provider and durable retry",
    );
  } finally {
    // Never leave even the disposable capture service stopped after a failed probe.
    await compose(
      ["up", "--detach", "--wait", "--wait-timeout", "60", "mail"],
      90000,
    );
  }
  const completed = await probe("complete", submitted.jobId);
  requireCheck(
    completed.passed &&
      completed.attempts >= 2 &&
      JSON.stringify(completed.correlation) ===
        JSON.stringify(submitted.correlation),
    "retry completion and immutable origin",
  );
  const deadline = Date.now() + 15000;
  const origin = submitted.correlation;
  let api, worker;
  let collector = "",
    records = [],
    metrics = "";
  let checks = inspectRecords(records, collector, submitted);
  let missingMetricFamilies = requiredMetricFamilies;
  let completeInBudget = false;
  while (Date.now() < deadline) {
    const logTimeout = deadline - Date.now();
    if (logTimeout <= 0) break;
    try {
      [api, worker, collector] = await Promise.all(
        ["api", "worker", "telemetry"].map((service) =>
          compose(
            [
              "logs",
              "--no-color",
              "--no-log-prefix",
              "--since",
              since,
              service,
            ],
            logTimeout,
          ),
        ),
      );
    } catch {
      requireCheck(Date.now() >= deadline, "actual telemetry log collection");
      break;
    }
    requireCheck(
      ![api, worker, collector].some((value) => value.includes(sentinel)),
      "private sentinels absent from actual logs and collector",
    );
    records = (api + "\n" + worker)
      .split(/\r?\n/)
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    checks = inspectRecords(records, collector, submitted);
    const scrapeTimeout = deadline - Date.now();
    if (scrapeTimeout <= 0) break;
    try {
      metrics = await compose(
        [
          "exec",
          "-T",
          "api",
          "node",
          "--input-type=module",
          "-e",
          `const response=await fetch('http://telemetry:8889/metrics',{signal:AbortSignal.timeout(${Math.min(5000, scrapeTimeout)})});if(!response.ok)throw Error('Metric scrape failed.');process.stdout.write(await response.text());`,
        ],
        scrapeTimeout,
      );
    } catch {
      requireCheck(Date.now() >= deadline, "actual Prometheus scrape");
      break;
    }
    requireCheck(
      ![sentinel, origin.requestId, origin.traceId, submitted.jobId].some(
        (value) => metrics.includes(value),
      ),
      "private and request identifiers absent from metric labels",
    );
    missingMetricFamilies = requiredMetricFamilies.filter(
      (name) =>
        !new RegExp(
          "^" + name + "(?:\\{[^\\r\\n]*\\})?[ \\t]+[-+\\d.]",
          "m",
        ).test(metrics),
    );
    // Stdout precedes OTLP export, and collector batching is asynchronous.
    // Require all actual signals within this one collection budget.
    if (
      checks.every(([, passed]) => passed) &&
      !missingMetricFamilies.length &&
      Date.now() <= deadline
    ) {
      completeInBudget = true;
      break;
    }
    const remaining = deadline - Date.now();
    if (remaining > 0)
      await new Promise((resolve) =>
        setTimeout(resolve, Math.min(250, remaining)),
      );
  }
  for (const [phase, passed] of checks) requireCheck(passed, phase);
  requireCheck(
    !missingMetricFamilies.length,
    "actual portable Prometheus metrics (missing: " +
      missingMetricFamilies.join(", ") +
      ")",
  );
  requireCheck(completeInBudget, "actual telemetry collection deadline");
  return {
    passed: true,
    actualFailedProvider: true,
    actualRetriedWorker: true,
    attempts: completed.attempts,
    inspectedRecords: records.length,
    privacySentinelAbsent: true,
    collectorSha256: createHash("sha256").update(collector).digest("hex"),
    metricsSha256: createHash("sha256").update(metrics).digest("hex"),
    noRawRecordsRetained: true,
  };
}
