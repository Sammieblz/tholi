import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import {
  createDatabasePool,
  withTransaction,
} from "../../../apps/api/src/database/postgres";
import {
  migrateDatabase,
  migrations,
  verifyDatabase,
} from "../../../apps/api/src/database/migrations";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { runIdentityChecks } from "./identity-checks";
import { runAuthorizationChecks } from "./authorization-checks";
import { runJobChecks } from "./job-checks";
import { runSupportChecks } from "./support-checks";
import { runObservabilityChecks } from "./observability-checks";
import { runQuotaChecks } from "./quotas-checks";
import { runPlanChecks } from "./plans-checks";
import { runSavedDataChecks } from "./saved-data-checks";
import {
  beginJourney,
  saveTask,
} from "../../../packages/goal-planner/task-journey";

export interface PostgresCheckOptions {
  migrationConnection: string;
  runtimeConnection: string;
  workerConnection?: string;
}

export async function runPostgresChecks(options: PostgresCheckOptions) {
  const migration = createDatabasePool({
    connectionString: options.migrationConnection,
    max: 1,
  });
  const runtime = createDatabasePool({
    connectionString: options.runtimeConnection,
    max: 4,
  });
  const reused = createDatabasePool({
    connectionString: options.runtimeConnection,
    max: 1,
  });
  const repositories = new PostgresRepositories(runtime);
  const worker = options.workerConnection
    ? createDatabasePool({ connectionString: options.workerConnection, max: 4 })
    : undefined;
  const workerRole = worker ? "tholi_worker" : undefined;
  const provision = () =>
    repositories.provisionAccount({
      accountId: randomUUID(),
      workspaceId: randomUUID(),
    });
  const future = () => new Date(Date.now() + 60 * 60 * 1000);
  const savedRoute = (goal = "Open Languages") =>
    saveTask(beginJourney(goal, "https://example.test"));
  const checks: { name: string; passed: true }[] = [];
  const record = async (name: string, work: () => Promise<void>) => {
    try {
      await work();
      checks.push({ name, passed: true });
    } catch (error) {
      const code = (error as { code?: string }).code;
      throw new Error(
        `PostgreSQL check failed: ${name}${code ? ` (${code})` : ""}.`,
      );
    }
  };

  try {
    await record(
      "fresh migration, retained-data upgrade and idempotent replay",
      async () => {
        const client = await migration.connect();
        try {
          assert.equal(
            (
              await client.query(
                "SELECT to_regclass('tholi.schema_migrations') AS ledger",
              )
            ).rows[0].ledger,
            null,
            "The upgrade check requires its fresh smoke database.",
          );
          assert.ok(
            migrations.length > 1,
            "Use the actual staged application migrations.",
          );
          await migrateDatabase(client, {
            target: migrations[0].version,
            runtimeRole: "tholi_runtime",
          });
          const accountId = randomUUID();
          await client.query("INSERT INTO tholi.accounts (id) VALUES ($1)", [
            accountId,
          ]);
          const foundationSessionId = randomUUID();
          await client.query(
            "INSERT INTO tholi.sessions (id,account_id,token_hash,expires_at) VALUES ($1,$2,$3,$4)",
            [foundationSessionId, accountId, Buffer.alloc(32, 1), future()],
          );
          // Exercise the actual pre-allocation ledger during the v7 to v8
          // upgrade, including a hold on a grant that has since expired.
          await migrateDatabase(client, {
            target: 7,
            runtimeRole: "tholi_runtime",
            workerRole,
          });
          const historicalCreditScope = {
            accountId: randomUUID(),
            workspaceId: randomUUID(),
          };
          await client.query("SELECT tholi.provision_personal_account($1,$2)", [
            historicalCreditScope.accountId,
            historicalCreditScope.workspaceId,
          ]);
          await client.query(
            `INSERT INTO tholi.credit_grants
             (workspace_id,id,idempotency_key,amount,created_at,expires_at)
             VALUES ($1,$2,'historical-expired-period',100,
               clock_timestamp()-interval '4 hours',
               clock_timestamp()-interval '1 hour'),
             ($1,$3,'historical-current-period',100,clock_timestamp(),NULL)`,
            [historicalCreditScope.workspaceId, randomUUID(), randomUUID()],
          );
          for (const [status, amount] of [
            ["settled", 60],
            ["uncertain", 20],
          ] as const) {
            const requestId = randomUUID(),
              reservationId = randomUUID();
            await client.query(
              `INSERT INTO tholi.requests
               (workspace_id,id,account_id,operation,idempotency_key,payload_hash,created_at)
               VALUES ($1,$2,$3,'navigation',$4,decode($5,'hex'),
                 clock_timestamp()-interval '3 hours')`,
              [
                historicalCreditScope.workspaceId,
                requestId,
                historicalCreditScope.accountId,
                `historical-${status}`,
                "a".repeat(64),
              ],
            );
            await client.query(
              `INSERT INTO tholi.credit_reservations
               (workspace_id,id,request_id,amount,status,created_at,expires_at)
               VALUES ($1,$2,$3,$4,$5,clock_timestamp()-interval '3 hours',
                 clock_timestamp()+interval '1 hour')`,
              [
                historicalCreditScope.workspaceId,
                reservationId,
                requestId,
                amount,
                status,
              ],
            );
            if (status === "settled")
              await client.query(
                `INSERT INTO tholi.credit_settlements
                 (workspace_id,id,reservation_id,amount,created_at)
                 VALUES ($1,$2,$3,$4,clock_timestamp()-interval '2 hours')`,
                [
                  historicalCreditScope.workspaceId,
                  randomUUID(),
                  reservationId,
                  amount,
                ],
              );
          }
          const overlappingScopes = [];
          for (const previousStatus of ["settled", "released"] as const) {
            const scope = {
              accountId: randomUUID(),
              workspaceId: randomUUID(),
            };
            overlappingScopes.push({ scope, previousStatus });
            await client.query(
              "SELECT tholi.provision_personal_account($1,$2)",
              [scope.accountId, scope.workspaceId],
            );
            await client.query(
              `INSERT INTO tholi.credit_grants
               (workspace_id,id,idempotency_key,amount,created_at,expires_at)
               VALUES ($1,$2,'overlap-first-lot',100,
                 clock_timestamp()-interval '4 hours',
                 clock_timestamp()-interval '1 hour'),
               ($1,$3,'overlap-second-lot',100,
                 clock_timestamp()-interval '3 hours',NULL)`,
              [scope.workspaceId, randomUUID(), randomUUID()],
            );
            // The first lot was fully held when the second hold began. Its
            // later zero settlement/release cannot retroactively fund that hold.
            for (const [
              key,
              status,
              reservedMinutesAgo,
              finishedMinutesAgo,
              spent,
            ] of [
              ["earlier", previousStatus, 210, 120, 0],
              ["later", "settled", 165, 150, 100],
            ] as const) {
              const requestId = randomUUID(),
                reservationId = randomUUID();
              await client.query(
                `INSERT INTO tholi.requests
                 (workspace_id,id,account_id,operation,idempotency_key,payload_hash,created_at)
                 VALUES ($1,$2,$3,'navigation',$4,decode($5,'hex'),
                   clock_timestamp()-$6::integer*interval '1 minute')`,
                [
                  scope.workspaceId,
                  requestId,
                  scope.accountId,
                  key,
                  "a".repeat(64),
                  reservedMinutesAgo,
                ],
              );
              await client.query(
                `INSERT INTO tholi.credit_reservations
                 (workspace_id,id,request_id,amount,status,created_at,updated_at,expires_at)
                 VALUES ($1,$2,$3,100,$4,
                   clock_timestamp()-$5::integer*interval '1 minute',
                   clock_timestamp()-$6::integer*interval '1 minute',
                   clock_timestamp()+interval '1 hour')`,
                [
                  scope.workspaceId,
                  reservationId,
                  requestId,
                  status,
                  reservedMinutesAgo,
                  finishedMinutesAgo,
                ],
              );
              if (status === "settled")
                await client.query(
                  `INSERT INTO tholi.credit_settlements
                   (workspace_id,id,reservation_id,amount,created_at)
                   VALUES ($1,$2,$3,$4,
                     clock_timestamp()-$5::integer*interval '1 minute')`,
                  [
                    scope.workspaceId,
                    randomUUID(),
                    reservationId,
                    spent,
                    finishedMinutesAgo,
                  ],
                );
            }
          }
          await migrateDatabase(client, {
            runtimeRole: "tholi_runtime",
            workerRole,
          });
          assert.deepEqual(
            (
              await client.query(
                `SELECT r.status,r.amount::text,
                   COALESCE(s.amount,0)::text AS settled
                 FROM tholi.credit_reservations r
                 LEFT JOIN tholi.credit_settlements s
                   ON s.workspace_id=r.workspace_id AND s.reservation_id=r.id
                 WHERE r.workspace_id=$1 ORDER BY r.status`,
                [historicalCreditScope.workspaceId],
              )
            ).rows,
            [
              { status: "settled", amount: "60", settled: "60" },
              { status: "uncertain", amount: "20", settled: "0" },
            ],
            "The upgrade retains settled history and unknown liabilities.",
          );
          assert.equal(
            (
              await repositories.transaction(historicalCreditScope, (scoped) =>
                scoped.creditBalance(),
              )
            ).available,
            100n,
            "Pre-upgrade spending and uncertainty remain allocated to their original grant period.",
          );
          for (const { scope, previousStatus } of overlappingScopes)
            assert.deepEqual(
              await repositories.transaction(scope, (scoped) =>
                scoped.creditBalance(),
              ),
              {
                granted: 200n,
                spent: 100n,
                reserved: 0n,
                available: 0n,
                expired: 100n,
                refunded: 0n,
              },
              `A later ${previousStatus} hold cannot free an earlier held lot retroactively.`,
            );
          assert.equal(
            (
              await client.query(
                "SELECT count(*)::integer AS count FROM tholi.accounts WHERE id = $1",
                [accountId],
              )
            ).rows[0].count,
            1,
          );
          const historicalSession = (
            await client.query(
              "SELECT status,revoked_at FROM tholi.sessions WHERE id = $1",
              [foundationSessionId],
            )
          ).rows[0];
          assert.equal(historicalSession.status, "revoked");
          assert.ok(historicalSession.revoked_at instanceof Date);
          const before = (
            await client.query(
              "SELECT version, name, checksum, applied_at FROM tholi.schema_migrations ORDER BY version",
            )
          ).rows;
          assert.equal(before.length, migrations.length);
          await migrateDatabase(client, {
            runtimeRole: "tholi_runtime",
            workerRole,
          });
          await verifyDatabase(client);
          assert.deepEqual(
            (
              await client.query(
                "SELECT version, name, checksum, applied_at FROM tholi.schema_migrations ORDER BY version",
              )
            ).rows,
            before,
          );
        } finally {
          client.release();
        }
      },
    );

    await record(
      "migration checksum drift is rejected without applying changes",
      async () => {
        const client = await migration.connect();
        const first = migrations[0];
        const wrong =
          first.checksum === "0".repeat(64) ? "1".repeat(64) : "0".repeat(64);
        try {
          await client.query(
            "UPDATE tholi.schema_migrations SET checksum = $1 WHERE version = $2",
            [wrong, first.version],
          );
          await assert.rejects(() => verifyDatabase(client));
          await assert.rejects(() =>
            migrateDatabase(client, { runtimeRole: "tholi_runtime" }),
          );
        } finally {
          await client.query(
            "UPDATE tholi.schema_migrations SET checksum = $1 WHERE version = $2",
            [first.checksum, first.version],
          );
          client.release();
        }
        const verified = await migration.connect();
        try {
          await verifyDatabase(verified);
          const futureVersion = migrations.at(-1)!.version + 1;
          await verified.query(
            "INSERT INTO tholi.schema_migrations (version, name, checksum) VALUES ($1, 'unknown-future-fixture', $2)",
            [futureVersion, "f".repeat(64)],
          );
          try {
            await assert.rejects(() => verifyDatabase(verified));
            await assert.rejects(() =>
              migrateDatabase(verified, { runtimeRole: "tholi_runtime" }),
            );
          } finally {
            await verified.query(
              "DELETE FROM tholi.schema_migrations WHERE version = $1",
              [futureVersion],
            );
          }
          assert.equal(await verifyDatabase(verified), migrations.length);
        } finally {
          verified.release();
        }
      },
    );

    await record(
      "the real runtime role is non-owner and cannot create schema objects",
      async () => {
        const role = (
          await runtime.query(`
        SELECT current_user AS name, rolsuper, rolbypassrls, rolcreatedb, rolcreaterole,
          pg_has_role(current_user, 'tholi_migrator', 'MEMBER') AS inherits_migrator,
          has_schema_privilege(current_user, 'tholi', 'CREATE') AS can_create
        FROM pg_roles WHERE rolname = current_user
      `)
        ).rows[0];
        assert.equal(role.name, "tholi_runtime");
        for (const key of [
          "rolsuper",
          "rolbypassrls",
          "rolcreatedb",
          "rolcreaterole",
          "inherits_migrator",
          "can_create",
        ])
          assert.equal(role[key], false, key);
        assert.equal(
          (
            await runtime.query(`
        SELECT count(*)::integer AS count FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'tholi' AND c.relowner = current_user::regrole
      `)
          ).rows[0].count,
          0,
        );
        await assert.rejects(
          () =>
            runtime.query(
              "CREATE TABLE tholi.forbidden_runtime_ddl (id integer)",
            ),
          { code: "42501" },
        );
        const client = await runtime.connect();
        try {
          assert.equal(await verifyDatabase(client), migrations.length);
        } finally {
          client.release();
        }
      },
    );

    await record(
      "explicit connection budgets and TLS policy ignore ambient PG configuration",
      async () => {
        const values = {
          PGHOST: "unreachable.invalid",
          PGPORT: "1",
          PGUSER: "wrong_runtime",
          PGPASSWORD: "synthetic-wrong-password",
          PGSSLMODE: "verify-full",
          PGOPTIONS: "-c default_transaction_read_only=on",
        };
        const previous = Object.fromEntries(
          Object.keys(values).map((key) => [key, process.env[key]]),
        );
        let pool: ReturnType<typeof createDatabasePool> | undefined;
        try {
          Object.assign(process.env, values);
          pool = createDatabasePool({
            connectionString: options.runtimeConnection,
            max: 1,
          });
          const row = (
            await pool.query(
              `SELECT current_user AS name,
              current_setting('statement_timeout') AS statement_timeout,
              current_setting('lock_timeout') AS lock_timeout,
              current_setting('default_transaction_read_only') AS read_only`,
            )
          ).rows[0];
          assert.deepEqual(row, {
            name: "tholi_runtime",
            statement_timeout: "5s",
            lock_timeout: "2s",
            read_only: "off",
          });
        } finally {
          for (const [key, value] of Object.entries(previous)) {
            if (value === undefined) delete process.env[key];
            else process.env[key] = value;
          }
          await pool?.end();
        }
        for (const [name, value] of [
          ["statement_timeout", "0"],
          ["sslmode", "no-verify"],
        ]) {
          const url = new URL(options.runtimeConnection);
          url.searchParams.set(name, value);
          assert.throws(() =>
            createDatabasePool({ connectionString: url.toString() }),
          );
        }
        assert.throws(() =>
          createDatabasePool({
            connectionString: options.runtimeConnection,
            statementTimeoutMillis: 0,
          }),
        );
        assert.throws(() =>
          createDatabasePool({
            connectionString: options.runtimeConnection,
            ssl: { ca: "synthetic", rejectUnauthorized: false } as unknown as {
              ca: string;
              rejectUnauthorized: true;
            },
          }),
        );
      },
    );

    await record(
      "repository scopes reject unauthorized, suspended and revoked actors",
      async () => {
        const owner = await provision();
        const stranger = await provision();
        let entered = false;
        await assert.rejects(
          () =>
            repositories.transaction(
              { accountId: stranger.accountId, workspaceId: owner.workspaceId },
              async () => {
                entered = true;
              },
            ),
          { code: "FORBIDDEN" },
        );
        assert.equal(entered, false);
        await migration.query(
          "UPDATE tholi.memberships SET status = 'revoked' WHERE workspace_id = $1 AND account_id = $2",
          [owner.workspaceId, owner.accountId],
        );
        try {
          await assert.rejects(
            () => repositories.transaction(owner, async () => {}),
            { code: "FORBIDDEN" },
          );
        } finally {
          await migration.query(
            "UPDATE tholi.memberships SET status = 'active' WHERE workspace_id = $1 AND account_id = $2",
            [owner.workspaceId, owner.accountId],
          );
        }
        await migration.query(
          "UPDATE tholi.accounts SET status = 'suspended' WHERE id = $1",
          [owner.accountId],
        );
        try {
          await assert.rejects(
            () => repositories.transaction(owner, async () => {}),
            { code: "FORBIDDEN" },
          );
        } finally {
          await migration.query(
            "UPDATE tholi.accounts SET status = 'active' WHERE id = $1",
            [owner.accountId],
          );
        }
        await repositories.transaction(owner, async () => {});
      },
    );

    await record(
      "workspace predicates and composite foreign keys prevent cross-workspace reuse",
      async () => {
        const first = await provision();
        const second = await provision();
        const artifact = await repositories.transaction(first, (scoped) =>
          scoped.saveArtifact({
            expectedRevision: 0n,
            userApproved: true,
            content: savedRoute(),
          }),
        );
        const request = await repositories.transaction(
          first,
          async (scoped) =>
            (
              await scoped.beginRequest({
                operation: "navigation",
                idempotencyKey: "private-request",
                payloadHash: "a".repeat(64),
              })
            ).request,
        );
        await repositories.transaction(second, async (scoped) => {
          assert.equal((await scoped.getArtifact(artifact.id)) ?? null, null);
          assert.equal((await scoped.getRequest(request.id)) ?? null, null);
          assert.deepEqual((await scoped.listArtifacts({})).items, []);
        });
        await assert.rejects(() =>
          repositories.transaction(second, (scoped) =>
            scoped.saveArtifact({
              id: artifact.id,
              expectedRevision: artifact.revision,
              userApproved: true,
              content: savedRoute("Open Appearance"),
            }),
          ),
        );
        await assert.rejects(() =>
          repositories.transaction(second, (scoped) =>
            scoped.tombstoneArtifact(artifact.id, artifact.revision),
          ),
        );
        assert.deepEqual(
          await repositories.transaction(first, (scoped) =>
            scoped.getArtifact(artifact.id),
          ),
          artifact,
        );
        await assert.rejects(
          () =>
            migration.query(
              `INSERT INTO tholi.credit_reservations
                (workspace_id, id, request_id, amount, expires_at)
                VALUES ($1, $2, $3, 1, $4)`,
              [second.workspaceId, randomUUID(), request.id, future()],
            ),
          { code: "23503" },
        );
        await assert.rejects(
          () =>
            migration.query(
              `INSERT INTO tholi.jobs
                (workspace_id, id, account_id, request_id, kind, version, idempotency_key, record_references)
                VALUES ($1, $2, $3, $4, 'sync', 1, 'foreign-request', '{}')`,
              [second.workspaceId, randomUUID(), second.accountId, request.id],
            ),
          { code: "23503" },
        );
      },
    );

    await record(
      "saved routes paginate by revision and retain tombstones against stale resync",
      async () => {
        const scope = await provision();
        const content = savedRoute();
        const first = await repositories.transaction(scope, (scoped) =>
          scoped.saveArtifact({
            expectedRevision: 0n,
            content,
            userApproved: true,
          }),
        );
        const second = await repositories.transaction(scope, (scoped) =>
          scoped.saveArtifact({
            expectedRevision: 0n,
            content: savedRoute("Open Appearance"),
            userApproved: true,
          }),
        );
        const third = await repositories.transaction(scope, (scoped) =>
          scoped.saveArtifact({
            expectedRevision: 0n,
            content: savedRoute("Open Help"),
            userApproved: true,
          }),
        );
        assert.equal(first.content?.id, content.id);
        assert.equal(first.ownerAccountId, scope.accountId);
        assert.equal(first.revision, 1n);
        const page = await repositories.transaction(scope, (scoped) =>
          scoped.listArtifacts({ limit: 2 }),
        );
        assert.deepEqual(
          page.items.map((item) => item.id),
          [first.id, second.id],
        );
        assert.equal(page.nextCursor, second.syncRevision);
        const last = await repositories.transaction(scope, (scoped) =>
          scoped.listArtifacts({ after: page.nextCursor, limit: 2 }),
        );
        assert.deepEqual(
          last.items.map((item) => item.id),
          [third.id],
        );
        assert.equal(last.nextCursor, undefined);

        const updated = await repositories.transaction(scope, (scoped) =>
          scoped.saveArtifact({
            id: first.id,
            expectedRevision: first.revision,
            content: savedRoute("Change Languages"),
            userApproved: true,
          }),
        );
        assert.equal(updated.revision, 2n);
        assert.ok(updated.syncRevision > third.syncRevision);
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.saveArtifact({
                id: first.id,
                expectedRevision: first.revision,
                content,
                userApproved: true,
              }),
            ),
          { code: "CONFLICT" },
        );
        const tombstone = await repositories.transaction(scope, (scoped) =>
          scoped.tombstoneArtifact(first.id, updated.revision),
        );
        assert.equal(tombstone.revision, 3n);
        assert.ok(tombstone.syncRevision > updated.syncRevision);
        assert.ok(tombstone.deletedAt instanceof Date);
        assert.equal(tombstone.content, null);
        const changes = await repositories.transaction(scope, (scoped) =>
          scoped.listArtifacts({
            after: third.syncRevision,
            includeDeleted: true,
          }),
        );
        assert.deepEqual(
          changes.items.map((item) => item.id),
          [first.id],
        );
        assert.equal(changes.items[0].content, null);
        assert.deepEqual(
          (
            await repositories.transaction(scope, (scoped) =>
              scoped.listArtifacts({ includeDeleted: false }),
            )
          ).items.map((item) => item.id),
          [second.id, third.id],
        );
        for (const stale of [0n, first.revision, updated.revision]) {
          await assert.rejects(() =>
            repositories.transaction(scope, (scoped) =>
              scoped.saveArtifact({
                id: first.id,
                expectedRevision: stale,
                content,
                userApproved: true,
              }),
            ),
          );
        }
        assert.equal(
          (
            await repositories.transaction(scope, (scoped) =>
              scoped.getArtifact(first.id),
            )
          )?.deletedAt?.getTime(),
          tombstone.deletedAt.getTime(),
        );
      },
    );

    await record(
      "account, membership, consent and versioned catalog records persist independently",
      async () => {
        const scope = await provision();
        assert.deepEqual(await repositories.provisionAccount(scope), scope);
        const other = await provision();
        const consent = await repositories.transaction(
          scope,
          async (scoped) => {
            const account = await scoped.getAccount();
            assert.equal(account.id, scope.accountId);
            assert.equal(account.status, "active");
            assert.equal((await scoped.getMembership())?.role, "owner");
            return scoped.recordConsent({
              purpose: "cloud_saved_routes",
              policyVersion: "synthetic-1",
              granted: true,
              expectedRevision: 0n,
            });
          },
        );
        const revoked = await repositories.transaction(scope, (scoped) =>
          scoped.recordConsent({
            purpose: consent.purpose,
            policyVersion: "synthetic-2",
            granted: false,
            expectedRevision: consent.revision,
          }),
        );
        assert.equal(revoked.id, consent.id);
        assert.equal(revoked.revision, consent.revision + 1n);
        assert.deepEqual(
          await repositories.transaction(scope, (scoped) =>
            scoped.getConsent(consent.purpose),
          ),
          revoked,
        );
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.recordConsent({
                purpose: consent.purpose,
                policyVersion: "synthetic-1",
                granted: true,
                expectedRevision: consent.revision,
              }),
            ),
          { code: "CONFLICT" },
        );
        await repositories.transaction(other, async (scoped) => {
          assert.equal(await scoped.getConsent(consent.purpose), undefined);
          assert.equal(await scoped.getMembership(scope.accountId), undefined);
        });

        const plan = {
          planId: "synthetic-" + randomUUID(),
          version: 1,
          name: "Integration fixture",
          definition: { synthetic: true },
        };
        await repositories.transaction(scope, (scoped) =>
          scoped.publishPlanVersion(plan),
        );
        assert.deepEqual(
          await repositories.transaction(scope, (scoped) =>
            scoped.publishPlanVersion(plan),
          ),
          plan,
        );
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.publishPlanVersion({
                ...plan,
                definition: { synthetic: true, changed: true },
              }),
            ),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        const entitlement = await repositories.transaction(scope, (scoped) =>
          scoped.putEntitlement({
            id: randomUUID(),
            planId: plan.planId,
            planVersion: plan.version,
            status: "active",
            startsAt: new Date(Date.now() - 1000),
            endsAt: null,
            expectedRevision: 0n,
          }),
        );
        assert.deepEqual(
          await repositories.transaction(scope, (scoped) =>
            scoped.listEntitlements(),
          ),
          [entitlement],
        );
        await repositories.transaction(other, async (scoped) => {
          assert.deepEqual(
            await scoped.getPlanVersion(plan.planId, plan.version),
            plan,
          );
          assert.deepEqual(await scoped.listEntitlements(), []);
        });
        await assert.rejects(
          () =>
            runtime.query(
              "UPDATE tholi.plan_versions SET name = 'changed' WHERE plan_id = $1",
              [plan.planId],
            ),
          { code: "42501" },
        );
      },
    );

    await record(
      "concurrent request keys admit one command and reject changed payloads",
      async () => {
        const scope = await provision();
        const command = {
          operation: "navigation",
          idempotencyKey: "repeated-command",
          payloadHash: "b".repeat(64),
        };
        const results = await Promise.all(
          Array.from({ length: 4 }, () =>
            repositories.transaction(scope, (scoped) =>
              scoped.beginRequest(command),
            ),
          ),
        );
        assert.equal(new Set(results.map((item) => item.request.id)).size, 1);
        assert.equal(results.filter((item) => !item.replayed).length, 1);
        const requestId = results[0].request.id;
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.beginRequest({ ...command, payloadHash: "c".repeat(64) }),
            ),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        await repositories.transaction(scope, (scoped) =>
          scoped.setRequestStatus(requestId, "completed"),
        );
        const replay = await repositories.transaction(scope, (scoped) =>
          scoped.beginRequest(command),
        );
        assert.equal(replay.replayed, true);
        assert.equal(replay.request.id, requestId);
        assert.equal(replay.request.status, "completed");
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.requests WHERE workspace_id = $1",
              [scope.workspaceId],
            )
          ).rows[0].count,
          1,
        );
      },
    );

    await record(
      "conditional request completion cannot overwrite cancellation from another replica",
      async () => {
        const scope = await provision();
        const { request } = await repositories.transaction(scope, (scoped) =>
          scoped.beginRequest({
            operation: "navigation-decisions.v1",
            idempotencyKey: randomUUID(),
            payloadHash: "d".repeat(64),
          }),
        );
        let observed!: () => void, release!: () => void;
        const pendingRead = new Promise<void>((resolve) => {
          observed = resolve;
        });
        const held = new Promise<void>((resolve) => {
          release = resolve;
        });
        const completion = repositories.transaction(scope, async (scoped) => {
          assert.equal(
            (await scoped.getRequest(request.id))?.status,
            "pending",
          );
          observed();
          await held;
          return scoped.setRequestStatus(request.id, "completed", "pending");
        });
        const rejected = assert.rejects(completion, { code: "CONFLICT" });
        try {
          await pendingRead;
          const cancelled = await repositories.transaction(scope, (scoped) =>
            scoped.setRequestStatus(request.id, "uncertain", "pending"),
          );
          assert.equal(cancelled.status, "uncertain");
        } finally {
          release();
        }
        await rejected;
        assert.equal(
          (
            await repositories.transaction(scope, (scoped) =>
              scoped.getRequest(request.id),
            )
          )?.status,
          "uncertain",
        );
        // Existing reconciliation callers retain their unconditional transition.
        await repositories.transaction(scope, (scoped) =>
          scoped.setRequestStatus(request.id, "completed"),
        );
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.setRequestStatus(request.id, "uncertain", "pending"),
            ),
          { code: "CONFLICT" },
        );
        assert.equal(
          (
            await repositories.transaction(scope, (scoped) =>
              scoped.getRequest(request.id),
            )
          )?.status,
          "completed",
        );
      },
    );

    await record(
      "concurrent credit reservations cannot overspend and settlement is idempotent",
      async () => {
        const scope = await provision();
        const grantCommand = {
          idempotencyKey: "synthetic-grant",
          amount: 100n,
        };
        const grants = await Promise.all(
          Array.from({ length: 2 }, () =>
            repositories.transaction(scope, (scoped) =>
              scoped.grantCredits(grantCommand),
            ),
          ),
        );
        assert.equal(grants[0].id, grants[1].id);
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.grantCredits({ ...grantCommand, amount: 101n }),
            ),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        const expiresAt = future();
        const requests = await repositories.transaction(scope, async (scoped) =>
          Promise.all(
            ["first", "second"].map((key) =>
              scoped.beginRequest({
                operation: "navigation",
                idempotencyKey: key,
                payloadHash: "d".repeat(64),
              }),
            ),
          ),
        );
        const reservations = await Promise.allSettled(
          requests.map(({ request }) =>
            repositories.transaction(scope, (scoped) =>
              scoped.reserveCredits({
                requestId: request.id,
                amount: 80n,
                expiresAt,
              }),
            ),
          ),
        );
        const accepted = reservations.filter(
          (item) => item.status === "fulfilled",
        );
        const denied = reservations.filter(
          (item) => item.status === "rejected",
        );
        assert.equal(accepted.length, 1);
        assert.equal(denied.length, 1);
        assert.equal(denied[0].reason.code, "INSUFFICIENT_CREDITS");
        const held = accepted[0].value;
        assert.deepEqual(
          await repositories.transaction(scope, (scoped) =>
            scoped.creditBalance(),
          ),
          {
            granted: 100n,
            spent: 0n,
            reserved: 80n,
            available: 20n,
            expired: 0n,
            refunded: 0n,
          },
        );
        const settlementCommand = { reservationId: held.id, amount: 50n };
        const settlements = await Promise.all(
          Array.from({ length: 2 }, () =>
            repositories.transaction(scope, (scoped) =>
              scoped.settleCredits(settlementCommand),
            ),
          ),
        );
        assert.equal(settlements[0].id, settlements[1].id);
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.settleCredits({ ...settlementCommand, amount: 51n }),
            ),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        assert.deepEqual(
          await repositories.transaction(scope, (scoped) =>
            scoped.creditBalance(),
          ),
          {
            granted: 100n,
            spent: 50n,
            reserved: 0n,
            available: 50n,
            expired: 0n,
            refunded: 0n,
          },
        );
        const request = await repositories.transaction(scope, (scoped) =>
          scoped.beginRequest({
            operation: "navigation",
            idempotencyKey: "released",
            payloadHash: "e".repeat(64),
          }),
        );
        const reservationCommand = {
          requestId: request.request.id,
          amount: 20n,
          expiresAt,
        };
        const duplicates = await Promise.all(
          Array.from({ length: 2 }, () =>
            repositories.transaction(scope, (scoped) =>
              scoped.reserveCredits(reservationCommand),
            ),
          ),
        );
        assert.equal(duplicates[0].id, duplicates[1].id);
        const releases = await Promise.all(
          Array.from({ length: 2 }, () =>
            repositories.transaction(scope, (scoped) =>
              scoped.releaseCredits(duplicates[0].id),
            ),
          ),
        );
        assert.ok(releases.every((item) => item.status === "released"));
        assert.deepEqual(
          await repositories.transaction(scope, (scoped) =>
            scoped.creditBalance(),
          ),
          {
            granted: 100n,
            spent: 50n,
            reserved: 0n,
            available: 50n,
            expired: 0n,
            refunded: 0n,
          },
        );
        await assert.rejects(
          () =>
            runtime.query(
              "UPDATE tholi.credit_grants SET amount = 1 WHERE workspace_id = $1",
              [scope.workspaceId],
            ),
          { code: "42501" },
        );
        await assert.rejects(
          () =>
            runtime.query(
              "DELETE FROM tholi.credit_settlements WHERE workspace_id = $1",
              [scope.workspaceId],
            ),
          { code: "42501" },
        );
        const uncertainRequest = await repositories.transaction(
          scope,
          (scoped) =>
            scoped.beginRequest({
              operation: "navigation",
              idempotencyKey: "uncertain-outcome",
              payloadHash: "f".repeat(64),
            }),
        );
        const uncertain = await repositories.transaction(
          scope,
          async (scoped) => {
            const reservation = await scoped.reserveCredits({
              requestId: uncertainRequest.request.id,
              amount: 30n,
              expiresAt,
            });
            return scoped.markReservationUncertain(reservation.id);
          },
        );
        assert.equal(uncertain.status, "uncertain");
        assert.deepEqual(
          await repositories.transaction(scope, (scoped) =>
            scoped.creditBalance(),
          ),
          {
            granted: 100n,
            spent: 50n,
            reserved: 30n,
            available: 20n,
            expired: 0n,
            refunded: 0n,
          },
        );
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.releaseCredits(uncertain.id),
            ),
          { code: "CONFLICT" },
        );
        const reconciled = await Promise.all(
          Array.from({ length: 2 }, () =>
            repositories.transaction(scope, (scoped) =>
              scoped.settleCredits({
                reservationId: uncertain.id,
                amount: 20n,
              }),
            ),
          ),
        );
        assert.equal(reconciled[0].id, reconciled[1].id);
        assert.deepEqual(
          await repositories.transaction(scope, (scoped) =>
            scoped.creditBalance(),
          ),
          {
            granted: 100n,
            spent: 70n,
            reserved: 0n,
            available: 30n,
            expired: 0n,
            refunded: 0n,
          },
        );
        const exactScope = await provision();
        const exactAmount = 9007199254740993n;
        await repositories.transaction(exactScope, (scoped) =>
          scoped.grantCredits({
            idempotencyKey: "beyond-number-precision",
            amount: exactAmount,
          }),
        );
        assert.equal(
          (
            await repositories.transaction(exactScope, (scoped) =>
              scoped.creditBalance(),
            )
          ).available,
          exactAmount,
        );
        const mutableScope = await provision();
        const mutableRequest = await repositories.transaction(
          mutableScope,
          async (scoped) => {
            await scoped.grantCredits({
              idempotencyKey: "mutation-fixture",
              amount: 1n,
            });
            return (
              await scoped.beginRequest({
                operation: "navigation",
                idempotencyKey: "mutated-reservation",
                payloadHash: "a".repeat(64),
              })
            ).request;
          },
        );
        await assert.rejects(
          () =>
            repositories.transaction(mutableScope, async (scoped) => {
              const command = {
                requestId: mutableRequest.id,
                amount: 100n,
                expiresAt: future(),
              };
              const pending = scoped.reserveCredits(command);
              command.amount = 1n;
              return pending;
            }),
          { code: "INSUFFICIENT_CREDITS" },
        );
        assert.deepEqual(
          await repositories.transaction(mutableScope, (scoped) =>
            scoped.creditBalance(),
          ),
          {
            granted: 1n,
            spent: 0n,
            reserved: 0n,
            available: 1n,
            expired: 0n,
            refunded: 0n,
          },
        );
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.credit_reservations WHERE workspace_id = $1",
              [mutableScope.workspaceId],
            )
          ).rows[0].count,
          0,
        );
      },
    );

    await record(
      "saved data, request, job and outbox share one atomic transaction",
      async () => {
        const scope = await provision();
        const ids = {
          artifact: randomUUID(),
          request: randomUUID(),
          job: randomUUID(),
          outbox: randomUUID(),
        };
        const deliberate = new Error("Intentional domain and outbox rollback.");
        await assert.rejects(
          () =>
            repositories.transaction(scope, async (scoped) => {
              await scoped.saveArtifact({
                id: ids.artifact,
                expectedRevision: 0n,
                content: savedRoute(),
                userApproved: true,
              });
              await scoped.beginRequest({
                id: ids.request,
                operation: "navigation",
                idempotencyKey: "rollback",
                payloadHash: "f".repeat(64),
              });
              await scoped.enqueueJob({
                id: ids.job,
                requestId: ids.request,
                kind: "sync",
                version: 1,
                idempotencyKey: "rollback",
                recordReferences: {
                  artifactId: ids.artifact,
                  requestId: ids.request,
                },
              });
              await scoped.appendOutbox({
                id: ids.outbox,
                jobId: ids.job,
                eventKind: "job.queued",
                idempotencyKey: "rollback",
              });
              throw deliberate;
            }),
          (error) => error === deliberate,
        );
        const counts = (
          await migration.query(
            `SELECT
            (SELECT count(*)::integer FROM tholi.saved_artifacts WHERE workspace_id = $1) AS artifacts,
            (SELECT count(*)::integer FROM tholi.requests WHERE workspace_id = $1) AS requests,
            (SELECT count(*)::integer FROM tholi.jobs WHERE workspace_id = $1) AS jobs,
            (SELECT count(*)::integer FROM tholi.outbox WHERE workspace_id = $1) AS outbox,
            (SELECT sync_revision::text FROM tholi.workspaces WHERE id = $1) AS revision`,
            [scope.workspaceId],
          )
        ).rows[0];
        assert.deepEqual(counts, {
          artifacts: 0,
          requests: 0,
          jobs: 0,
          outbox: 0,
          revision: "0",
        });
      },
    );

    await record(
      "job and outbox keys remain unique under concurrent replay",
      async () => {
        const scope = await provision();
        const availableAt = future();
        const command = {
          kind: "sync",
          version: 1,
          idempotencyKey: "repeated-job",
          availableAt,
        };
        const jobs = await Promise.all(
          Array.from({ length: 4 }, () =>
            repositories.transaction(scope, (scoped) =>
              scoped.enqueueJob(command),
            ),
          ),
        );
        assert.equal(new Set(jobs.map((item) => item.id)).size, 1);
        assert.ok(jobs.every((item) => item.status === "queued"));
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.enqueueJob({ ...command, maxAttempts: 4 }),
            ),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        const outboxCommand = {
          jobId: jobs[0].id,
          eventKind: "job.queued",
          idempotencyKey: "repeated-event",
          availableAt,
        };
        const entries = await Promise.all(
          Array.from({ length: 4 }, () =>
            repositories.transaction(scope, (scoped) =>
              scoped.appendOutbox(outboxCommand),
            ),
          ),
        );
        assert.equal(new Set(entries.map((item) => item.id)).size, 1);
        const otherJob = await repositories.transaction(scope, (scoped) =>
          scoped.enqueueJob({ ...command, idempotencyKey: "other-job" }),
        );
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.appendOutbox({ ...outboxCommand, jobId: otherJob.id }),
            ),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        const stranger = await provision();
        await repositories.transaction(stranger, async (scoped) => {
          assert.equal(await scoped.getJob(jobs[0].id), undefined);
        });
        await assert.rejects(
          () =>
            repositories.transaction(stranger, (scoped) =>
              scoped.appendOutbox({
                ...outboxCommand,
                idempotencyKey: "foreign-job",
              }),
            ),
          { code: "CONFLICT" },
        );
        const counts = (
          await migration.query(
            `SELECT
            (SELECT count(*)::integer FROM tholi.jobs WHERE workspace_id = $1) AS jobs,
            (SELECT count(*)::integer FROM tholi.outbox WHERE workspace_id = $1) AS outbox`,
            [scope.workspaceId],
          )
        ).rows[0];
        assert.deepEqual(counts, { jobs: 2, outbox: 1 });

        const artifact = await repositories.transaction(scope, (scoped) =>
          scoped.saveArtifact({
            expectedRevision: 0n,
            content: savedRoute(),
            userApproved: true,
          }),
        );
        const [mutated] = await Promise.allSettled([
          repositories.transaction(scope, async (scoped) => {
            const references: Record<string, string> = {
              artifactId: artifact.id,
            };
            const pending = scoped.enqueueJob({
              ...command,
              idempotencyKey: "caller-mutated-references",
              recordReferences: references,
            });
            references.artifactId = randomUUID();
            references.rawObservation =
              "Synthetic private page text must never be persisted.";
            return pending;
          }),
        ]);
        const stored = (
          await migration.query(
            `SELECT record_references FROM tholi.jobs
           WHERE workspace_id = $1 AND idempotency_key = 'caller-mutated-references'`,
            [scope.workspaceId],
          )
        ).rows;
        if (mutated.status === "fulfilled") {
          assert.deepEqual(mutated.value.recordReferences, {
            artifactId: artifact.id,
          });
          assert.deepEqual(stored, [
            { record_references: { artifactId: artifact.id } },
          ]);
        } else {
          assert.ok(
            ["INVALID_INPUT", "CONFLICT"].includes(mutated.reason.code),
          );
          assert.deepEqual(stored, []);
        }
      },
    );

    await record(
      "scoped repositories cannot outlive commit or rollback on a reused connection",
      async () => {
        const first = await provision();
        const second = await provision();
        const singleConnection = new PostgresRepositories(reused);
        const committed = await singleConnection.transaction(
          first,
          async (scoped) => scoped,
        );
        await assert.rejects(() => committed.getAccount(), {
          code: "CONFLICT",
        });
        await assert.rejects(
          () =>
            committed.beginRequest({
              operation: "navigation",
              idempotencyKey: "after-commit",
              payloadHash: "a".repeat(64),
            }),
          { code: "CONFLICT" },
        );
        let rolledBack: typeof committed | undefined;
        const deliberate = new Error(
          "Intentional captured repository rollback.",
        );
        await assert.rejects(
          () =>
            singleConnection.transaction(first, async (scoped) => {
              rolledBack = scoped;
              throw deliberate;
            }),
          (error) => error === deliberate,
        );
        assert.ok(rolledBack);
        await assert.rejects(() => rolledBack!.getAccount(), {
          code: "CONFLICT",
        });
        await singleConnection.transaction(second, async (scoped) => {
          await assert.rejects(() => committed.getAccount(), {
            code: "CONFLICT",
          });
          await assert.rejects(
            () =>
              rolledBack!.beginRequest({
                operation: "navigation",
                idempotencyKey: "after-rollback",
                payloadHash: "b".repeat(64),
              }),
            { code: "CONFLICT" },
          );
          assert.equal((await scoped.getAccount()).id, second.accountId);
          await scoped.beginRequest({
            operation: "navigation",
            idempotencyKey: "current-scope",
            payloadHash: "c".repeat(64),
          });
        });
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.requests WHERE workspace_id = $1",
              [first.workspaceId],
            )
          ).rows[0].count,
          0,
        );
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.requests WHERE workspace_id = $1",
              [second.workspaceId],
            )
          ).rows[0].count,
          1,
        );
      },
    );

    await record(
      "explicit application transactions roll back on failure",
      async () => {
        const accountId = randomUUID();
        const deliberate = new Error("Intentional transaction rollback.");
        await assert.rejects(
          () =>
            withTransaction(runtime, async (client) => {
              await client.query(
                "SELECT tholi.provision_personal_account($1,$2)",
                [accountId, randomUUID()],
              );
              throw deliberate;
            }),
          (error) => error === deliberate,
        );
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.accounts WHERE id = $1",
              [accountId],
            )
          ).rows[0].count,
          0,
        );
      },
    );

    await record(
      "transaction-local scope cannot leak across reused connections",
      async () => {
        const first = { accountId: randomUUID(), workspaceId: randomUUID() };
        const second = { accountId: randomUUID(), workspaceId: randomUUID() };
        const readScope = async () =>
          (
            await reused.query(`
        SELECT current_setting('tholi.account_id', true) AS account,
          current_setting('tholi.workspace_id', true) AS workspace
      `)
          ).rows[0];
        const assertCleared = async () => {
          const scope = await readScope();
          assert.ok(scope.account === null || scope.account === "");
          assert.ok(scope.workspace === null || scope.workspace === "");
        };
        await withTransaction(
          reused,
          async (client) => {
            const row = (
              await client.query(`
          SELECT current_setting('tholi.account_id', true) AS account,
            current_setting('tholi.workspace_id', true) AS workspace
        `)
            ).rows[0];
            assert.deepEqual(row, {
              account: first.accountId,
              workspace: first.workspaceId,
            });
          },
          first,
        );
        await assertCleared();
        const deliberate = new Error(
          "Intentional scoped transaction rollback.",
        );
        await assert.rejects(
          () =>
            withTransaction(
              reused,
              async (client) => {
                const row = (
                  await client.query(`
          SELECT current_setting('tholi.account_id', true) AS account,
            current_setting('tholi.workspace_id', true) AS workspace
        `)
                ).rows[0];
                assert.deepEqual(row, {
                  account: second.accountId,
                  workspace: second.workspaceId,
                });
                throw deliberate;
              },
              second,
            ),
          (error) => error === deliberate,
        );
        await assertCleared();
      },
    );

    await runQuotaChecks(runtime, migration, record, worker);
    await runPlanChecks(runtime, migration, record, worker);
    await runSavedDataChecks(runtime, migration, record, worker);
    await runIdentityChecks(runtime, migration, record);
    await runAuthorizationChecks(runtime, migration, record);
    if (worker) {
      await runJobChecks(runtime, migration, worker, record);
      await runSupportChecks(runtime, migration, worker, record);
    }
    await runObservabilityChecks(
      runtime,
      migration,
      worker,
      options.runtimeConnection,
      record,
    );
    return { passed: true as const, checks };
  } finally {
    const cleanup = await Promise.allSettled([
      migration.end(),
      runtime.end(),
      reused.end(),
      worker?.end(),
    ]);
    if (cleanup.some((result) => result.status === "rejected"))
      throw new Error("PostgreSQL connection cleanup failed.");
  }
}
