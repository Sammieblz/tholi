import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresJobs } from "../../../apps/api/src/database/jobs";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { PostgresIdentityRepository } from "../../../apps/api/src/database/identity";
import { withTransaction } from "../../../apps/api/src/database/postgres";
import { createDatabasePool } from "../../../apps/api/src/database/postgres";
import {
  pruneExpiredBrokers,
  REGISTERED_JOB_KINDS,
} from "../../../apps/api/src/application/identity-maintenance";
import type {
  JobKind,
  JobLease,
} from "../../../apps/api/src/application/job-contracts";

/** Existing test image verifies the independently running worker, not a mock loop. */
export async function runWorkerRuntimeProbe(options: {
  runtimeConnection: string;
}) {
  const pool = createDatabasePool({
    connectionString: options.runtimeConnection,
    max: 1,
  });
  try {
    const repositories = new PostgresRepositories(pool);
    const scope = await repositories.provisionAccount();
    const registered = REGISTERED_JOB_KINDS[0];
    const queued = await repositories.transaction(scope, (scoped) =>
      scoped.enqueueJob({
        kind: registered.kind,
        version: registered.version,
        replaySafe: registered.replaySafe,
        idempotencyKey: `worker-runtime:${randomUUID()}`,
        recordReferences: { accountId: scope.accountId },
      }),
    );
    const deadline = Date.now() + 30000;
    while (Date.now() < deadline) {
      const result = await repositories.transaction(scope, (scoped) =>
        scoped.getJob(queued.id),
      );
      if (result?.status === "succeeded") {
        assert.deepEqual(result.result, { processed: 0 });
        const outbox = await withTransaction(
          pool,
          (client) =>
            client.query(
              "SELECT status,published_at FROM tholi.outbox WHERE workspace_id=$1 AND job_id=$2 AND event_kind='job.completed'",
              [scope.workspaceId, queued.id],
            ),
          scope,
        );
        assert.equal(outbox.rows.length, 1);
        assert.equal(outbox.rows[0].status, "published");
        assert.ok(outbox.rows[0].published_at);
        return {
          passed: true as const,
          checks: [
            {
              name: "independent worker executed a registered maintenance job and acknowledged its completion outbox",
              passed: true as const,
            },
          ],
        };
      }
      if (
        result &&
        ["failed", "dead", "cancelled", "uncertain"].includes(result.status)
      )
        throw new Error(
          "PostgreSQL check failed: independent worker completion.",
        );
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
    throw new Error("PostgreSQL check failed: independent worker deadline.");
  } finally {
    await pool.end();
  }
}

export async function runJobChecks(
  runtime: Pool,
  migration: Pool,
  worker: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
) {
  const repositories = new PostgresRepositories(runtime),
    jobs = new PostgresJobs(worker),
    operator = new PostgresJobs(migration);
  const scope = await repositories.provisionAccount();
  const kind = (replaySafe = true): JobKind => ({
    kind: `fixture.${randomUUID()}`,
    version: 1,
    replaySafe,
  });
  const enqueue = (
    registered: JobKind,
    options: { maxAttempts?: number; availableAt?: Date } = {},
  ) =>
    repositories.transaction(scope, (scoped) =>
      scoped.enqueueJob({
        kind: registered.kind,
        version: registered.version,
        replaySafe: registered.replaySafe,
        idempotencyKey: randomUUID(),
        recordReferences: { accountId: scope.accountId },
        ...options,
      }),
    );
  const claim = async (registered: JobKind) =>
    await jobs.claim({
      workerId: "pg-worker",
      kinds: [registered],
      leaseMs: 30000,
      limit: 10,
    });
  const read = (id: string) =>
    repositories.transaction(scope, (scoped) => scoped.getJob(id));
  const expire = (lease: JobLease) =>
    migration.query(
      "UPDATE tholi.jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND id=$2",
      [lease.workspaceId, lease.id],
    );
  const due = (id: string) =>
    migration.query(
      "UPDATE tholi.jobs SET available_at=clock_timestamp()-interval '1 second' WHERE workspace_id=$1 AND id=$2",
      [scope.workspaceId, id],
    );

  await record(
    "worker role has only metadata dispatch and scoped maintenance capabilities",
    async () => {
      assert.equal(
        (await worker.query("SELECT current_user AS role")).rows[0].role,
        "tholi_worker",
      );
      for (const table of [
        "sessions",
        "session_refresh_tokens",
        "identity_links",
        "identity_flows",
        "identity_brokers",
        "identity_logout_events",
        "credit_grants",
        "plan_versions",
      ])
        await assert.rejects(
          () => worker.query(`SELECT * FROM tholi.${table} LIMIT 1`),
          { code: "42501" },
        );
      await assert.rejects(
        () =>
          worker.query("SELECT tholi.provision_personal_account($1,$2)", [
            randomUUID(),
            randomUUID(),
          ]),
        { code: "42501" },
      );
      await assert.rejects(
        () =>
          runtime.query("SELECT * FROM tholi.claim_jobs('http',1,30000,'[]')"),
        { code: "42501" },
      );
      await assert.rejects(
        () =>
          worker.query(
            "SELECT * FROM tholi.claim_jobs('worker',NULL,30000,'[]')",
          ),
        { code: "22023" },
      );
      assert.deepEqual(
        (await worker.query("SELECT id FROM tholi.jobs")).rows,
        [],
      );
      await assert.rejects(
        () =>
          worker.query("SELECT tholi.retry_dead_job($1,$2,1,'fixture',1)", [
            scope.workspaceId,
            randomUUID(),
          ]),
        { code: "42501" },
      );
    },
  );

  await record(
    "competing dispatchers claim unique live attempts and commit results with one completion outbox",
    async () => {
      const registered = kind();
      for (let index = 0; index < 8; index++) await enqueue(registered);
      const claimed = (
        await Promise.all(
          ["first", "second"].map((workerId) =>
            jobs.claim({
              workerId,
              kinds: [registered],
              leaseMs: 30000,
              limit: 4,
            }),
          ),
        )
      ).flat();
      assert.equal(claimed.length, 8);
      assert.equal(new Set(claimed.map((lease) => lease.id)).size, 8);
      assert.equal(new Set(claimed.map((lease) => lease.leaseToken)).size, 8);
      for (const lease of claimed) {
        assert.equal(
          await jobs.runJob(lease, async () => ({ processed: 0 })),
          true,
        );
        let entered = false;
        assert.equal(
          await jobs.runJob(lease, async () => {
            entered = true;
            return { processed: 0 };
          }),
          false,
        );
        assert.equal(entered, false);
      }
      const result = await read(claimed[0].id);
      assert.equal(result?.status, "succeeded");
      assert.deepEqual(result?.result, { processed: 0 });
      const events = await withTransaction(
        worker,
        (client) =>
          client.query(
            "SELECT status,published_at FROM tholi.outbox WHERE workspace_id=$1 AND job_id=$2",
            [scope.workspaceId, claimed[0].id],
          ),
        scope,
      );
      assert.equal(events.rows.length, 1);
      assert.equal(events.rows[0].status, "published");
      assert.ok(events.rows[0].published_at);
    },
  );

  await record(
    "expired fences cannot renew acknowledge or finish a reclaimed attempt",
    async () => {
      const registered = kind();
      const queued = await enqueue(registered);
      const old = (await claim(registered))[0];
      await expire(old);
      assert.equal((await jobs.heartbeat(old, 30000)).alive, false);
      assert.equal(
        await jobs.runJob(old, async () => ({ processed: 0 })),
        false,
      );
      assert.deepEqual(await claim(registered), []);
      assert.equal((await read(queued.id))?.status, "queued");
      await due(queued.id);
      const replacement = (await claim(registered))[0];
      assert.notEqual(replacement.leaseToken, old.leaseToken);
      assert.equal(replacement.attempts, 2);
      assert.equal(
        await jobs.fail(old, {
          classification: "retryable",
          code: "UNAVAILABLE",
          backoffMs: 1000,
        }),
        false,
      );
      assert.equal(
        await jobs.runJob(old, async () => ({ processed: 0 })),
        false,
      );
      assert.equal(
        await jobs.runJob(replacement, async () => ({ processed: 0 })),
        true,
      );
    },
  );

  await record(
    "retry deadlines dead letters and revision-guarded operator recovery preserve logical work",
    async () => {
      const registered = kind();
      const queued = await enqueue(registered, { maxAttempts: 2 });
      const first = (await claim(registered))[0];
      assert.equal(
        await jobs.fail(first, {
          classification: "retryable",
          code: "UNAVAILABLE",
          backoffMs: 1000,
        }),
        true,
      );
      assert.deepEqual(await claim(registered), []);
      await due(queued.id);
      const last = (await claim(registered))[0];
      await jobs.fail(last, {
        classification: "retryable",
        code: "UNAVAILABLE",
        backoffMs: 1000,
      });
      const dead = (await read(queued.id))!;
      assert.equal(dead.status, "dead");
      assert.equal(dead.errorCode, "RETRY_EXHAUSTED");
      const recovery = {
        workspaceId: scope.workspaceId,
        id: dead.id,
        expectedRevision: dead.revision,
        kind: registered.kind,
        version: 1,
      };
      assert.equal(await operator.retryDead(recovery, [registered]), true);
      assert.equal(await operator.retryDead(recovery, [registered]), false);
      const retried = (await claim(registered))[0];
      assert.equal(retried.id, queued.id);
      assert.equal(retried.attempts, 3);
      await jobs.fail(retried, {
        classification: "failed",
        code: "HANDLER_FAILED",
        backoffMs: 0,
      });
      assert.equal((await read(queued.id))?.status, "failed");
    },
  );

  await record(
    "unsafe lease loss and retry classification retain uncertainty without automatic redelivery",
    async () => {
      const registered = kind(false);
      const queued = await enqueue(registered);
      const lease = (await claim(registered))[0];
      await jobs.fail(lease, {
        classification: "retryable",
        code: "UNAVAILABLE",
        backoffMs: 1000,
      });
      assert.equal((await read(queued.id))?.status, "uncertain");
      const next = await enqueue(registered);
      const expired = (await claim(registered))[0];
      await expire(expired);
      assert.deepEqual(await claim(registered), []);
      const uncertain = (await read(next.id))!;
      assert.equal(uncertain.status, "uncertain");
      assert.equal(
        await operator.retryDead(
          {
            workspaceId: scope.workspaceId,
            id: uncertain.id,
            expectedRevision: uncertain.revision,
            kind: registered.kind,
            version: 1,
          },
          [{ ...registered, replaySafe: true }],
        ),
        false,
      );
    },
  );

  await record(
    "cancel intent revisions and membership revocation block scoped effects",
    async () => {
      const registered = kind();
      const queued = await enqueue(registered);
      const cancelled = await repositories.transaction(scope, (scoped) =>
        scoped.cancelJob({ id: queued.id, expectedRevision: queued.revision }),
      );
      assert.equal(cancelled.status, "cancelled");
      assert.deepEqual(await claim(registered), []);
      await assert.rejects(
        () =>
          repositories.transaction(scope, (scoped) =>
            scoped.cancelJob({
              id: queued.id,
              expectedRevision: queued.revision,
            }),
          ),
        { code: "CONFLICT" },
      );
      const running = await enqueue(registered);
      const lease = (await claim(registered))[0];
      const current = (await read(running.id))!;
      await repositories.transaction(scope, (scoped) =>
        scoped.cancelJob({
          id: running.id,
          expectedRevision: current.revision,
        }),
      );
      assert.equal((await jobs.heartbeat(lease, 30000)).cancelRequested, true);
      let entered = false;
      assert.equal(
        await jobs.runJob(lease, async () => {
          entered = true;
          return { processed: 0 };
        }),
        false,
      );
      assert.equal(entered, false);
      assert.equal((await read(running.id))?.status, "cancelled");
      const revoked = await enqueue(registered);
      const revokedLease = (await claim(registered))[0];
      await migration.query(
        "UPDATE tholi.memberships SET status='revoked' WHERE workspace_id=$1 AND account_id=$2",
        [scope.workspaceId, scope.accountId],
      );
      try {
        await assert.rejects(
          () => jobs.runJob(revokedLease, async () => ({ processed: 0 })),
          { code: "FORBIDDEN" },
        );
        await jobs.fail(revokedLease, {
          classification: "failed",
          code: "AUTHORIZATION_REVOKED",
          backoffMs: 0,
        });
      } finally {
        await migration.query(
          "UPDATE tholi.memberships SET status='active' WHERE workspace_id=$1 AND account_id=$2",
          [scope.workspaceId, scope.accountId],
        );
      }
      assert.equal((await read(revoked.id))?.status, "failed");
    },
  );

  await record(
    "durable refs reject private payloads and unsupported kinds remain unclaimed",
    async () => {
      const unknown = kind();
      const queued = await enqueue(unknown);
      assert.deepEqual(await claim(kind()), []);
      assert.equal((await read(queued.id))?.status, "queued");
      for (const refs of [
        { prompt: "private page" },
        { accountId: null },
        { artifactId: "not-an-id" },
      ])
        await assert.rejects(
          () =>
            withTransaction(
              runtime,
              (client) =>
                client.query(
                  `INSERT INTO tholi.jobs
        (workspace_id,id,account_id,kind,version,idempotency_key,record_references)
        VALUES ($1,$2,$3,'fixture',1,$4,$5::jsonb)`,
                  [
                    scope.workspaceId,
                    randomUUID(),
                    scope.accountId,
                    randomUUID(),
                    JSON.stringify(refs),
                  ],
                ),
              scope,
            ),
          { code: "23514" },
        );
    },
  );

  await record(
    "scheduled broker retention is scoped bounded restart-safe and atomic with result outbox",
    async () => {
      await migration.query(
        "DELETE FROM tholi.identity_brokers WHERE expires_at<=clock_timestamp()",
      );
      const identity = new PostgresIdentityRepository(runtime);
      const provider = {
        issuer: "https://jobs.example.test",
        subject: randomUUID(),
        issuedAt: new Date(Date.now() - 1000),
      };
      const account = await identity.resolveIdentity(provider);
      await migration.query(
        `INSERT INTO tholi.identity_brokers
      (code_hash,identity_id,account_id,account_revision,workspace_id,client_id,redirect_uri,code_challenge,provider_issued_at,created_at,expires_at)
      SELECT decode(md5(gen_random_uuid()::text)||md5(gen_random_uuid()::text),'hex'),$1,$2,$3,$4,'extension-chromium',
        'https://approved.chromiumapp.org/tholi',repeat('a',43),$5,clock_timestamp()-interval '2 minutes',clock_timestamp()-interval '1 minute'
      FROM generate_series(1,105)`,
        [
          account.identityId,
          account.accountId,
          account.revision,
          account.workspaceId,
          provider.issuedAt,
        ],
      );
      await Promise.all([
        jobs.scheduleBrokerPruning({ limit: 100, intervalMs: 86400000 }),
        jobs.scheduleBrokerPruning({ limit: 100, intervalMs: 86400000 }),
      ]);
      const scheduled = await repositories.transaction(account, (scoped) =>
        scoped.listJobs({ status: "queued" }),
      );
      assert.equal(scheduled.length, 1);
      const lease = (
        await jobs.claim({
          workerId: "retention",
          kinds: REGISTERED_JOB_KINDS,
          leaseMs: 30000,
          limit: 10,
        })
      ).find((entry) => entry.id === scheduled[0].id)!;
      assert.ok(lease);
      const count = async () =>
        Number(
          (
            await migration.query(
              "SELECT count(*) AS count FROM tholi.identity_brokers WHERE account_id=$1",
              [account.accountId],
            )
          ).rows[0].count,
        );
      const deliberate = new Error("rollback maintenance");
      await assert.rejects(
        () =>
          jobs.runJob(lease, async (transaction) => {
            assert.equal(await transaction.pruneExpiredBrokers(100), 100);
            throw deliberate;
          }),
        (error) => error === deliberate,
      );
      assert.equal(await count(), 105);
      assert.equal(
        (
          await repositories.transaction(account, (scoped) =>
            scoped.getJob(lease.id),
          )
        )?.result,
        null,
      );
      const restarted = new PostgresJobs(worker);
      assert.equal(
        await restarted.runJob(lease, (transaction) =>
          pruneExpiredBrokers.execute(
            transaction,
            lease,
            new AbortController().signal,
          ),
        ),
        true,
      );
      assert.equal(await count(), 5);
      const done = await repositories.transaction(account, (scoped) =>
        scoped.getJob(lease.id),
      );
      assert.deepEqual(done?.result, { processed: 100 });
      assert.equal(
        await restarted.runJob(lease, async () => ({ processed: 0 })),
        false,
      );
      assert.equal(await count(), 5);
    },
  );
}
