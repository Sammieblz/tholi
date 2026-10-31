import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes, randomUUID } from "node:crypto";
import apiPackage from "../../package.json" with { type: "json" };
import { serviceErrorCodeSchema } from "../../../../packages/navigation-core/contracts-service";
import {
  jobErrorCodeSchema,
  jobStatusSchema,
} from "../../../../packages/navigation-core/contracts-jobs";
import { SERVICE_ROUTES } from "../routes/service-inventory";
import { REGISTERED_JOB_KINDS } from "../application/identity-maintenance";
import { SUPPORT_JOB_KINDS } from "../application/support-jobs";
import { INFERENCE_RECONCILIATION_JOB_KIND } from "../application/quotas";
import {
  correlationSchema,
  validateObservabilityOptions,
  NO_OBSERVABILITY,
  OBSERVATION_METRICS,
  OBSERVATION_OPERATIONS,
  OBSERVATION_OUTCOMES,
  type Correlation,
  type MetricFields,
  type Observability,
  type ObservabilityOptions,
  type ObservationFields,
  type ObservationMetric,
  type ObservationOperation,
  type ObservationOutcome,
} from "../application/observability";

const routes = new Set<string>([
  ...SERVICE_ROUTES.map((route) => route.operationId),
  "health.live",
  "health.ready",
  "unmatched",
]);
const kinds = new Set(
  [
    ...REGISTERED_JOB_KINDS,
    ...SUPPORT_JOB_KINDS,
    INFERENCE_RECONCILIATION_JOB_KIND,
  ].map((job) => job.kind),
);
const codes = new Set<string>([
  ...serviceErrorCodeSchema.options,
  ...jobErrorCodeSchema.options,
]);
const operations = new Set<string>(OBSERVATION_OPERATIONS);
const outcomes = new Set<string>(OBSERVATION_OUTCOMES);
const bounds = [
  1, 5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000, 25000,
];
const maxSeries = 512;

/** Reconstruct finite fields; unknown properties and strings are never serialized. */
function fields(input: ObservationFields = {}): ObservationFields {
  return {
    ...(["service", "legacy-private", "worker"].includes(input.profile ?? "")
      ? { profile: input.profile }
      : {}),
    ...(routes.has(input.route ?? "") ? { route: input.route } : {}),
    ...(["oidc", "smtp", "s3"].includes(input.provider ?? "")
      ? { provider: input.provider }
      : {}),
    ...(kinds.has(input.jobKind ?? "") ? { jobKind: input.jobKind } : {}),
    ...(jobStatusSchema.options.includes(input.jobStatus!)
      ? { jobStatus: input.jobStatus }
      : {}),
    ...(Number.isInteger(input.attempt) &&
    input.attempt! >= 1 &&
    input.attempt! <= 100
      ? { attempt: input.attempt }
      : {}),
    ...(Number.isInteger(input.statusCode) &&
    input.statusCode! >= 100 &&
    input.statusCode! <= 599
      ? { statusCode: input.statusCode }
      : {}),
    ...(codes.has(input.errorCode ?? "") ? { errorCode: input.errorCode } : {}),
  };
}
function parentCorrelation(input?: Partial<Correlation>) {
  const trace = correlationSchema.shape.traceId.safeParse(input?.traceId);
  const span = correlationSchema.shape.spanId.safeParse(input?.spanId);
  const request = correlationSchema.shape.requestId.safeParse(input?.requestId);
  const job = correlationSchema.shape.jobId.safeParse(input?.jobId);
  return {
    correlation: Object.freeze({
      requestId: request.success ? request.data : randomUUID(),
      traceId:
        trace.success && span.success
          ? trace.data
          : randomBytes(16).toString("hex"),
      spanId: randomBytes(8).toString("hex"),
      ...(job.success && job.data ? { jobId: job.data } : {}),
    }),
    parentSpanId: trace.success && span.success ? span.data : undefined,
  };
}

interface OperationRecord {
  schemaVersion: 1;
  timestamp: string;
  service: ObservabilityOptions["service"];
  operation: ObservationOperation;
  outcome: ObservationOutcome;
  correlation: Correlation;
  parentSpanId?: string;
  durationMs: number;
  fields: ObservationFields;
}
interface MetricSeries {
  name: ObservationMetric;
  labels: Record<string, string | number>;
  count: number;
  sum: number;
  value: number;
  buckets: number[];
  min: number;
  max: number;
}
export interface ObservabilityDependencies {
  fetch?: typeof fetch;
  write?: (value: string, completed: (error?: Error | null) => void) => void;
}
function attributes(values: Record<string, unknown>) {
  return Object.entries(values).map(([key, value]) => ({
    key: "tholi." + key,
    value:
      typeof value === "number"
        ? { intValue: String(value) }
        : { stringValue: String(value) },
  }));
}

/** Manual, content-free OTLP. No automatic HTTP/SQL instrumentation or global context. */
export function createObservability(
  input?: ObservabilityOptions,
  dependencies: ObservabilityDependencies = {},
) {
  if (input === undefined) return NO_OBSERVABILITY;
  const options = validateObservabilityOptions(input);
  if (!options.enabled) return NO_OBSERVABILITY;
  const context = new AsyncLocalStorage<Correlation | undefined>();
  const fetcher = dependencies.fetch ?? fetch;
  const write =
    dependencies.write ??
    ((value, done) => {
      process.stdout.write(value, done);
    });
  const queue: { record: OperationRecord; bytes: number }[] = [];
  const series = new Map<string, MetricSeries>();
  const shutdown = new AbortController();
  const startedAt = BigInt(Date.now()) * 1000000n;
  let queuedBytes = 0,
    dropped = 0,
    exportFailures = 0,
    accepting = true;
  let active: Promise<void> | undefined, closing: Promise<void> | undefined;
  let logPending = false,
    dirty = false;
  const profile =
    options.service === "tholi-worker"
      ? "worker"
      : options.service === "tholi-private-api"
        ? "legacy-private"
        : "service";
  const resource = {
    attributes: [
      { key: "service.name", value: { stringValue: options.service } },
      { key: "service.version", value: { stringValue: apiPackage.version } },
      { key: "service.instance.id", value: { stringValue: randomUUID() } },
    ],
  };
  const scope = { name: "tholi.manual-observability", version: "1" };

  const metric = (
    name: ObservationMetric,
    value: number,
    input: MetricFields = {},
  ) => {
    if (
      !accepting ||
      !Object.hasOwn(OBSERVATION_METRICS, name) ||
      !Number.isFinite(value) ||
      value < 0 ||
      value > Number.MAX_SAFE_INTEGER
    )
      return;
    const { attempt: _attempt, ...safe } = fields(input);
    const labels = {
      profile,
      ...safe,
      ...(operations.has(input.operation ?? "")
        ? { operation: input.operation }
        : {}),
      ...(outcomes.has(input.outcome ?? "") ? { outcome: input.outcome } : {}),
    } as Record<string, string | number>;
    const key = name + JSON.stringify(labels);
    let item = series.get(key);
    if (!item) {
      if (series.size >= maxSeries) {
        dropped++;
        return;
      }
      item = {
        name,
        labels,
        count: 0,
        sum: 0,
        value: 0,
        buckets: Array(bounds.length + 1).fill(0),
        min: value,
        max: value,
      };
      series.set(key, item);
    }
    item.count++;
    item.sum += value;
    item.value = value;
    item.min = Math.min(item.min, value);
    item.max = Math.max(item.max, value);
    const bucket = bounds.findIndex((bound) => value <= bound);
    item.buckets[bucket < 0 ? bounds.length : bucket]++;
    dirty = true;
  };

  async function stdout(records: OperationRecord[]) {
    if (!records.length) return;
    if (logPending || shutdown.signal.aborted) {
      dropped += records.length;
      return;
    }
    const value =
      records.map((record) => JSON.stringify(record)).join("\n") + "\n";
    logPending = true;
    await new Promise<void>((resolve) => {
      let completed = false;
      const done = () => {
        if (completed) return;
        completed = true;
        clearTimeout(timer);
        shutdown.signal.removeEventListener("abort", done);
        resolve();
      };
      const timer = setTimeout(() => {
        dropped += records.length;
        done();
      }, options.exportTimeoutMs);
      timer.unref();
      shutdown.signal.addEventListener("abort", done, { once: true });
      try {
        write(value, (error) => {
          logPending = false;
          if (error) dropped += records.length;
          done();
        });
      } catch {
        logPending = false;
        dropped += records.length;
        done();
      }
    });
  }
  async function responseJson(response: Response, signal: AbortSignal) {
    if (!response.body) return {};
    const reader = response.body.getReader();
    const cancel = () => {
      void reader.cancel().catch(() => {});
    };
    signal.addEventListener("abort", cancel, { once: true });
    let size = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        signal.throwIfAborted();
        const { value, done } = await reader.read();
        signal.throwIfAborted();
        if (done) break;
        size += value.byteLength;
        if (size > 16384) {
          await reader.cancel();
          throw new Error("Collector response exceeds budget.");
        }
        chunks.push(value);
      }
      return size
        ? (JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<
            string,
            unknown
          >)
        : {};
    } finally {
      signal.removeEventListener("abort", cancel);
      reader.releaseLock();
    }
  }
  async function send(signal: "traces" | "logs" | "metrics", payload: unknown) {
    if (!options.otlpEndpoint || shutdown.signal.aborted) return;
    const body = JSON.stringify(payload);
    for (let attempt = 0; attempt < 2 && !shutdown.signal.aborted; attempt++) {
      try {
        const activeSignal = AbortSignal.any([
          shutdown.signal,
          AbortSignal.timeout(options.exportTimeoutMs),
        ]);
        const response = await fetcher(options.otlpEndpoint + "/v1/" + signal, {
          method: "POST",
          redirect: "manual",
          credentials: "omit",
          headers: { "Content-Type": "application/json" },
          body,
          signal: activeSignal,
        });
        if (response.status === 200) {
          let result: Record<string, unknown>;
          try {
            result = await responseJson(response, activeSignal);
          } catch {
            exportFailures++;
            return;
          }
          const partial = result.partialSuccess;
          if (
            partial !== undefined &&
            (typeof partial !== "object" ||
              partial === null ||
              Object.entries(partial).some(
                ([key, value]) =>
                  key.startsWith("rejected") && Number(value) !== 0,
              ))
          )
            exportFailures++;
          return;
        }
        await response.body?.cancel().catch(() => {});
        if (![429, 502, 503, 504].includes(response.status)) {
          exportFailures++;
          return;
        }
        const retry = response.headers.get("retry-after");
        if (retry && (!/^\d+$/.test(retry) || Number(retry) > 1)) {
          exportFailures++;
          return;
        }
        if (attempt === 1) {
          exportFailures++;
          return;
        }
        await wait(
          retry ? Number(retry) * 1000 : 100 + Math.floor(Math.random() * 150),
        );
      } catch {
        if (shutdown.signal.aborted || attempt === 1) {
          exportFailures++;
          return;
        }
        await wait(100 + Math.floor(Math.random() * 150));
      }
    }
  }
  async function sendItems(
    signal: "traces" | "logs" | "metrics",
    items: unknown[],
    envelope: (items: unknown[]) => unknown,
  ) {
    const overhead = Buffer.byteLength(JSON.stringify(envelope([])));
    let batch: unknown[] = [],
      bytes = overhead;
    for (const item of items) {
      const size = Buffer.byteLength(JSON.stringify(item)) + 1;
      if (size + overhead > options.batchMaxBytes) {
        dropped++;
        continue;
      }
      if (bytes + size > options.batchMaxBytes && batch.length) {
        await send(signal, envelope(batch));
        batch = [];
        bytes = overhead;
      }
      if (shutdown.signal.aborted) return;
      batch.push(item);
      bytes += size;
    }
    if (batch.length) await send(signal, envelope(batch));
  }
  async function wait(milliseconds: number) {
    if (shutdown.signal.aborted) return;
    await new Promise<void>((resolve) => {
      const finish = () => {
        clearTimeout(timer);
        shutdown.signal.removeEventListener("abort", finish);
        resolve();
      };
      const timer = setTimeout(finish, milliseconds);
      shutdown.signal.addEventListener("abort", finish, { once: true });
    });
  }
  async function exportBatch(
    records: OperationRecord[],
    metricsDirty: boolean,
  ) {
    if (!options.otlpEndpoint) return;
    if (records.length) {
      const spans = records.map((record) => {
        const start = BigInt(Date.parse(record.timestamp)) * 1000000n;
        return {
          traceId: record.correlation.traceId,
          spanId: record.correlation.spanId,
          ...(record.parentSpanId ? { parentSpanId: record.parentSpanId } : {}),
          name: record.operation,
          kind:
            record.operation === "http.request"
              ? 2
              : record.operation.startsWith("job.")
                ? 1
                : 3,
          startTimeUnixNano: start.toString(),
          endTimeUnixNano: (
            start + BigInt(Math.round(record.durationMs * 1000000))
          ).toString(),
          attributes: attributes({
            ...record.fields,
            outcome: record.outcome,
            requestId: record.correlation.requestId,
            ...(record.correlation.jobId
              ? { jobId: record.correlation.jobId }
              : {}),
          }),
          status: {
            code: ["ok", "accepted", "stored", "deleted"].includes(
              record.outcome,
            )
              ? 1
              : 2,
          },
        };
      });
      await sendItems("traces", spans, (spans) => ({
        resourceSpans: [{ resource, scopeSpans: [{ scope, spans }] }],
      }));
      const logRecords = records.map((record) => ({
        timeUnixNano: (
          BigInt(Date.parse(record.timestamp)) * 1000000n
        ).toString(),
        severityNumber: ["ok", "accepted", "stored", "deleted"].includes(
          record.outcome,
        )
          ? 9
          : 13,
        body: { stringValue: record.operation },
        traceId: record.correlation.traceId,
        spanId: record.correlation.spanId,
        attributes: attributes({
          ...record.fields,
          outcome: record.outcome,
          requestId: record.correlation.requestId,
          ...(record.correlation.jobId
            ? { jobId: record.correlation.jobId }
            : {}),
        }),
      }));
      await sendItems("logs", logRecords, (logRecords) => ({
        resourceLogs: [{ resource, scopeLogs: [{ scope, logRecords }] }],
      }));
    }
    if (metricsDirty) {
      const now = (BigInt(Date.now()) * 1000000n).toString();
      const metrics = [...series.values()].map((item) => {
        const point = {
          attributes: attributes(item.labels),
          startTimeUnixNano: startedAt.toString(),
          timeUnixNano: now,
        };
        const kind = OBSERVATION_METRICS[item.name];
        return {
          name: "tholi_" + item.name.replaceAll(".", "_"),
          ...(kind === "histogram"
            ? {
                histogram: {
                  aggregationTemporality: 2,
                  dataPoints: [
                    {
                      ...point,
                      count: String(item.count),
                      sum: item.sum,
                      bucketCounts: item.buckets.map(String),
                      explicitBounds: bounds,
                      min: item.min,
                      max: item.max,
                    },
                  ],
                },
              }
            : kind === "counter"
              ? {
                  sum: {
                    aggregationTemporality: 2,
                    isMonotonic: true,
                    dataPoints: [{ ...point, asDouble: item.sum }],
                  },
                }
              : {
                  gauge: { dataPoints: [{ ...point, asDouble: item.value }] },
                }),
        };
      });
      for (const [name, value] of [
        ["tholi_telemetry_dropped_total", dropped],
        ["tholi_telemetry_export_failures_total", exportFailures],
      ] as const)
        metrics.push({
          name,
          sum: {
            aggregationTemporality: 2,
            isMonotonic: true,
            dataPoints: [
              {
                attributes: [],
                startTimeUnixNano: startedAt.toString(),
                timeUnixNano: now,
                asDouble: value,
              },
            ],
          },
        });
      await sendItems("metrics", metrics, (metrics) => ({
        resourceMetrics: [{ resource, scopeMetrics: [{ scope, metrics }] }],
      }));
    }
  }
  function pump(): Promise<void> {
    if (active) return active;
    active = (async () => {
      while ((queue.length || dirty) && !shutdown.signal.aborted) {
        const records: OperationRecord[] = [];
        let bytes = 0;
        while (
          queue.length &&
          records.length < options.batchSize &&
          bytes + queue[0].bytes <= options.batchMaxBytes
        ) {
          const item = queue.shift()!;
          records.push(item.record);
          bytes += item.bytes;
          queuedBytes -= item.bytes;
        }
        const metricsDirty = dirty;
        dirty = false;
        await stdout(records);
        await exportBatch(records, metricsDirty);
      }
    })()
      .catch(() => {
        exportFailures++;
      })
      .finally(() => {
        active = undefined;
      });
    return active;
  }
  const timer = setInterval(() => {
    void pump();
  }, options.flushIntervalMs);
  timer.unref();
  const observation: Observability = {
    enabled: true,
    name: "observability",
    current: () => context.getStore(),
    run: (correlation, work) => {
      if (correlation === undefined) return context.run(undefined, work);
      const parsed = correlationSchema.safeParse(correlation);
      return parsed.success
        ? context.run(Object.freeze(parsed.data), work)
        : context.run(undefined, work);
    },
    start(operation, input = {}, parent) {
      if (!accepting || !operations.has(operation))
        return NO_OBSERVABILITY.start(operation);
      const { correlation, parentSpanId } = parentCorrelation(
        parent ?? context.getStore(),
      );
      const initial = fields({ profile, ...input });
      const timestamp = new Date().toISOString(),
        started = performance.now();
      let ended = false;
      return {
        correlation,
        end(outcome, final = {}) {
          if (ended) return;
          ended = true;
          if (!accepting || !outcomes.has(outcome)) return;
          const safe = { ...initial, ...fields(final) };
          const durationMs = Math.min(
            300000,
            Math.max(0, performance.now() - started),
          );
          const record: OperationRecord = {
            schemaVersion: 1,
            timestamp,
            service: options.service,
            operation,
            outcome,
            correlation,
            ...(parentSpanId ? { parentSpanId } : {}),
            durationMs,
            fields: safe,
          };
          metric("operation.count", 1, { ...safe, operation, outcome });
          metric("operation.duration_ms", durationMs, {
            ...safe,
            operation,
            outcome,
          });
          const bytes = Buffer.byteLength(JSON.stringify(record)) + 1;
          if (
            bytes > options.batchMaxBytes ||
            queue.length >= options.queueMaxRecords ||
            queuedBytes + bytes > options.queueMaxBytes
          ) {
            dropped++;
            return;
          }
          queue.push({ record, bytes });
          queuedBytes += bytes;
          if (queue.length >= options.batchSize)
            queueMicrotask(() => {
              void pump();
            });
        },
      };
    },
    metric,
    ready: () => true,
    stop() {},
    close() {
      return (closing ??= (async () => {
        accepting = false;
        clearInterval(timer);
        let timeout: ReturnType<typeof setTimeout>;
        await Promise.race([
          pump(),
          new Promise<void>((resolve) => {
            timeout = setTimeout(() => {
              shutdown.abort();
              resolve();
            }, options.shutdownTimeoutMs);
          }),
        ]);
        clearTimeout(timeout!);
        shutdown.abort();
        dropped += queue.length;
        queue.length = 0;
        queuedBytes = 0;
        context.disable();
      })());
    },
  };
  return observation;
}
