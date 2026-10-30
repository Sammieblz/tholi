import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresSupport } from "../../../apps/api/src/database/support";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { PostgresIdentityRepository } from "../../../apps/api/src/database/identity";
import { PostgresJobs } from "../../../apps/api/src/database/jobs";
import type { RepositoryScope } from "../../../apps/api/src/database/contracts";
import type { JobLease } from "../../../apps/api/src/application/job-contracts";
import type { SupportCommand } from "../../../apps/api/src/application/support-contracts";
import type { ProviderIdentity } from "../../../apps/api/src/application/identity-contracts";
import { withTransaction } from "../../../apps/api/src/database/postgres";

/** Real roles and the existing isolated database harness, without SMTP/S3 mocks. */
export async function runSupportChecks(
  runtime: Pool,
  migration: Pool,
  worker: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
) {
  const api = new PostgresSupport(runtime),
    effects = new PostgresSupport(worker),
    jobs = new PostgresJobs(worker);
  const repositories = new PostgresRepositories(runtime),
    identities = new PostgresIdentityRepository(runtime);
  const digest = (value = randomUUID()) =>
    createHash("sha256").update(value).digest("hex");
  const proof = (): ProviderIdentity => ({
    issuer: "https://identity.example.test/realms/support",
    subject: randomUUID(),
    issuedAt: new Date(Date.now() - 10000),
    verifiedEmail: "verified@example.test",
  });
  const fixture = async () => {
    const identity = proof();
    return { identity, scope: await identities.resolveIdentity(identity) };
  };
  const command = (
    overrides: Partial<SupportCommand> = {},
  ): SupportCommand => ({
    idempotencyKey: randomUUID(),
    payloadHash: digest(),
    name: "Example user",
    email: "form-only@example.test",
    topic: "Support",
    subject: "An installation question",
    message: "PRIVATE_SUPPORT_SENTINEL",
    ...overrides,
  });
  // This acceptance database is exclusive. Make only the target logical effect
  // due so prior groups cannot consume the dispatcher's bounded batch.
  const claim = async (id: string, kind: string): Promise<JobLease> => {
    await migration.query(
      "UPDATE tholi.jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind=$1 AND status='queued' AND id<>$2",
      [kind, id],
    );
    await migration.query(
      "UPDATE tholi.jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [id],
    );
    const found = (
      await jobs.claim({
        workerId: "support-pg",
        kinds: [{ kind, version: 1, replaySafe: true }],
        leaseMs: 30000,
        limit: 10,
      })
    ).find((item) => item.id === id);
    assert.ok(found);
    return found;
  };
  const reclaim = async (lease: JobLease) => {
    await migration.query(
      "UPDATE tholi.jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [lease.id],
    );
    await jobs.claim({
      workerId: "support-recover",
      kinds: [{ kind: lease.kind, version: 1, replaySafe: true }],
      leaseMs: 30000,
      limit: 10,
    });
    return claim(lease.id, lease.kind);
  };
  const readJob = (scope: RepositoryScope, id: string) =>
    repositories.transaction(scope, (owner) => owner.getJob(id));
  const readRequest = (scope: RepositoryScope, id: string) =>
    repositories.transaction(scope, (owner) => owner.getRequest(id));
  const diagnostic = (scope: RepositoryScope) =>
    api.requestDiagnostic(scope, {
      idempotencyKey: randomUUID(),
      payloadHash: digest(),
      version: "0.11.0",
    });

  await record(
    "verified contacts are issuer-bound, monotonic and invalidated by newer unverified proofs",
    async () => {
      const { identity, scope } = await fixture();
      await identities.resolveIdentity({
        ...identity,
        verifiedEmail: "newer@example.test",
        issuedAt: new Date(identity.issuedAt.getTime() + 1000),
      });
      await identities.resolveIdentity(identity);
      let contact = (
        await migration.query(
          "SELECT email,revision::text FROM tholi.identity_delivery_contacts WHERE account_id=$1",
          [scope.accountId],
        )
      ).rows[0];
      assert.equal(contact.email, "newer@example.test");
      assert.equal(contact.revision, "2");
      await identities.resolveIdentity({
        ...identity,
        verifiedEmail: null,
        issuedAt: new Date(identity.issuedAt.getTime() + 2000),
      });
      await identities.resolveIdentity({
        ...identity,
        verifiedEmail: "old@example.test",
        issuedAt: identity.issuedAt,
      });
      contact = (
        await migration.query(
          "SELECT email,revision::text FROM tholi.identity_delivery_contacts WHERE account_id=$1",
          [scope.accountId],
        )
      ).rows[0];
      assert.equal(contact.email, null);
      assert.equal(contact.revision, "3");
      const result = await api.submit(scope, command());
      assert.equal(result.receiptJobId, null);
      await assert.rejects(() =>
        identities.resolveIdentity({
          ...identity,
          verifiedEmail: "bad\r\nBcc: other@example.test",
          issuedAt: new Date(identity.issuedAt.getTime() + 3000),
        }),
      );
    },
  );

  await record(
    "support requests deduplicate concurrent commands, enforce abuse quotas and keep private payloads out of jobs",
    async () => {
      const { scope } = await fixture(),
        input = command();
      const results = await Promise.all(
        Array.from({ length: 8 }, () => api.submit(scope, input)),
      );
      assert.equal(new Set(results.map((item) => item.id)).size, 1);
      assert.ok(results[0].receiptJobId);
      const raw = await migration.query(
        "SELECT record_references FROM tholi.jobs WHERE workspace_id=$1",
        [scope.workspaceId],
      );
      assert.equal(raw.rows.length, 2);
      assert.ok(!JSON.stringify(raw.rows).includes(input.message));
      assert.ok(
        raw.rows.every(
          (row) => Object.keys(row.record_references).join() === "requestId",
        ),
      );
      await assert.rejects(
        () =>
          api.submit(scope, {
            ...input,
            message: "Changed",
            payloadHash: digest(),
          }),
        { code: "IDEMPOTENCY_CONFLICT" },
      );
      await assert.rejects(() =>
        api.submit(scope, command({ message: "x".repeat(3001) })),
      );
      await api.submit(scope, command());
      await api.submit(scope, command());
      await assert.rejects(() => api.submit(scope, command()), {
        code: "RATE_LIMITED",
      });
      assert.equal(
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM tholi.requests WHERE workspace_id=$1",
            [scope.workspaceId],
          )
        ).rows[0].count,
        3,
      );
      const aborted = new AbortController();
      aborted.abort();
      await assert.rejects(() => api.submit(scope, command(), aborted.signal));
    },
  );

  await record(
    "queued account receipts require the current verified-contact revision, never form reply-to",
    async () => {
      const { scope, identity } = await fixture(),
        saved = await api.submit(scope, command());
      const receipt = await claim(saved.receiptJobId!, "support.received");
      const prepared = await effects.prepareExternal(receipt);
      assert.ok(prepared && prepared.command.type === "mail");
      assert.ok(prepared.command.message.template === "support.received");
      assert.equal(prepared.command.message.recipient, "verified@example.test");
      assert.equal(
        await effects.finishExternal(receipt, prepared.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        true,
      );
      assert.equal((await readRequest(scope, saved.id))?.status, "pending");
      const another = await api.submit(scope, command());
      await identities.resolveIdentity({
        ...identity,
        verifiedEmail: "replacement@example.test",
        issuedAt: new Date(identity.issuedAt.getTime() + 1000),
      });
      const stale = await claim(another.receiptJobId!, "support.received");
      await assert.rejects(() => effects.prepareExternal(stale), {
        code: "FORBIDDEN",
      });
    },
  );

  await record(
    "SMTP start barriers prevent duplicate sends after ambiguous crashes and preserve committed outcomes",
    async () => {
      const { scope } = await fixture(),
        saved = await api.submit(scope, command());
      const lease = await claim(saved.operatorJobId, "support.operator");
      const prepared = await effects.prepareExternal(lease);
      assert.ok(prepared && prepared.command.type === "mail");
      assert.equal(await effects.prepareExternal(lease), null);
      assert.equal((await readJob(scope, lease.id))?.status, "running");
      const renewed = await reclaim(lease);
      assert.equal(
        await effects.finishExternal(lease, prepared.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        false,
      );
      assert.equal(await effects.prepareExternal(renewed), null);
      assert.equal((await readJob(scope, lease.id))?.status, "uncertain");
      assert.equal((await readRequest(scope, saved.id))?.status, "uncertain");
      const known = await api.submit(scope, command()),
        current = await claim(known.operatorJobId, "support.operator");
      const knownPrepared = await effects.prepareExternal(current);
      assert.ok(knownPrepared);
      assert.equal(
        await effects.finishExternal(current, knownPrepared.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        true,
      );
      assert.equal(
        await effects.finishExternal(current, knownPrepared.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        false,
      );
      assert.equal((await readJob(scope, current.id))?.status, "succeeded");
      assert.equal((await readRequest(scope, known.id))?.status, "completed");
      assert.equal(
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM tholi.outbox WHERE job_id=$1 AND status='published'",
            [current.id],
          )
        ).rows[0].count,
        1,
      );
    },
  );

  await record(
    "proven not-sent mail retries reuse logical effect identity and bounded attempt budgets",
    async () => {
      const { scope } = await fixture(),
        saved = await api.submit(scope, command());
      await migration.query(
        "UPDATE tholi.jobs SET max_attempts=1 WHERE id=$1",
        [saved.operatorJobId],
      );
      const lease = await claim(saved.operatorJobId, "support.operator"),
        first = await effects.prepareExternal(lease);
      assert.ok(first);
      assert.equal(
        await effects.finishExternal(lease, first.attemptId, {
          status: "retryable",
          code: "UNAVAILABLE",
          backoffMs: 1000,
        }),
        true,
      );
      const dead = await readJob(scope, lease.id);
      assert.equal(dead?.status, "dead");
      assert.equal((await readRequest(scope, saved.id))?.status, "failed");
      assert.equal(
        await new PostgresJobs(migration).retryDead(
          {
            workspaceId: scope.workspaceId,
            id: lease.id,
            expectedRevision: dead!.revision,
            kind: lease.kind,
            version: 1,
          },
          [{ kind: lease.kind, version: 1, replaySafe: true }],
        ),
        true,
      );
      assert.equal((await readRequest(scope, saved.id))?.status, "pending");
      const next = await claim(lease.id, lease.kind),
        second = await effects.prepareExternal(next);
      assert.ok(second);
      assert.equal(second.effectId, first.effectId);
      assert.equal(second.commandHash, first.commandHash);
      assert.notEqual(second.attemptId, first.attemptId);
      assert.equal(
        await effects.finishExternal(next, second.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        true,
      );
      assert.equal((await readRequest(scope, saved.id))?.status, "completed");
    },
  );

  await record(
    "diagnostic snapshots are content-free, immutable across retries and private to the current scope",
    async () => {
      const { scope } = await fixture(),
        other = await fixture(),
        input = {
          idempotencyKey: randomUUID(),
          payloadHash: digest(),
          version: "0.11.0",
        };
      const duplicates = await Promise.all(
        Array.from({ length: 4 }, () => api.requestDiagnostic(scope, input)),
      );
      assert.equal(new Set(duplicates.map((item) => item.fileId)).size, 1);
      const saved = duplicates[0],
        lease = await claim(saved.jobId, "file.diagnostic"),
        first = await effects.prepareExternal(lease);
      assert.ok(first && first.command.type === "put");
      assert.ok(
        !Buffer.from(first.command.body)
          .toString("utf8")
          .includes(scope.accountId),
      );
      assert.ok(
        !Buffer.from(first.command.body).toString("utf8").includes("@"),
      );
      await api.submit(scope, command());
      const next = await reclaim(lease),
        second = await effects.prepareExternal(next);
      assert.ok(second && second.command.type === "put");
      assert.deepEqual(second.command.body, first.command.body);
      assert.equal(second.command.file.key, first.command.file.key);
      assert.equal(
        await effects.finishExternal(lease, first.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        false,
      );
      assert.equal(
        (await readRequest(scope, saved.requestId))?.status,
        "pending",
      );
      assert.equal(
        await effects.finishExternal(next, second.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        true,
      );
      assert.equal((await api.getFile(scope, saved.fileId))?.status, "ready");
      assert.equal(
        (await readRequest(scope, saved.requestId))?.status,
        "completed",
      );
      assert.equal(await api.getFile(other.scope, saved.fileId), null);
      await assert.rejects(
        () =>
          withTransaction(runtime, (client) =>
            client.query("SELECT * FROM tholi.prepare_file_cleanup($1,$2,$3)", [
              scope.workspaceId,
              lease.id,
              lease.leaseToken,
            ]),
          ),
        { code: "42501" },
      );
      assert.deepEqual(
        (await worker.query("SELECT object_key FROM tholi.private_files")).rows,
        [],
      );
      await assert.rejects(
        () =>
          migration.query(
            'UPDATE tholi.private_files SET snapshot=snapshot || \'{"pageText":"PRIVATE"}\'::jsonb WHERE id=$1',
            [saved.fileId],
          ),
        { code: "23514" },
      );
    },
  );

  await record(
    "external completion rolls back domain and attempt changes when a live lease expires during SQL lock waits",
    async () => {
      for (const status of ["committed", "retryable"] as const) {
        const { scope } = await fixture(),
          saved = await diagnostic(scope);
        const lease = await claim(saved.jobId, "file.diagnostic"),
          prepared = await effects.prepareExternal(lease);
        assert.ok(prepared);
        const expiry = (
          await migration.query(
            "UPDATE tholi.jobs SET lease_expires_at=clock_timestamp()+interval '750 milliseconds' WHERE id=$1 RETURNING lease_expires_at",
            [lease.id],
          )
        ).rows[0].lease_expires_at;
        const blocker = await migration.connect();
        let finishing: Promise<boolean> | undefined;
        try {
          await blocker.query("BEGIN");
          if (status === "committed")
            await blocker.query(
              "SELECT id FROM tholi.private_files WHERE id=$1 FOR UPDATE",
              [saved.fileId],
            );
          else
            await blocker.query(
              "SELECT id FROM tholi.external_attempts WHERE id=$1 FOR UPDATE",
              [prepared.attemptId],
            );
          finishing = effects.finishExternal(lease, prepared.attemptId, {
            status,
            ...(status === "retryable" ? { code: "UNAVAILABLE" as const } : {}),
            backoffMs: status === "retryable" ? 1000 : 0,
          });
          void finishing.catch(() => {});
          let waiting = false;
          const observedBy = Date.now() + 500;
          while (!waiting && Date.now() < observedBy) {
            waiting = (
              await blocker.query(`SELECT EXISTS(SELECT FROM pg_locks blocked WHERE NOT blocked.granted AND blocked.locktype='transactionid'
              AND blocked.transactionid IN(SELECT held.transactionid FROM pg_locks held WHERE held.pid=pg_backend_pid() AND held.granted AND held.locktype='transactionid')) AS waiting`)
            ).rows[0].waiting;
            if (!waiting)
              await new Promise((resolve) => setTimeout(resolve, 5));
          }
          assert.equal(
            waiting,
            true,
            "The external finish reached the protected SQL lock before expiry.",
          );
          while (
            !(
              await blocker.query(
                "SELECT clock_timestamp()>$1::timestamptz AS expired",
                [expiry],
              )
            ).rows[0].expired
          )
            await new Promise((resolve) => setTimeout(resolve, 10));
        } finally {
          await blocker.query("ROLLBACK");
          blocker.release();
        }
        assert.equal(await finishing, false);
        assert.equal(
          (await api.getFile(scope, saved.fileId))?.status,
          "pending",
        );
        assert.equal(
          (await readRequest(scope, saved.requestId))?.status,
          "pending",
        );
        assert.equal((await readJob(scope, lease.id))?.status, "running");
        assert.equal(
          (
            await migration.query(
              "SELECT state FROM tholi.external_attempts WHERE id=$1",
              [prepared.attemptId],
            )
          ).rows[0].state,
          "started",
        );
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.outbox WHERE job_id=$1",
              [lease.id],
            )
          ).rows[0].count,
          0,
        );
        assert.equal(await effects.prepareExternal(lease), null);
      }
    },
  );

  await record(
    "restored membership cannot republish a file already marked for deletion by a late PUT",
    async () => {
      const { scope } = await fixture(),
        saved = await diagnostic(scope);
      const firstLease = await claim(saved.jobId, "file.diagnostic"),
        first = await effects.prepareExternal(firstLease);
      assert.ok(first);
      const currentLease = await reclaim(firstLease),
        current = await effects.prepareExternal(currentLease);
      assert.ok(current);
      await migration.query(
        "UPDATE tholi.memberships SET status='revoked',revision=revision+1 WHERE workspace_id=$1 AND account_id=$2",
        [scope.workspaceId, scope.accountId],
      );
      assert.equal(
        await effects.finishExternal(firstLease, first.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        false,
      );
      assert.equal(
        (
          await migration.query(
            "SELECT status FROM tholi.private_files WHERE id=$1",
            [saved.fileId],
          )
        ).rows[0].status,
        "deleting",
      );
      await migration.query(
        "UPDATE tholi.memberships SET status='active',revision=revision+1 WHERE workspace_id=$1 AND account_id=$2",
        [scope.workspaceId, scope.accountId],
      );
      assert.equal(
        await effects.finishExternal(currentLease, current.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        true,
      );
      assert.equal(
        (await api.getFile(scope, saved.fileId))?.status,
        "deleting",
      );
      assert.equal(
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM tholi.jobs WHERE workspace_id=$1 AND kind='file.expire'",
            [scope.workspaceId],
          )
        ).rows[0].count,
        1,
      );
    },
  );

  for (const revoked of ["membership", "account"] as const)
    await record(
      `stored files are not published and cleanup remains authorized after ${revoked} revocation`,
      async () => {
        const { scope } = await fixture(),
          saved = await diagnostic(scope),
          lease = await claim(saved.jobId, "file.diagnostic");
        const prepared = await effects.prepareExternal(lease);
        assert.ok(prepared && prepared.command.type === "put");
        if (revoked === "membership")
          await migration.query(
            "UPDATE tholi.memberships SET status='revoked',revision=revision+1 WHERE workspace_id=$1 AND account_id=$2",
            [scope.workspaceId, scope.accountId],
          );
        else
          await migration.query(
            "UPDATE tholi.accounts SET status='deleted',revision=revision+1 WHERE id=$1",
            [scope.accountId],
          );
        assert.equal(
          await effects.finishExternal(lease, prepared.attemptId, {
            status: "committed",
            backoffMs: 0,
          }),
          true,
        );
        await assert.rejects(() => api.getFile(scope, saved.fileId), {
          code: "FORBIDDEN",
        });
        assert.equal(
          (
            await migration.query(
              "SELECT status FROM tholi.private_files WHERE id=$1",
              [saved.fileId],
            )
          ).rows[0].status,
          "deleting",
        );
        const cleanupId = (
          await migration.query(
            "SELECT id FROM tholi.jobs WHERE workspace_id=$1 AND kind='file.expire'",
            [scope.workspaceId],
          )
        ).rows[0].id;
        const cleanupLease = await claim(cleanupId, "file.expire"),
          cleanup = await effects.prepareCleanup(cleanupLease);
        assert.ok(cleanup);
        assert.deepEqual(Object.keys(cleanup.file).sort(), ["id", "key"]);
        assert.equal(cleanup.file.key, prepared.command.file.key);
        assert.equal(
          await effects.finishCleanup(cleanupLease, cleanup.attemptId, {
            status: "committed",
            backoffMs: 0,
          }),
          true,
        );
        const deleted = (
          await migration.query(
            "SELECT status,snapshot,deleted_at FROM tholi.private_files WHERE id=$1",
            [saved.fileId],
          )
        ).rows[0];
        assert.equal(deleted.status, "deleted");
        assert.equal(deleted.snapshot, null);
        assert.ok(deleted.deleted_at);
      },
    );

  await record(
    "late PUT receipts and unresolved writes cannot suppress a fresh tombstone cleanup generation",
    async () => {
      const { scope } = await fixture(),
        saved = await diagnostic(scope);
      const putLease = await claim(saved.jobId, "file.diagnostic"),
        put = await effects.prepareExternal(putLease);
      assert.ok(put && put.command.type === "put");
      await migration.query(
        "UPDATE tholi.private_files SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [saved.fileId],
      );
      await migration.query(
        "UPDATE tholi.jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [putLease.id],
      );
      await effects.scheduleFileExpiry({ limit: 100, intervalMs: 60000 });
      assert.equal(
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM tholi.jobs WHERE workspace_id=$1 AND kind='file.expire'",
            [scope.workspaceId],
          )
        ).rows[0].count,
        0,
      );
      // Accelerate only the persisted transport/grace clock, never suppress the
      // production quiescence condition to manufacture a passing cleanup.
      await migration.query(
        "UPDATE tholi.external_attempts SET quiescent_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [put.attemptId],
      );
      await effects.scheduleFileExpiry({ limit: 100, intervalMs: 60000 });
      let rows = (
        await migration.query(
          "SELECT id FROM tholi.jobs WHERE workspace_id=$1 AND kind='file.expire' ORDER BY created_at,id",
          [scope.workspaceId],
        )
      ).rows;
      assert.equal(rows.length, 1);
      const firstLease = await claim(rows[0].id, "file.expire"),
        first = await effects.prepareCleanup(firstLease);
      assert.ok(first);
      assert.equal(
        await effects.finishCleanup(firstLease, first.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        true,
      );
      const tombstone = (
        await migration.query(
          "SELECT status,next_reconcile_at FROM tholi.private_files WHERE id=$1",
          [saved.fileId],
        )
      ).rows[0];
      assert.equal(tombstone.status, "deleted");
      assert.ok(tombstone.next_reconcile_at);
      await migration.query(
        "UPDATE tholi.private_files SET next_reconcile_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [saved.fileId],
      );
      await effects.scheduleFileExpiry({ limit: 100, intervalMs: 60000 });
      rows = (
        await migration.query(
          "SELECT id FROM tholi.jobs WHERE workspace_id=$1 AND kind='file.expire' ORDER BY created_at,id",
          [scope.workspaceId],
        )
      ).rows;
      assert.equal(rows.length, 2);
      const nextLease = await claim(rows[1].id, "file.expire"),
        next = await effects.prepareCleanup(nextLease);
      assert.ok(next);
      // The original PUT reports after the first DELETE and after the second
      // cleanup prepared its DELETE, but before that cleanup records completion.
      // A running cleanup must preserve the newer file revision's reaping intent.
      assert.equal(
        await effects.finishExternal(putLease, put.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        false,
      );
      rows = (
        await migration.query(
          "SELECT id FROM tholi.jobs WHERE workspace_id=$1 AND kind='file.expire' ORDER BY created_at,id",
          [scope.workspaceId],
        )
      ).rows;
      assert.equal(rows.length, 2);
      assert.equal(next.file.key, put.command.file.key);
      assert.equal(
        await effects.finishCleanup(nextLease, next.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        true,
      );
      rows = (
        await migration.query(
          "SELECT id FROM tholi.jobs WHERE workspace_id=$1 AND kind='file.expire' ORDER BY created_at,id",
          [scope.workspaceId],
        )
      ).rows;
      assert.equal(rows.length, 3);
      const finalLease = await claim(rows[2].id, "file.expire"),
        final = await effects.prepareCleanup(finalLease);
      assert.ok(final);
      assert.equal(
        await effects.finishCleanup(finalLease, final.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        true,
      );
      assert.equal(
        await effects.finishExternal(putLease, put.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        false,
      );
      assert.equal(
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM tholi.jobs WHERE workspace_id=$1 AND kind='file.expire'",
            [scope.workspaceId],
          )
        ).rows[0].count,
        3,
      );
      assert.equal(
        (
          await migration.query(
            "SELECT next_reconcile_at FROM tholi.private_files WHERE id=$1",
            [saved.fileId],
          )
        ).rows[0].next_reconcile_at,
        null,
      );
    },
  );

  await record(
    "expiry purges inactive support content, denies file access and prevents public retention cancellation",
    async () => {
      const { scope } = await fixture(),
        support = await api.submit(scope, command()),
        saved = await diagnostic(scope);
      await migration.query(
        "UPDATE tholi.private_files SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [saved.fileId],
      );
      assert.equal(await api.getFile(scope, saved.fileId), null);
      await effects.scheduleFileExpiry({ limit: 100, intervalMs: 60000 });
      await effects.scheduleFileExpiry({ limit: 100, intervalMs: 60000 });
      const queued = (
        await migration.query(
          "SELECT id,revision::text FROM tholi.jobs WHERE workspace_id=$1 AND kind='file.expire'",
          [scope.workspaceId],
        )
      ).rows;
      assert.equal(queued.length, 1);
      await assert.rejects(
        () =>
          repositories.transaction(scope, (owner) =>
            owner.cancelJob({
              id: queued[0].id,
              expectedRevision: BigInt(queued[0].revision),
            }),
          ),
        { code: "FORBIDDEN" },
      );
      await migration.query(
        "UPDATE tholi.support_requests SET expires_at=clock_timestamp()-interval '1 second' WHERE request_id=$1",
        [support.id],
      );
      await migration.query(
        "UPDATE tholi.accounts SET status='deleted',revision=revision+1 WHERE id=$1",
        [scope.accountId],
      );
      await effects.scheduleFileExpiry({ limit: 100, intervalMs: 60000 });
      const purged = (
        await migration.query(
          "SELECT name,email,subject,message,purged_at FROM tholi.support_requests WHERE request_id=$1",
          [support.id],
        )
      ).rows[0];
      for (const field of ["name", "email", "subject", "message"])
        assert.equal(purged[field], null);
      assert.ok(purged.purged_at);
    },
  );
}
