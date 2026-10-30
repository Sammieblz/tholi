import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import {
  appendSecurityAudit,
  readSecurityAudit,
} from "../../../apps/api/src/database/audit";
import {
  createDatabasePool,
  withTransaction,
} from "../../../apps/api/src/database/postgres";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { PostgresIdentityRepository } from "../../../apps/api/src/database/identity";
import { PostgresJobs } from "../../../apps/api/src/database/jobs";
import {
  NO_OBSERVABILITY,
  type Correlation,
  type Observability,
} from "../../../apps/api/src/application/observability";
import { PRODUCT_ANALYTICS_LIMITS } from "../../../packages/navigation-core/contracts-analytics";
import type {
  IdentitySession,
  ProviderIdentity,
} from "../../../apps/api/src/application/identity-contracts";

/** Real non-owner roles and the existing exclusive acceptance database. */
export async function runObservabilityChecks(
  runtime: Pool,
  migration: Pool,
  worker: Pool | undefined,
  runtimeConnection: string,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
) {
  const repositories = new PostgresRepositories(runtime);
  const provision = () =>
    repositories.provisionAccount({
      accountId: randomUUID(),
      workspaceId: randomUUID(),
    });
  const grant = (
    scope: Awaited<ReturnType<typeof provision>>,
    expectedRevision = 0n,
    granted = true,
  ) =>
    repositories.transaction(scope, (tx) =>
      tx.recordConsent({
        purpose: "product_analytics",
        policyVersion: "1",
        granted,
        expectedRevision,
      }),
    );
  const event = () => ({
    schemaVersion: 1 as const,
    eventId: randomUUID(),
    event: { name: "onboarding_complete" as const },
  });
  const audit = (accountId: string) =>
    readSecurityAudit(migration, { accountId, limit: 100 });

  await record(
    "security audit shares successful mutation commit and rollback with immutable private role grants",
    async () => {
      const scope = await provision();
      const other = await provision();
      const failure = new Error("Intentional audit rollback.");
      await assert.rejects(
        () =>
          repositories.transaction(scope, async (tx) => {
            await tx.recordConsent({
              purpose: "cloud_inference",
              policyVersion: "1",
              granted: true,
              expectedRevision: 0n,
            });
            throw failure;
          }),
        (error) => error === failure,
      );
      assert.equal((await audit(scope.accountId)).length, 0);
      const consent = await repositories.transaction(scope, (tx) =>
        tx.recordConsent({
          purpose: "cloud_inference",
          policyVersion: "1",
          granted: true,
          expectedRevision: 0n,
        }),
      );
      await assert.rejects(() =>
        repositories.transaction(scope, (tx) =>
          tx.recordConsent({
            purpose: "cloud_inference",
            policyVersion: "1",
            granted: false,
            expectedRevision: 0n,
          }),
        ),
      );
      const rows = await audit(scope.accountId);
      assert.equal(rows.length, 1);
      assert.equal(rows[0].subjectId, consent.id);
      assert.deepEqual(rows[0].details, {
        purpose: "cloud_inference",
        policyVersion: "1",
        granted: true,
        revision: "1",
      });
      assert.equal(
        await repositories.transaction(other, (tx) =>
          tx.getConsent("cloud_inference"),
        ),
        undefined,
      );
      for (const query of [
        "SELECT * FROM tholi.security_audit",
        "UPDATE tholi.security_audit SET kind=kind",
        "DELETE FROM tholi.security_audit",
      ])
        await assert.rejects(() => runtime.query(query), { code: "42501" });
      await assert.rejects(
        () =>
          withTransaction(
            runtime,
            (client) =>
              appendSecurityAudit(client, {
                accountId: other.accountId,
                kind: "session.revoked",
                subjectId: randomUUID(),
                details: {},
              }),
            scope,
          ),
        { code: "42501" },
      );
      await assert.rejects(
        () =>
          withTransaction(
            runtime,
            (client) =>
              client.query(
                `INSERT INTO tholi.security_audit(account_id,subject_id,kind,details)
      VALUES($1,$2,'session.revoked',$3::jsonb)`,
                [
                  scope.accountId,
                  randomUUID(),
                  JSON.stringify({ privateUrl: "AUDIT_PRIVATE_SENTINEL" }),
                ],
              ),
            scope,
          ),
        { code: "23514" },
      );
      assert.doesNotMatch(
        JSON.stringify(rows),
        /AUDIT_PRIVATE_SENTINEL|accessHash|refreshHash|token_hash|subject\":|issuer/,
      );
    },
  );

  await record(
    "organization membership revisions produce one attributed security audit without exposing other account history",
    async () => {
      const owner = await provision(),
        member = await provision(),
        workspaceId = randomUUID();
      await migration.query(
        "INSERT INTO tholi.workspaces(id,kind,owner_account_id) VALUES($1,'organization',$2)",
        [workspaceId, owner.accountId],
      );
      await migration.query(
        "INSERT INTO tholi.memberships(workspace_id,account_id,role) VALUES($1,$2,'owner')",
        [workspaceId, owner.accountId],
      );
      const scope = { accountId: owner.accountId, workspaceId };
      const added = await repositories.transaction(scope, (tx) =>
        tx.setMembership({
          accountId: member.accountId,
          role: "member",
          status: "active",
          expectedRevision: 0n,
        }),
      );
      const changed = await repositories.transaction(scope, (tx) =>
        tx.setMembership({
          accountId: member.accountId,
          role: "admin",
          status: "active",
          expectedRevision: added.revision,
        }),
      );
      assert.equal(changed.revision, 2n);
      await assert.rejects(() =>
        repositories.transaction(scope, (tx) =>
          tx.setMembership({
            accountId: member.accountId,
            role: "member",
            status: "revoked",
            expectedRevision: added.revision,
          }),
        ),
      );
      const rows = await readSecurityAudit(migration, {
        workspaceId,
        limit: 100,
      });
      assert.equal(rows.length, 2);
      const firstPage = await readSecurityAudit(migration, {
        workspaceId,
        limit: 1,
      });
      const secondPage = await readSecurityAudit(migration, {
        workspaceId,
        limit: 1,
        after: firstPage[0].id,
      });
      assert.deepEqual(
        [firstPage[0].id, secondPage[0].id],
        rows.map((row) => row.id),
      );
      assert.ok(
        rows.every(
          (row) =>
            row.accountId === owner.accountId &&
            row.subjectId === member.accountId,
        ),
      );
      assert.equal((await audit(member.accountId)).length, 0);
    },
  );

  await record(
    "session audit records rotation replay revocation and deduplicated verified-provider logout without credentials",
    async () => {
      const store = new PostgresIdentityRepository(runtime);
      const proof: ProviderIdentity = {
        issuer: "https://identity.example.test/observability",
        subject: randomUUID(),
        issuedAt: new Date(Date.now() - 1000),
        providerSessionId: randomUUID(),
      };
      const account = await store.resolveIdentity(proof),
        now = new Date();
      const digest = () =>
        createHash("sha256").update(randomUUID()).digest("hex");
      const makeSession = (): IdentitySession => ({
        ...account,
        id: randomUUID(),
        clientId: "extension-chromium",
        clientKind: "extension",
        providerIssuer: proof.issuer,
        providerSubject: proof.subject,
        providerSessionId: proof.providerSessionId,
        providerIssuedAt: proof.issuedAt,
        accessHash: digest(),
        refreshHash: digest(),
        csrfHash: digest(),
        accessExpiresAt: new Date(now.getTime() + 60000),
        expiresAt: new Date(now.getTime() + 600000),
        createdAt: now,
        lastUsedAt: now,
      });
      const first = makeSession();
      await store.createSession(first);
      const rotate = {
        clientId: first.clientId,
        refreshHash: first.refreshHash,
        nextRefreshHash: digest(),
        accessHash: digest(),
        csrfHash: digest(),
        accessExpiresAt: new Date(now.getTime() + 60000),
        now,
      };
      assert.equal((await store.rotateSession(rotate)).status, "rotated");
      assert.equal((await store.rotateSession(rotate)).status, "replayed");
      assert.equal(
        await store.revokeSession(account.accountId, first.id, now),
        false,
      );
      const second = makeSession();
      await store.createSession(second);
      const logout = {
        issuer: proof.issuer,
        subject: proof.subject,
        providerSessionId: proof.providerSessionId,
        eventId: randomUUID(),
        issuedAt: now,
        expiresAt: new Date(now.getTime() + 60000),
        now,
      };
      await store.revokeProviderSessions(logout);
      await store.revokeProviderSessions(logout);
      await store.revokeAllSessions(account.accountId, now);
      const rows = await audit(account.accountId);
      assert.deepEqual(
        rows.map((row) => row.kind),
        [
          "session.created",
          "session.rotated",
          "session.refresh_replay",
          "session.created",
          "sessions.provider_revoked",
          "sessions.revoked_all",
        ],
      );
      const serialized = JSON.stringify(rows);
      for (const forbidden of [
        proof.issuer,
        proof.subject,
        first.accessHash,
        first.refreshHash,
        first.csrfHash,
        logout.eventId,
      ])
        assert.ok(!serialized.includes(forbidden));
    },
  );

  await record(
    "product records require current scoped consent and strict bounded events with replay-safe export and deletion",
    async () => {
      const scope = await provision(),
        other = await provision(),
        input = event();
      await assert.rejects(
        () =>
          repositories.transaction(scope, (tx) => tx.recordProductEvent(input)),
        { code: "FORBIDDEN" },
      );
      const consent = await grant(scope);
      await withTransaction(
        runtime,
        async (client) => {
          assert.equal(
            (
              await client.query(
                "SELECT has_table_privilege(current_user,'tholi.accounts','UPDATE') AS broad_update",
              )
            ).rows[0].broad_update,
            false,
          );
          // The existing role policy must keep self-membership locking through
          // ordinary UPDATE admission denied. The narrow helper must work anyway.
          assert.equal(
            (
              await client.query(
                "SELECT account_id FROM tholi.memberships WHERE workspace_id=$1 AND account_id=$2 FOR SHARE",
                [scope.workspaceId, scope.accountId],
              )
            ).rowCount,
            0,
          );
          assert.equal(
            (
              await client.query(
                "SELECT tholi.lock_product_analytics_consent() AS allowed",
              )
            ).rows[0].allowed,
            true,
          );
        },
        scope,
      );
      assert.equal(
        (
          await runtime.query(
            "SELECT tholi.lock_product_analytics_consent() AS allowed",
          )
        ).rows[0].allowed,
        false,
      );
      await withTransaction(
        runtime,
        async (client) => {
          assert.equal(
            (
              await client.query(
                "SELECT tholi.lock_product_analytics_consent() AS allowed",
              )
            ).rows[0].allowed,
            false,
          );
        },
        { accountId: scope.accountId, workspaceId: other.workspaceId },
      );
      if (worker)
        await assert.rejects(
          () => worker.query("SELECT tholi.lock_product_analytics_consent()"),
          { code: "42501" },
        );
      assert.deepEqual(
        await repositories.transaction(scope, (tx) =>
          tx.recordProductEvent(input),
        ),
        { recorded: true },
      );
      assert.deepEqual(
        await repositories.transaction(scope, (tx) =>
          tx.recordProductEvent(input),
        ),
        { recorded: false },
      );
      await assert.rejects(
        () =>
          repositories.transaction(scope, (tx) =>
            tx.recordProductEvent({
              ...input,
              event: { name: "download_click" },
            }),
          ),
        { code: "IDEMPOTENCY_CONFLICT" },
      );
      await assert.rejects(() =>
        repositories.transaction(scope, (tx) =>
          tx.recordProductEvent({
            ...input,
            event: {
              name: "onboarding_complete",
              prompt: "PRODUCT_PRIVATE_SENTINEL",
            },
          } as never),
        ),
      );
      assert.equal(
        (
          await repositories.transaction(scope, (tx) =>
            tx.listProductEvents({ limit: 100 }),
          )
        ).length,
        1,
      );
      assert.deepEqual(
        await repositories.transaction(other, (tx) =>
          tx.listProductEvents({ limit: 100 }),
        ),
        [],
      );
      await assert.rejects(
        () =>
          withTransaction(
            runtime,
            (client) =>
              client.query(
                `INSERT INTO tholi.product_events(workspace_id,account_id,event_id,schema_version,event)
      VALUES($1,$2,$3,1,$4::jsonb)`,
                [
                  scope.workspaceId,
                  scope.accountId,
                  randomUUID(),
                  JSON.stringify({
                    name: "page_view",
                    page: "account",
                    goal: "PRODUCT_PRIVATE_SENTINEL",
                  }),
                ],
              ),
            scope,
          ),
        { code: "23514" },
      );
      await assert.rejects(
        () =>
          withTransaction(
            runtime,
            (client) =>
              client.query(
                `INSERT INTO tholi.product_events(workspace_id,account_id,event_id,schema_version,event)
      VALUES($1,$2,$3,1,'{"name":"onboarding_complete"}')`,
                [other.workspaceId, other.accountId, randomUUID()],
              ),
            scope,
          ),
        { code: "42501" },
      );
      await grant(scope, consent.revision, false);
      assert.deepEqual(
        await repositories.transaction(scope, (tx) =>
          tx.listProductEvents({ limit: 100 }),
        ),
        [],
      );
      assert.equal(
        await repositories.transaction(scope, (tx) => tx.deleteProductEvents()),
        0n,
      );
      await assert.rejects(
        () =>
          repositories.transaction(scope, (tx) =>
            tx.recordProductEvent(event()),
          ),
        { code: "FORBIDDEN" },
      );
    },
  );

  await record(
    "product ingestion serializes quota and both consent-withdrawal orderings",
    async () => {
      const scope = await provision(),
        consent = await grant(scope);
      let release!: () => void, entered!: () => void;
      const hold = new Promise<void>((resolve) => (release = resolve)),
        ready = new Promise<void>((resolve) => (entered = resolve));
      const pending = repositories.transaction(scope, async (tx) => {
        await tx.recordProductEvent(event());
        entered();
        await hold;
      });
      await ready;
      const withdrawal = grant(scope, consent.revision, false);
      release();
      await Promise.all([pending, withdrawal]);
      assert.deepEqual(
        await repositories.transaction(scope, (tx) =>
          tx.listProductEvents({ limit: 100 }),
        ),
        [],
      );
      const regranted = await grant(scope, consent.revision + 1n, true);
      let finishWithdrawal!: () => void, withdrawalEntered!: () => void;
      const blockWithdrawal = new Promise<void>(
          (resolve) => (finishWithdrawal = resolve),
        ),
        startedWithdrawal = new Promise<void>(
          (resolve) => (withdrawalEntered = resolve),
        );
      const withdrawing = repositories.transaction(scope, async (tx) => {
        await tx.recordConsent({
          purpose: "product_analytics",
          policyVersion: "1",
          granted: false,
          expectedRevision: regranted.revision,
        });
        withdrawalEntered();
        await blockWithdrawal;
      });
      await startedWithdrawal;
      const late = repositories.transaction(scope, (tx) =>
        tx.recordProductEvent(event()),
      );
      const denied = assert.rejects(() => late, { code: "FORBIDDEN" });
      finishWithdrawal();
      await Promise.all([withdrawing, denied]);
      await grant(scope, regranted.revision + 1n, true);
      await migration.query(
        `INSERT INTO tholi.product_events(workspace_id,account_id,event_id,schema_version,event)
      SELECT $1,$2,gen_random_uuid(),1,'{"name":"download_click"}' FROM generate_series(1,$3)`,
        [
          scope.workspaceId,
          scope.accountId,
          PRODUCT_ANALYTICS_LIMITS.dailyEvents - 1,
        ],
      );
      const admissions = await Promise.allSettled([
        repositories.transaction(scope, (tx) => tx.recordProductEvent(event())),
        repositories.transaction(scope, (tx) => tx.recordProductEvent(event())),
      ]);
      assert.equal(
        admissions.filter((result) => result.status === "fulfilled").length,
        1,
      );
      assert.equal(
        admissions.filter(
          (result) =>
            result.status === "rejected" &&
            result.reason.code === "RATE_LIMITED",
        ).length,
        1,
      );
    },
  );

  if (worker)
    await record(
      "worker-only bounded retention removes expired audit and product records after account and membership revocation",
      async () => {
        const scope = await provision();
        await grant(scope);
        await repositories.transaction(scope, (tx) =>
          tx.recordProductEvent(event()),
        );
        await migration.query(
          "UPDATE tholi.security_audit SET occurred_at=clock_timestamp()-interval '91 days',expires_at=clock_timestamp()-interval '1 day' WHERE account_id=$1",
          [scope.accountId],
        );
        await migration.query(
          "UPDATE tholi.product_events SET recorded_at=clock_timestamp()-interval '31 days',expires_at=clock_timestamp()-interval '1 day' WHERE account_id=$1",
          [scope.accountId],
        );
        await migration.query(
          "UPDATE tholi.accounts SET status='deleted' WHERE id=$1",
          [scope.accountId],
        );
        await migration.query(
          "UPDATE tholi.memberships SET status='revoked' WHERE account_id=$1",
          [scope.accountId],
        );
        await assert.rejects(
          () => runtime.query("SELECT * FROM tholi.prune_observability(100)"),
          { code: "42501" },
        );
        const removed = await new PostgresJobs(worker).pruneObservability(1000);
        assert.ok(removed.audit_deleted >= 1 && removed.product_deleted >= 1);
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.security_audit WHERE account_id=$1",
              [scope.accountId],
            )
          ).rows[0].count,
          0,
        );
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.product_events WHERE account_id=$1",
              [scope.accountId],
            )
          ).rows[0].count,
          0,
        );
        await assert.rejects(
          () => worker.query("SELECT * FROM tholi.security_audit"),
          { code: "42501" },
        );
        await assert.rejects(() =>
          new PostgresJobs(worker).pruneObservability(1001),
        );
      },
    );

  if (worker)
    await record(
      "server-origin correlation survives enqueue replay and actual lease retry while SQL instrumentation excludes private values",
      async () => {
        let current: Correlation = {
          requestId: randomUUID(),
          traceId: "1234567890abcdef1234567890abcdef",
          spanId: "1234567890abcdef",
        };
        const origin = { ...current },
          observations: unknown[] = [];
        const observer: Observability = {
          ...NO_OBSERVABILITY,
          enabled: true,
          current: () => current,
          run: (_context, work) => work(),
          start: (operation, fields) => ({
            correlation: current,
            end: (outcome, endFields) => {
              observations.push({ operation, fields, outcome, endFields });
            },
          }),
          metric: (name, value, fields) => {
            observations.push({ name, value, fields });
          },
        };
        const pool = createDatabasePool(
          { connectionString: runtimeConnection, max: 1 },
          observer,
        );
        let phase = "ENQUEUE_ORIGIN";
        try {
          const observed = new PostgresRepositories(pool),
            scope = await provision(),
            command = {
              kind: "identity.prune-expired-brokers",
              version: 1,
              replaySafe: true,
              idempotencyKey: randomUUID(),
              recordReferences: { accountId: scope.accountId },
            };
          const job = await observed.transaction(scope, (tx) =>
            tx.enqueueJob(command),
          );
          current = {
            ...current,
            requestId: randomUUID(),
            traceId: "abcdef1234567890abcdef1234567890",
          };
          assert.equal(
            (await observed.transaction(scope, (tx) => tx.enqueueJob(command)))
              .id,
            job.id,
          );
          const jobs = new PostgresJobs(worker);
          phase = "FIRST_CLAIM";
          await migration.query(
            "UPDATE tholi.jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind=$1 AND status='queued' AND id<>$2",
            [command.kind, job.id],
          );
          const lease = (
            await jobs.claim({
              workerId: "observability-pg",
              kinds: [{ kind: command.kind, version: 1, replaySafe: true }],
              leaseMs: 30000,
              limit: 10,
            })
          ).find((item) => item.id === job.id);
          assert.ok(lease);
          assert.deepEqual(lease.correlation, origin);
          phase = "RETRY_ORIGIN";
          assert.equal(
            await jobs.fail(lease, {
              classification: "retryable",
              code: "UNAVAILABLE",
              backoffMs: 1000,
            }),
            true,
          );
          await migration.query(
            "UPDATE tholi.jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",
            [job.id],
          );
          const retried = (
            await jobs.claim({
              workerId: "observability-pg",
              kinds: [{ kind: command.kind, version: 1, replaySafe: true }],
              leaseMs: 30000,
              limit: 10,
            })
          ).find((item) => item.id === job.id);
          assert.ok(retried);
          assert.deepEqual(retried.correlation, origin);
          assert.notEqual(retried.leaseToken, lease.leaseToken);
          assert.equal(retried.attempts, 2);
          phase = "IMMUTABLE_ORIGIN";
          await assert.rejects(
            () =>
              withTransaction(
                runtime,
                (client) =>
                  client.query(
                    "UPDATE tholi.jobs SET origin_correlation=$1::jsonb WHERE id=$2 AND workspace_id=$3 AND account_id=$4",
                    [
                      JSON.stringify(current),
                      job.id,
                      scope.workspaceId,
                      scope.accountId,
                    ],
                  ),
                scope,
              ),
            { code: "23514" },
          );
          phase = "PUBLIC_METADATA";
          assert.ok(!("correlation" in job));
          phase = "SAFE_SQL_METRICS";
          await assert.rejects(() =>
            observed.transaction(scope, (client) =>
              client.getArtifact("SQL_PRIVATE_SENTINEL"),
            ),
          );
          assert.ok(
            observations.some(
              (value) =>
                (value as { name?: string }).name === "database.pool.wait_ms",
            ),
          );
          assert.ok(
            observations.some(
              (value) =>
                (value as { operation?: string; outcome?: string })
                  .operation === "database.transaction" &&
                (value as { outcome?: string }).outcome === "error",
            ),
          );
          assert.doesNotMatch(
            JSON.stringify(observations),
            /SQL_PRIVATE_SENTINEL|postgres:|password|SELECT |INSERT |UPDATE |token_hash/,
          );
        } catch {
          // Fixed diagnostic labels only, never actual assertion values or SQL.
          throw Object.assign(new Error("Correlation verification failed."), {
            code: "CORRELATION_" + phase,
          });
        } finally {
          await pool.end();
        }
      },
    );
}
