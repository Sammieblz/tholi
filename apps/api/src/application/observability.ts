import { z } from "zod";
import type { ServiceErrorCode } from "../../../../packages/navigation-core/contracts-service";
import type {
  JobErrorCode,
  JobStatus,
} from "../../../../packages/navigation-core/contracts-jobs";

/** Server-generated operation identifiers, never account identity or metric labels. */
export const correlationSchema = z
  .object({
    requestId: z.string().uuid(),
    traceId: z.string().regex(/^(?!0{32}$)[a-f0-9]{32}$/),
    spanId: z.string().regex(/^(?!0{16}$)[a-f0-9]{16}$/),
    jobId: z.string().uuid().optional(),
  })
  .strict();
export type Correlation = Readonly<z.infer<typeof correlationSchema>>;

export const OBSERVATION_OPERATIONS = [
  "http.request",
  "identity.exchange",
  "identity.verify",
  "identity.keys",
  "smtp.send",
  "storage.put",
  "storage.read",
  "storage.delete",
  "storage.ready",
  "job.attempt",
  "job.claim",
  "job.schedule",
  "job.heartbeat",
  "job.failure",
  "job.acknowledge",
  "database.connect",
  "database.transaction",
  "runtime.lifecycle",
] as const;
export type ObservationOperation = (typeof OBSERVATION_OPERATIONS)[number];
export const OBSERVATION_OUTCOMES = [
  "ok",
  "error",
  "denied",
  "cancelled",
  "timeout",
  "unavailable",
  "retryable",
  "uncertain",
  "stale",
  "not-sent",
  "accepted",
  "stored",
  "deleted",
  "not-ready",
  "returned",
] as const;
export type ObservationOutcome = (typeof OBSERVATION_OUTCOMES)[number];

/** The adapter rebuilds this exact object and filters all finite label values. */
export interface ObservationFields {
  profile?: "service" | "legacy-private" | "worker";
  route?: string;
  provider?: "oidc" | "smtp" | "s3";
  jobKind?: string;
  jobStatus?: JobStatus;
  attempt?: number;
  statusCode?: number;
  errorCode?: ServiceErrorCode | JobErrorCode;
}

export const OBSERVATION_METRICS = {
  "operation.count": "counter",
  "operation.duration_ms": "histogram",
  "database.pool.wait_ms": "histogram",
  "database.pool.total": "gauge",
  "database.pool.idle": "gauge",
  "database.pool.waiting": "gauge",
  "database.failures": "counter",
  "job.retries": "counter",
  "job.stale_fences": "counter",
  "job.queue.age_ms": "gauge",
  "job.queue.count": "gauge",
  "job.health.available": "gauge",
  "worker.healthy": "gauge",
  "worker.active": "gauge",
  "worker.last_healthy_seconds": "gauge",
} as const;
export type ObservationMetric = keyof typeof OBSERVATION_METRICS;
export interface MetricFields extends ObservationFields {
  operation?: ObservationOperation;
  outcome?: ObservationOutcome;
}

export interface ObservationSpan {
  readonly correlation: Correlation | undefined;
  /** Ends once. Only fixed outcomes/codes leave the application boundary. */
  end(outcome: ObservationOutcome, fields?: ObservationFields): void;
}

export interface Observability {
  readonly enabled: boolean;
  readonly name: string;
  current(): Correlation | undefined;
  run<T>(correlation: Correlation | undefined, work: () => T): T;
  start(
    operation: ObservationOperation,
    fields?: ObservationFields,
    parent?: Partial<Correlation>,
  ): ObservationSpan;
  metric(name: ObservationMetric, value: number, fields?: MetricFields): void;
  ready(): true;
  /** Accept late completion while the existing runtime drains application work. */
  stop(): void;
  close(): Promise<void>;
}

const inactiveSpan: ObservationSpan = Object.freeze({
  correlation: undefined,
  end() {},
});
/** No context storage, identifiers, queues or exporter are allocated when disabled. */
export const NO_OBSERVABILITY: Observability = Object.freeze({
  enabled: false,
  name: "observability",
  current: () => undefined,
  run: <T>(_correlation: Correlation | undefined, work: () => T) => work(),
  start: () => inactiveSpan,
  metric() {},
  ready: () => true as const,
  stop() {},
  async close() {},
});

/** Explicit adapter instrumentation. The wrapped result/error itself is never recorded. */
export async function observeOperation<T>(
  observer: Observability,
  operation: ObservationOperation,
  fields: ObservationFields,
  work: () => Promise<T>,
  options: {
    outcome?: (result: T) => ObservationOutcome;
    signal?: AbortSignal;
    parent?: Partial<Correlation>;
  } = {},
): Promise<T> {
  if (!observer.enabled) return work();
  const span = observer.start(operation, fields, options.parent);
  return observer.run(span.correlation, async () => {
    try {
      const result = await work();
      span.end(options.outcome?.(result) ?? "ok");
      return result;
    } catch (error) {
      span.end(options.signal?.aborted ? "cancelled" : "error");
      throw error;
    }
  });
}

export interface ObservabilityOptions {
  enabled: boolean;
  service: "tholi-api" | "tholi-worker" | "tholi-private-api";
  otlpEndpoint?: string;
  allowLocal?: boolean;
  queueMaxRecords: number;
  queueMaxBytes: number;
  batchSize: number;
  batchMaxBytes: number;
  flushIntervalMs: number;
  exportTimeoutMs: number;
  shutdownTimeoutMs: number;
}
export const OBSERVABILITY_DEFAULTS = Object.freeze({
  queueMaxRecords: 256,
  queueMaxBytes: 262144,
  batchSize: 64,
  batchMaxBytes: 65536,
  flushIntervalMs: 1000,
  exportTimeoutMs: 2000,
  shutdownTimeoutMs: 2000,
});

export function validateObservabilityOptions(
  input: ObservabilityOptions,
  expectedService?: ObservabilityOptions["service"],
) {
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new Error("Invalid observability configuration.");
  const options = { ...input };
  const budgets = {
    queueMaxRecords: [1, 1024],
    queueMaxBytes: [1024, 1048576],
    batchSize: [1, 128],
    batchMaxBytes: [1024, 262144],
    flushIntervalMs: [10, 10000],
    exportTimeoutMs: [1, 2000],
    shutdownTimeoutMs: [1, 2000],
  } as const;
  if (
    typeof options.enabled !== "boolean" ||
    (expectedService !== undefined && options.service !== expectedService) ||
    (options.allowLocal !== undefined &&
      typeof options.allowLocal !== "boolean") ||
    Object.keys(options).some(
      (key) =>
        ![
          "enabled",
          "service",
          "otlpEndpoint",
          "allowLocal",
          ...Object.keys(budgets),
        ].includes(key),
    ) ||
    !["tholi-api", "tholi-worker", "tholi-private-api"].includes(
      options.service,
    ) ||
    Object.entries(budgets).some(([key, range]) => {
      const value = options[key as keyof typeof budgets];
      return (
        !Number.isSafeInteger(value) || value < range[0] || value > range[1]
      );
    }) ||
    options.batchSize > options.queueMaxRecords ||
    options.batchMaxBytes > options.queueMaxBytes
  )
    throw new Error("Invalid observability configuration.");
  if (options.otlpEndpoint !== undefined) {
    let endpoint: URL;
    try {
      endpoint = new URL(options.otlpEndpoint);
    } catch {
      throw new Error("Invalid observability endpoint.");
    }
    if (
      endpoint.username ||
      endpoint.password ||
      endpoint.search ||
      endpoint.hash ||
      endpoint.pathname !== "/" ||
      (endpoint.protocol !== "https:" &&
        !(
          options.allowLocal === true &&
          endpoint.protocol === "http:" &&
          ["telemetry", "localhost", "127.0.0.1", "[::1]"].includes(
            endpoint.hostname,
          )
        ))
    )
      throw new Error(
        "Use a verified HTTPS collector or explicit local collector origin.",
      );
    options.otlpEndpoint = endpoint.origin;
  }
  return Object.freeze(options);
}
