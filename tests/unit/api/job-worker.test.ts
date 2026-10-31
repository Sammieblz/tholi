import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JobHandlerFailure,
  type JobLease,
  type JobStore,
  type JobTransaction,
} from "../../../apps/api/src/application/job-contracts";
import {
  pruneExpiredBrokers,
  REGISTERED_JOB_KINDS,
} from "../../../apps/api/src/application/identity-maintenance";
import { JobWorker } from "../../../apps/api/src/application/job-worker";
import { RepositoryError } from "../../../apps/api/src/database/contracts";
import type { JobResult } from "../../../packages/navigation-core/contracts-jobs";
import { createObservability } from "../../../apps/api/src/adapters/observability";
import {
  NO_OBSERVABILITY,
  OBSERVABILITY_DEFAULTS,
  type Observability,
} from "../../../apps/api/src/application/observability";

const workers: JobWorker[] = [];
afterEach(async () => {
  await Promise.all(workers.splice(0).map((worker) => worker.close()));
  vi.restoreAllMocks();
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}

function fixture(count = 1, observer: Observability = NO_OBSERVABILITY) {
  const account = { id: randomUUID(), status: "active" as const, revision: 1n };
  const workspace = {
    id: randomUUID(),
    kind: "personal" as "personal" | "organization",
    ownerAccountId: account.id,
    revision: 1n,
  };
  const membership = {
    accountId: account.id,
    role: "owner" as const,
    status: "active" as "active" | "revoked",
    revision: 1n,
  };
  const transaction: JobTransaction = {
    getAccount: vi.fn(async () => account),
    getWorkspace: vi.fn(async () => workspace),
    getMembership: vi.fn(async () => membership),
    listConsents: vi.fn(async () => []),
    pruneExpiredBrokers: vi.fn(async () => 2),
  };
  const leases: JobLease[] = Array.from({ length: count }, () => ({
    id: randomUUID(),
    accountId: account.id,
    workspaceId: workspace.id,
    kind: pruneExpiredBrokers.kind,
    version: pruneExpiredBrokers.version,
    recordReferences: { accountId: account.id },
    attempts: 1,
    maxAttempts: 3,
    leaseToken: randomUUID(),
    leaseExpiresAt: new Date(Date.now() + 30_000),
  }));
  const queue = [...leases];
  const results: JobResult[] = [];
  const store: JobStore = {
    claim: vi.fn(async ({ limit }) => queue.splice(0, limit)),
    heartbeat: vi.fn(async () => ({ alive: true, cancelRequested: false })),
    fail: vi.fn(async () => true),
    scheduleBrokerPruning: vi.fn(async () => 1),
    runJob: vi.fn(async (_lease, work) => {
      results.push(await work(transaction));
      return true;
    }),
  };
  const worker = new JobWorker(
    store,
    {
      workerId: "unit-worker",
      concurrency: 2,
      pollMs: 5,
      leaseMs: 30_000,
      heartbeatMs: 10,
      maxBackoffMs: 60_000,
      scheduleIntervalMs: 60_000,
    },
    undefined,
    observer,
  );
  workers.push(worker);
  return {
    account,
    workspace,
    membership,
    transaction,
    leases,
    results,
    store,
    worker,
  };
}

const until = (condition: () => void) =>
  vi.waitFor(condition, { timeout: 1000, interval: 5 });

function expectRetryBudget(backoffMs: number) {
  expect(Number.isInteger(backoffMs)).toBe(true);
  expect(backoffMs).toBeGreaterThanOrEqual(1000);
  expect(backoffMs).toBeLessThanOrEqual(60_000);
}

describe("durable job worker", () => {
  it.each([false, true])(
    "reports SQL accounting aggregates without inventing a success denominator (unsafe precision: %s)",
    async (unsafe) => {
      const metric = vi.fn();
      const observer = { ...NO_OBSERVABILITY, enabled: true, metric };
      const f = fixture(0, observer);
      f.store.inferenceHealth = vi.fn(async () => ({
        settledProviderUsdMicros: unsafe ? "9007199254740993" : "1234",
        reservedProviderUsdMicros: "500",
        uncertainCount: "2",
        enabled: false,
      }));
      await f.worker.start();
      await until(() =>
        expect(metric).toHaveBeenCalledWith(
          "inference.health.available",
          unsafe ? 0 : 1,
        ),
      );
      await f.worker.close();
      if (unsafe) {
        expect(
          metric.mock.calls.some(
            ([name]) => name === "inference.settled_usd_micros",
          ),
        ).toBe(false);
      } else {
        expect(metric).toHaveBeenCalledWith(
          "inference.settled_usd_micros",
          1234,
        );
        expect(metric).toHaveBeenCalledWith(
          "inference.reserved_usd_micros",
          500,
        );
        expect(metric).toHaveBeenCalledWith("inference.uncertain_count", 2);
        expect(metric).toHaveBeenCalledWith("inference.enabled", 0);
        expect(metric).toHaveBeenCalledWith(
          "inference.verified_outcomes.available",
          0,
        );
      }
      expect(
        metric.mock.calls.some(
          ([name]) => name === "inference.cost_per_verified_success",
        ),
      ).toBe(false);
    },
  );

  it("keeps persisted originating correlation across real runner retries with fresh attempt spans", async () => {
    const lines: string[] = [];
    const observer = createObservability(
      { enabled: true, service: "tholi-worker", ...OBSERVABILITY_DEFAULTS },
      {
        write: (line, done) => {
          lines.push(line);
          done();
        },
      },
    );
    const origin = observer.start(
      "http.request",
      {},
      { requestId: randomUUID() },
    );
    const f = fixture(1, observer);
    f.leases[0].correlation = origin.correlation;
    const retry = { ...f.leases[0], attempts: 2, leaseToken: randomUUID() };
    vi.mocked(f.store.claim)
      .mockResolvedValueOnce(f.leases)
      .mockResolvedValueOnce([retry])
      .mockResolvedValue([]);
    vi.mocked(f.store.runJob).mockRejectedValueOnce(
      new JobHandlerFailure("retryable", "UNAVAILABLE"),
    );
    try {
      await f.worker.start();
      await until(() => expect(f.results).toHaveLength(1));
    } finally {
      await f.worker.close();
      origin.end("ok");
      await observer.close();
    }
    const records = lines.flatMap((line) =>
      line
        .trim()
        .split("\n")
        .map((value) => JSON.parse(value)),
    );
    const attempts = records.filter(
      (record) => record.operation === "job.attempt",
    );
    expect(attempts.map((record) => record.fields.attempt)).toEqual([1, 2]);
    expect(attempts.map((record) => record.outcome)).toEqual([
      "retryable",
      "ok",
    ]);
    expect(
      attempts.every(
        (record) =>
          record.correlation.traceId === origin.correlation?.traceId &&
          record.correlation.requestId === origin.correlation?.requestId &&
          record.correlation.jobId === f.leases[0].id,
      ),
    ).toBe(true);
    expect(attempts[0].correlation.spanId).not.toBe(
      attempts[1].correlation.spanId,
    );
    expect(lines.join("")).not.toContain(f.account.id);
    expect(lines.join("")).not.toContain(f.workspace.id);
  });
  it("runs the registered bounded handler through the sole fenced transaction owner", async () => {
    const f = fixture();
    expect(f.worker.ready()).toBe(false);
    expect(f.worker.lastHealthyAt()).toBe(0);
    await f.worker.start();
    await until(() => expect(f.results).toEqual([{ processed: 2 }]));
    expect(f.store.claim).toHaveBeenCalledWith({
      workerId: "unit-worker",
      kinds: REGISTERED_JOB_KINDS,
      leaseMs: 30_000,
      limit: 2,
    });
    expect(f.store.scheduleBrokerPruning).toHaveBeenCalledWith({
      limit: 100,
      intervalMs: 60_000,
    });
    expect(f.transaction.pruneExpiredBrokers).toHaveBeenCalledWith(100);
    expect(f.transaction.listConsents).not.toHaveBeenCalled();
    expect(f.store.fail).not.toHaveBeenCalled();
    expect(f.worker.ready()).toBe(true);
    expect(f.worker.lastHealthyAt()).toBeGreaterThan(0);
    await f.worker.close();
    expect(f.worker.ready()).toBe(false);
  });

  it.each(["foreign-reference", "raw-payload", "revoked", "organization"])(
    "refuses %s before pruning any authentication metadata",
    async (condition) => {
      const f = fixture();
      const lease = f.leases[0];
      if (condition === "foreign-reference")
        lease.recordReferences.accountId = randomUUID();
      if (condition === "raw-payload")
        Object.assign(lease.recordReferences, { prompt: "PRIVATE_SENTINEL" });
      if (condition === "revoked") f.membership.status = "revoked";
      if (condition === "organization") f.workspace.kind = "organization";
      await expect(
        pruneExpiredBrokers.execute(
          f.transaction,
          lease,
          new AbortController().signal,
        ),
      ).rejects.toMatchObject({
        classification: "failed",
        code:
          condition === "foreign-reference" || condition === "raw-payload"
            ? "UNSUPPORTED_JOB"
            : "AUTHORIZATION_REVOKED",
      });
      expect(f.transaction.pruneExpiredBrokers).not.toHaveBeenCalled();
    },
  );

  it("holds concurrency at two and aborts uncommitted work before draining", async () => {
    const f = fixture(3);
    const release = deferred<number>();
    vi.mocked(f.transaction.pruneExpiredBrokers).mockReturnValue(
      release.promise,
    );
    await f.worker.start();
    try {
      await until(() =>
        expect(f.transaction.pruneExpiredBrokers).toHaveBeenCalledTimes(2),
      );
      await new Promise((resolve) => setTimeout(resolve, 20));
      expect(f.store.runJob).toHaveBeenCalledTimes(2);
      const closing = f.worker.close();
      expect(f.worker.ready()).toBe(false);
      release.resolve(1);
      await closing;
      expect(f.results).toEqual([]);
      expect(f.store.fail).toHaveBeenCalledTimes(2);
      for (const [, failure] of vi.mocked(f.store.fail).mock.calls) {
        expect(failure).toMatchObject({
          classification: "retryable",
          code: "SHUTDOWN",
          backoffMs: expect.any(Number),
        });
        expectRetryBudget(failure.backoffMs);
      }
    } finally {
      release.resolve(0);
    }
  });

  it.each([
    [{ alive: true, cancelRequested: true }, "CANCELLED"],
    [{ alive: false, cancelRequested: false }, "LEASE_EXPIRED"],
  ] as const)("aborts on heartbeat state %j", async (state, code) => {
    const f = fixture();
    const release = deferred<number>();
    vi.mocked(f.transaction.pruneExpiredBrokers).mockReturnValue(
      release.promise,
    );
    vi.mocked(f.store.heartbeat).mockResolvedValue(state);
    await f.worker.start();
    try {
      await until(() => expect(f.store.heartbeat).toHaveBeenCalledOnce());
      release.resolve(3);
      await until(() =>
        expect(f.store.fail).toHaveBeenCalledWith(f.leases[0], {
          classification: "failed",
          code,
          backoffMs: 0,
        }),
      );
      expect(f.results).toEqual([]);
    } finally {
      release.resolve(0);
    }
  });

  it.each([
    [new Error("PRIVATE_DRIVER_SENTINEL"), "retryable", "HANDLER_FAILED"],
    [
      new RepositoryError("FORBIDDEN", "PRIVATE_ACCOUNT_SENTINEL"),
      "failed",
      "AUTHORIZATION_REVOKED",
    ],
    [
      new JobHandlerFailure("uncertain", "HANDLER_FAILED"),
      "uncertain",
      "HANDLER_FAILED",
    ],
  ] as const)(
    "persists only safe failure metadata for %s",
    async (error, classification, code) => {
      const f = fixture();
      vi.mocked(f.transaction.pruneExpiredBrokers).mockRejectedValue(error);
      await f.worker.start();
      await until(() => expect(f.store.fail).toHaveBeenCalledOnce());
      const failure = vi.mocked(f.store.fail).mock.calls[0][1];
      expect(failure).toEqual({
        classification,
        code,
        backoffMs: classification === "retryable" ? expect.any(Number) : 0,
      });
      if (classification === "retryable") expectRetryBudget(failure.backoffMs);
      expect(JSON.stringify(failure)).not.toContain("PRIVATE_");
      expect(f.results).toEqual([]);
    },
  );

  it("does not acknowledge or fail a stale database fence", async () => {
    const f = fixture();
    vi.mocked(f.store.runJob).mockResolvedValue(false);
    await f.worker.start();
    await until(() => expect(f.store.runJob).toHaveBeenCalledOnce());
    await f.worker.close();
    expect(f.transaction.pruneExpiredBrokers).not.toHaveBeenCalled();
    expect(f.store.fail).not.toHaveBeenCalled();
  });

  it("marks failed polling unhealthy and recovers after a successful database cycle", async () => {
    const f = fixture(0);
    const recovery = deferred<JobLease[]>();
    vi.mocked(f.store.claim)
      .mockRejectedValueOnce(new Error("PRIVATE_CONNECTION_SENTINEL"))
      .mockReturnValue(recovery.promise);
    await f.worker.start();
    try {
      await until(() => expect(f.store.claim).toHaveBeenCalledTimes(2));
      expect(f.worker.ready()).toBe(false);
      expect(f.worker.lastHealthyAt()).toBe(0);
      recovery.resolve([]);
      await until(() => expect(f.worker.ready()).toBe(true));
    } finally {
      recovery.resolve([]);
    }
  });

  it("returns an unstarted claim obtained during shutdown without executing it", async () => {
    const f = fixture();
    const pendingClaim = deferred<JobLease[]>();
    vi.mocked(f.store.claim).mockReturnValue(pendingClaim.promise);
    await f.worker.start();
    await until(() => expect(f.store.claim).toHaveBeenCalledOnce());
    const closing = f.worker.close();
    pendingClaim.resolve(f.leases);
    await closing;
    expect(f.store.runJob).not.toHaveBeenCalled();
    expect(f.store.fail).toHaveBeenCalledWith(f.leases[0], {
      classification: "retryable",
      code: "SHUTDOWN",
      backoffMs: expect.any(Number),
    });
    expectRetryBudget(vi.mocked(f.store.fail).mock.calls[0][1].backoffMs);
  });
});
