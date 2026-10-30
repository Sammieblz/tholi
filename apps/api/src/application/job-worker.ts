import { setTimeout as delay } from "node:timers/promises";
import { RepositoryError } from "../database/contracts";
import { JOB_HANDLERS } from "./identity-maintenance";
import { jobStatusSchema } from "../../../../packages/navigation-core/contracts-jobs";
import {
  NO_OBSERVABILITY,
  observeOperation,
  type Observability,
  type ObservationOutcome,
} from "./observability";
import {
  JobHandlerFailure,
  type JobFailure,
  registeredJobKinds,
  type RegisteredJobHandler,
  type JobLease,
  type JobStore,
  type JobWorkerOptions,
} from "./job-contracts";

interface ActiveJob {
  controller: AbortController;
  task: Promise<void>;
}

/** One bounded process runner. PostgreSQL owns scheduling slots, leases and acknowledgements. */
export class JobWorker {
  private readonly options: Readonly<JobWorkerOptions>;
  private readonly shutdown = new AbortController();
  private readonly active = new Map<string, ActiveJob>();
  private loop?: Promise<void>;
  private started = false;
  private running = false;
  private healthy = false;
  private lastHealthy = 0;
  private readonly handlers: readonly RegisteredJobHandler[];
  private readonly kinds: ReturnType<typeof registeredJobKinds>;

  constructor(
    private readonly store: JobStore,
    options: JobWorkerOptions,
    handlers: readonly RegisteredJobHandler[] = JOB_HANDLERS,
    private readonly observer: Observability = NO_OBSERVABILITY,
  ) {
    if (
      !options.workerId ||
      options.workerId.length > 100 ||
      !Object.entries(options)
        .filter(([key]) => key !== "workerId")
        .every(
          ([, value]) => Number.isSafeInteger(value) && Number(value) > 0,
        ) ||
      options.concurrency > 2 ||
      options.maxBackoffMs < 1000 ||
      options.maxBackoffMs > 60_000 ||
      options.heartbeatMs >= options.leaseMs
    )
      throw new Error("The worker configuration is invalid.");
    this.options = Object.freeze({ ...options });
    if (
      !handlers.length ||
      new Set(handlers.map((h) => `${h.kind}:${h.version}`)).size !==
        handlers.length
    )
      throw new Error("The worker registry is invalid.");
    this.handlers = Object.freeze(
      handlers.map((handler) => Object.freeze({ ...handler })),
    );
    this.kinds = registeredJobKinds(this.handlers);
  }

  async start(): Promise<void> {
    if (this.shutdown.signal.aborted)
      throw new Error("The worker has stopped.");
    if (this.started) return;
    this.started = true;
    this.running = true;
    this.observer.metric("worker.healthy", 0);
    this.observer.metric("worker.active", 0);
    this.loop = this.poll()
      .catch(() => {
        this.healthy = false;
      })
      .finally(() => {
        this.running = false;
      });
  }

  ready(): boolean {
    return this.running && this.healthy && !this.shutdown.signal.aborted;
  }

  lastHealthyAt(): number {
    return this.lastHealthy;
  }

  async stop(): Promise<void> {
    if (this.shutdown.signal.aborted) return;
    this.healthy = false;
    this.observer.metric("worker.healthy", 0);
    const reason = new JobHandlerFailure("retryable", "SHUTDOWN");
    this.shutdown.abort(reason);
    for (const job of this.active.values()) job.controller.abort(reason);
  }

  async close(): Promise<void> {
    await this.stop();
    await this.loop;
    await Promise.all([...this.active.values()].map((job) => job.task));
  }

  private recordHealthy() {
    if (this.shutdown.signal.aborted) return;
    this.healthy = true;
    this.lastHealthy = Date.now();
    this.observer.metric("worker.healthy", 1);
    this.observer.metric(
      "worker.last_healthy_seconds",
      this.lastHealthy / 1000,
    );
  }

  private async poll() {
    let nextSchedule = 0;
    while (!this.shutdown.signal.aborted) {
      try {
        let observedDatabase = false;
        if (Date.now() >= nextSchedule) {
          await observeOperation(
            this.observer,
            "job.schedule",
            { profile: "worker" },
            async () => {
              await this.store.scheduleBrokerPruning({
                limit: 100,
                intervalMs: this.options.scheduleIntervalMs,
              });
              for (const handler of this.handlers) {
                if ("external" in handler && handler.schedule)
                  await handler.schedule({
                    limit: 100,
                    intervalMs: this.options.scheduleIntervalMs,
                  });
              }
              if (this.store.health && this.observer.enabled) {
                try {
                  const rows = await this.store.health();
                  this.observer.metric("job.health.available", 1);
                  for (const kind of this.kinds)
                    for (const status of jobStatusSchema.options) {
                      const row = rows.find(
                        (row) =>
                          row.kind === kind.kind && row.status === status,
                      );
                      const labels = { jobKind: kind.kind, jobStatus: status };
                      this.observer.metric(
                        "job.queue.count",
                        Number(row?.count ?? 0),
                        labels,
                      );
                      this.observer.metric(
                        "job.queue.age_ms",
                        row?.oldest_age_ms ?? 0,
                        labels,
                      );
                    }
                } catch {
                  this.observer.metric("job.health.available", 0);
                }
              }
            },
          );
          nextSchedule = Date.now() + this.options.scheduleIntervalMs;
          observedDatabase = true;
        }
        const capacity = this.options.concurrency - this.active.size;
        if (capacity > 0 && !this.shutdown.signal.aborted) {
          const leases = await observeOperation(
            this.observer,
            "job.claim",
            { profile: "worker" },
            () =>
              this.store.claim({
                workerId: this.options.workerId,
                kinds: this.kinds,
                leaseMs: this.options.leaseMs,
                limit: capacity,
              }),
          );
          observedDatabase = true;
          for (const lease of leases) {
            if (this.shutdown.signal.aborted) {
              // A claim in flight when shutdown began has not executed any work.
              await this.reportFailure(lease, {
                classification: "retryable",
                code: "SHUTDOWN",
                backoffMs: this.backoff(lease.attempts),
              });
              continue;
            }
            if (this.active.size >= this.options.concurrency) {
              // Even a broken store cannot make this process exceed its budget.
              await this.reportFailure(lease, {
                classification: "retryable",
                code: "UNAVAILABLE",
                backoffMs: this.backoff(lease.attempts),
              });
              continue;
            }
            const controller = new AbortController();
            const key = lease.leaseToken;
            const task = this.execute(lease, controller).finally(() => {
              this.active.delete(key);
              this.observer.metric("worker.active", this.active.size);
            });
            this.active.set(key, { controller, task });
            this.observer.metric("worker.active", this.active.size);
          }
        }
        if (observedDatabase) this.recordHealthy();
      } catch {
        // Availability failures change health, never persist driver details.
        this.healthy = false;
        this.observer.metric("worker.healthy", 0);
      }
      await this.wait(this.options.pollMs, this.shutdown.signal);
    }
  }

  private async wait(milliseconds: number, signal: AbortSignal) {
    try {
      await delay(milliseconds, undefined, { signal });
    } catch {
      // Aborting a polling or heartbeat wait is normal lifecycle behavior.
    }
  }

  private async heartbeat(
    lease: JobLease,
    controller: AbortController,
    finished: AbortSignal,
  ) {
    while (!finished.aborted && !controller.signal.aborted) {
      await this.wait(this.options.heartbeatMs, finished);
      if (finished.aborted || controller.signal.aborted) return;
      try {
        const state = await observeOperation(
          this.observer,
          "job.heartbeat",
          { jobKind: lease.kind, attempt: lease.attempts },
          () => this.store.heartbeat(lease, this.options.leaseMs),
          {
            outcome: (state) =>
              state.cancelRequested
                ? "cancelled"
                : state.alive
                  ? "ok"
                  : "stale",
          },
        );
        if (finished.aborted) return;
        if (!state.alive || state.cancelRequested) {
          controller.abort(
            new JobHandlerFailure(
              "failed",
              state.cancelRequested ? "CANCELLED" : "LEASE_EXPIRED",
            ),
          );
          return;
        }
        this.recordHealthy();
      } catch {
        this.healthy = false;
        this.observer.metric("worker.healthy", 0);
        controller.abort(new JobHandlerFailure("retryable", "UNAVAILABLE"));
        return;
      }
    }
  }

  private failure(
    error: unknown,
    handler: RegisteredJobHandler | undefined,
    signal: AbortSignal,
    attempts: number,
  ): JobFailure {
    let failure: JobHandlerFailure;
    if (
      error instanceof JobHandlerFailure &&
      error.classification === "uncertain"
    )
      failure = error;
    else if (signal.aborted && signal.reason instanceof JobHandlerFailure)
      failure = signal.reason;
    else if (error instanceof JobHandlerFailure) failure = error;
    else if (error instanceof RepositoryError && error.code === "FORBIDDEN")
      failure = new JobHandlerFailure("failed", "AUTHORIZATION_REVOKED");
    else
      failure = new JobHandlerFailure(
        handler?.replaySafe ? "retryable" : "uncertain",
        "HANDLER_FAILED",
      );
    const classification =
      failure.classification === "retryable" && !handler?.replaySafe
        ? "uncertain"
        : failure.classification;
    return {
      classification,
      code: failure.code,
      backoffMs: classification === "retryable" ? this.backoff(attempts) : 0,
    };
  }

  private backoff(attempts: number) {
    const cap = Math.min(
      this.options.maxBackoffMs,
      this.options.pollMs * 2 ** Math.min(Math.max(attempts - 1, 0), 16),
    );
    return Math.max(1000, Math.floor(cap * (0.5 + Math.random() * 0.5)));
  }

  private async reportFailure(lease: JobLease, failure: JobFailure) {
    const span = this.observer.start(
      "job.failure",
      {
        jobKind: lease.kind,
        attempt: lease.attempts,
      },
      this.observer.current() ?? { ...lease.correlation, jobId: lease.id },
    );
    try {
      const changed = await this.store.fail(lease, failure);
      span.end(
        changed
          ? failure.classification === "failed"
            ? "error"
            : failure.classification
          : "stale",
        { errorCode: failure.code },
      );
      if (!changed)
        this.observer.metric("job.stale_fences", 1, { jobKind: lease.kind });
    } catch {
      // The lease will expire for another worker; a failed write is never an ack.
      this.healthy = false;
      this.observer.metric("worker.healthy", 0);
      span.end("unavailable");
    }
  }

  private async execute(lease: JobLease, controller: AbortController) {
    const span = this.observer.start(
      "job.attempt",
      { profile: "worker", jobKind: lease.kind, attempt: lease.attempts },
      { ...lease.correlation, jobId: lease.id },
    );
    if (lease.attempts > 1)
      this.observer.metric("job.retries", 1, { jobKind: lease.kind });
    return this.observer.run(span.correlation, async () => {
      const handler = this.handlers.find(
        (candidate) =>
          candidate.kind === lease.kind && candidate.version === lease.version,
      );
      if (!handler) {
        await this.reportFailure(lease, {
          classification: "failed",
          code: "UNSUPPORTED_JOB",
          backoffMs: 0,
        });
        span.end("error", { errorCode: "UNSUPPORTED_JOB" });
        return;
      }
      const finished = new AbortController();
      const heartbeat = this.heartbeat(lease, controller, finished.signal);
      let outcome: ObservationOutcome = "returned";
      try {
        controller.signal.throwIfAborted();
        if ("external" in handler) {
          await handler.execute(
            lease,
            controller.signal,
            this.backoff(lease.attempts),
          );
          return;
        }
        const acknowledged = await this.store.runJob(
          lease,
          async (transaction) => {
            controller.signal.throwIfAborted();
            const result = await handler.execute(
              transaction,
              lease,
              controller.signal,
            );
            controller.signal.throwIfAborted();
            return result;
          },
        );
        outcome = acknowledged ? "ok" : "stale";
        if (!acknowledged)
          this.observer.metric("job.stale_fences", 1, { jobKind: lease.kind });
        // A false result means a stale/cancelled fence. It must never be acknowledged.
      } catch (error) {
        const failure = this.failure(
          error,
          handler,
          controller.signal,
          lease.attempts,
        );
        outcome =
          failure.classification === "failed"
            ? "error"
            : failure.classification;
        await this.reportFailure(lease, failure);
      } finally {
        finished.abort();
        await heartbeat;
        span.end(outcome);
      }
    });
  }
}
