import { createHash } from "node:crypto";

function requireCheck(value, phase) {
  if (!value)
    throw new Error("Local observability check failed: " + phase + ".");
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
  let api, worker, collector, records;
  while (Date.now() < deadline) {
    [api, worker, collector] = await Promise.all(
      ["api", "worker", "telemetry"].map((service) =>
        compose([
          "logs",
          "--no-color",
          "--no-log-prefix",
          "--since",
          since,
          service,
        ]),
      ),
    );
    requireCheck(
      ![api, worker, collector].some((value) => value.includes(sentinel)),
      "private sentinels absent from actual logs and collector",
    );
    records = (api + "\n" + worker)
      .split(/\r?\n/)
      .filter((line) => line.startsWith("{"))
      .map((line) => JSON.parse(line));
    if (
      collector.includes(submitted.correlation.traceId) &&
      records.some(
        (record) =>
          record.operation === "smtp.send" &&
          record.outcome === "accepted" &&
          record.correlation?.traceId === submitted.correlation.traceId,
      )
    )
      break;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  const origin = submitted.correlation;
  const failedHttp = records.find(
    (record) =>
      record.operation === "http.request" &&
      record.correlation?.requestId === submitted.failedProviderRequestId,
  );
  requireCheck(
    failedHttp &&
      records.some(
        (record) =>
          record.operation === "identity.exchange" &&
          record.outcome !== "ok" &&
          record.correlation?.requestId === submitted.failedProviderRequestId &&
          record.correlation.traceId === failedHttp.correlation.traceId &&
          record.parentSpanId === failedHttp.correlation.spanId,
      ),
    "actual failed OIDC request and provider parent span",
  );
  requireCheck(
    records.some(
      (record) =>
        record.operation === "http.request" &&
        record.correlation?.requestId === origin.requestId &&
        record.correlation.traceId === origin.traceId,
    ),
    "actual enqueue HTTP origin",
  );
  const attempts = records.filter(
    (record) =>
      record.operation === "job.attempt" &&
      record.correlation?.jobId === submitted.jobId,
  );
  requireCheck(
    attempts.length >= 2 &&
      new Set(attempts.map((record) => record.correlation.spanId)).size ===
        attempts.length &&
      attempts.every(
        (record) =>
          record.correlation.traceId === origin.traceId &&
          record.correlation.requestId === origin.requestId,
      ),
    "retried worker preserves trace with fresh attempt spans",
  );
  const mail = records.filter(
    (record) =>
      record.operation === "smtp.send" &&
      record.correlation?.jobId === submitted.jobId,
  );
  requireCheck(
    mail.some((record) => record.outcome === "not-sent") &&
      mail.some((record) => record.outcome === "accepted"),
    "actual interrupted and accepted SMTP attempts",
  );
  requireCheck(
    collector.includes(origin.traceId) &&
      collector.includes(failedHttp.correlation.traceId) &&
      collector.includes("tholi_operation_duration_ms") &&
      collector.includes("tholi_worker_healthy"),
    "actual collector traces logs and metrics",
  );
  const metrics = await compose([
    "exec",
    "-T",
    "api",
    "node",
    "--input-type=module",
    "-e",
    "const response=await fetch('http://telemetry:8889/metrics',{signal:AbortSignal.timeout(5000)});if(!response.ok)throw Error('Metric scrape failed.');process.stdout.write(await response.text());",
  ]);
  requireCheck(
    ![sentinel, origin.requestId, origin.traceId, submitted.jobId].some(
      (value) => metrics.includes(value),
    ),
    "private and request identifiers absent from metric labels",
  );
  requireCheck(
    [
      "tholi_operation_count_total",
      "tholi_operation_duration_ms_bucket",
      "tholi_worker_healthy",
      "tholi_database_pool_total",
      "tholi_job_retries_total",
    ].every((name) => metrics.includes(name)),
    "actual portable Prometheus metrics",
  );
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
