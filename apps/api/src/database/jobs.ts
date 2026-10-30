import type { Pool } from "pg";
import type {
  JobFailure,
  JobKind,
  JobLease,
  JobStore,
  JobTransaction,
} from "../application/job-contracts";
import {
  jobErrorCodeSchema,
  type JobResult,
} from "../../../../packages/navigation-core/contracts-jobs";
import { RepositoryError } from "./contracts";
import { PostgresRepositories } from "./repositories";

function bounded(value: number, minimum: number, maximum: number) {
  if (!Number.isInteger(value) || value < minimum || value > maximum)
    throw new RepositoryError("INVALID_INPUT", "Use a bounded worker budget.");
  return value;
}

/** Global work admission exposes queue metadata only; effects reuse scoped repos. */
export class PostgresJobs implements JobStore {
  private readonly repositories: PostgresRepositories;
  constructor(private readonly pool: Pool) {
    this.repositories = new PostgresRepositories(pool);
  }

  async claim(input: {
    workerId: string;
    kinds: readonly JobKind[];
    leaseMs: number;
    limit: number;
  }): Promise<JobLease[]> {
    input = structuredClone(input);
    if (
      !input.workerId ||
      input.workerId.length > 100 ||
      !Array.isArray(input.kinds) ||
      input.kinds.length < 1 ||
      input.kinds.length > 100
    )
      throw new RepositoryError(
        "INVALID_INPUT",
        "Use registered bounded job kinds.",
      );
    const kinds = input.kinds.map((kind) => {
      if (
        !kind.kind ||
        kind.kind.length > 100 ||
        !Number.isInteger(kind.version) ||
        kind.version < 1 ||
        kind.version > 2147483647 ||
        typeof kind.replaySafe !== "boolean"
      )
        throw new RepositoryError(
          "INVALID_INPUT",
          "Use registered bounded job kinds.",
        );
      return {
        kind: kind.kind,
        version: kind.version,
        replaySafe: kind.replaySafe,
      };
    });
    const result = await this.pool.query<{
      id: string;
      workspace_id: string;
      account_id: string;
      kind: string;
      version: number;
      record_references: JobLease["recordReferences"];
      attempts: number;
      max_attempts: number;
      claim_token: string;
      lease_expires_at: Date;
    }>("SELECT * FROM tholi.claim_jobs($1,$2,$3,$4::jsonb)", [
      input.workerId,
      bounded(input.limit, 1, 10),
      bounded(input.leaseMs, 1000, 120000),
      JSON.stringify(kinds),
    ]);
    return result.rows.map((row) => ({
      id: row.id,
      workspaceId: row.workspace_id,
      accountId: row.account_id,
      kind: row.kind,
      version: row.version,
      recordReferences: row.record_references,
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
      leaseToken: row.claim_token,
      leaseExpiresAt: row.lease_expires_at,
    }));
  }

  async heartbeat(
    lease: JobLease,
    leaseMs: number,
  ): Promise<{ alive: boolean; cancelRequested: boolean }> {
    lease = structuredClone(lease);
    const result = await this.pool.query<{
      alive: boolean;
      cancel_requested: boolean;
    }>("SELECT * FROM tholi.heartbeat_job($1,$2,$3,$4)", [
      lease.workspaceId,
      lease.id,
      lease.leaseToken,
      bounded(leaseMs, 1000, 120000),
    ]);
    return {
      alive: result.rows[0].alive,
      cancelRequested: result.rows[0].cancel_requested,
    };
  }

  async fail(lease: JobLease, failure: JobFailure): Promise<boolean> {
    lease = structuredClone(lease);
    failure = structuredClone(failure);
    jobErrorCodeSchema.parse(failure.code);
    if (!["retryable", "failed", "uncertain"].includes(failure.classification))
      throw new RepositoryError(
        "INVALID_INPUT",
        "Use a known failure classification.",
      );
    return (
      await this.pool.query<{ changed: boolean }>(
        "SELECT tholi.fail_job($1,$2,$3,$4,$5,$6) AS changed",
        [
          lease.workspaceId,
          lease.id,
          lease.leaseToken,
          failure.classification,
          failure.code,
          bounded(
            failure.backoffMs,
            failure.classification === "retryable" ? 1000 : 0,
            60000,
          ),
        ],
      )
    ).rows[0].changed;
  }

  runJob(
    lease: JobLease,
    work: (transaction: JobTransaction) => Promise<JobResult>,
  ): Promise<boolean> {
    return this.repositories.runJob(lease, work);
  }

  async scheduleBrokerPruning(input: {
    limit: number;
    intervalMs: number;
  }): Promise<number> {
    input = structuredClone(input);
    const scopes = await this.pool.query<{
      account_id: string;
      workspace_id: string;
      slot: Date;
    }>("SELECT * FROM tholi.broker_prune_candidates($1,$2)", [
      bounded(input.limit, 1, 100),
      bounded(input.intervalMs, 1000, 86400000),
    ]);
    let scheduled = 0;
    for (const scope of scopes.rows) {
      try {
        await this.repositories.transaction(
          { accountId: scope.account_id, workspaceId: scope.workspace_id },
          (repositories) =>
            repositories.enqueueJob({
              kind: "identity.prune-expired-brokers",
              version: 1,
              replaySafe: true,
              recordReferences: { accountId: scope.account_id },
              idempotencyKey: `broker-prune:${scope.account_id}:${scope.slot.toISOString()}`,
              availableAt: scope.slot,
              maxAttempts: 3,
            }),
        );
        scheduled++;
      } catch (error) {
        if (!(error instanceof RepositoryError && error.code === "FORBIDDEN"))
          throw error;
      }
    }
    return scheduled;
  }

  /** Operator pool only. Registered kinds supply safety, never a client boolean. */
  async retryDead(
    input: {
      workspaceId: string;
      id: string;
      expectedRevision: bigint;
      kind: string;
      version: number;
    },
    kinds: readonly JobKind[],
  ): Promise<boolean> {
    input = structuredClone(input);
    if (
      !kinds.some(
        (kind) =>
          kind.kind === input.kind &&
          kind.version === input.version &&
          kind.replaySafe,
      )
    )
      throw new RepositoryError(
        "INVALID_INPUT",
        "Only a registered safe dead job can be recovered.",
      );
    if (input.expectedRevision < 1n)
      throw new RepositoryError(
        "INVALID_INPUT",
        "Use the current job revision.",
      );
    return (
      await this.pool.query<{ changed: boolean }>(
        "SELECT tholi.retry_dead_job($1,$2,$3,$4,$5) AS changed",
        [
          input.workspaceId,
          input.id,
          input.expectedRevision.toString(),
          input.kind,
          input.version,
        ],
      )
    ).rows[0].changed;
  }
}
