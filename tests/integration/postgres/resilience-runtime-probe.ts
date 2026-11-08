import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createDatabasePool } from "../../../apps/api/src/database/postgres";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { PostgresJobs } from "../../../apps/api/src/database/jobs";
import { REGISTERED_JOB_KINDS } from "../../../apps/api/src/application/identity-maintenance";
import { createRuntimeActor } from "./runtime-actor";
import { planFixture, expireFreePeriod } from "./plan-fixture";
import { savedDataArtifactFixture } from "../../support/saved-data-fixture";
import {
  savedDataRecordSchema,
  savedDataExportResultSchema,
} from "../../../packages/navigation-core/contracts-saved-data";
import {
  decisionInput,
  eventually,
  replicaClient,
  resiliencePhase,
} from "./resilience-fixture";
import { runResilienceModelChecks } from "./resilience-model-probe";

/** Multi-process fixture against exactly two unprivileged API/worker containers and one real PG. */
export async function runResilienceRuntimeProbe(options: {
  migrationConnection: string;
  runtimeConnection: string;
  origins: string[];
}) {
  assert.equal(options.origins.length, 2);
  for (const origin of options.origins)
    assert.match(
      origin,
      /^http:\/\/tholi-smoke-[a-z0-9]+-[a-f0-9]{8}-api-[12]:8788$/,
    );
  const migration = createDatabasePool({
    connectionString: options.migrationConnection,
    max: 2,
  });
  const repositories = new PostgresRepositories(migration),
    jobs = new PostgresJobs(migration),
    client = replicaClient(options.origins);
  const checks: string[] = [];
  let stage = "initialization";
  const record = (name: string) => {
    checks.push(name);
    process.stdout.write(JSON.stringify({ check: name }) + "\n");
  };
  const plans = await planFixture(migration, migration);
  const metrics: Record<string, unknown> = {};
  try {
    await plans.selectFree({ maxSavedArtifacts: 1, requestsPerPeriod: 1 });
    const actor = await createRuntimeActor(migration),
      stranger = await createRuntimeActor(migration);
    stage = "parallel-free-enrollment";
    const enrolled = await Promise.all([
      client.enroll(0, actor),
      client.enroll(1, actor),
    ]);
    assert.equal(enrolled[0].grant.id, enrolled[1].grant.id);
    assert.equal(enrolled.filter((v) => !v.replayed).length, 1);
    await client.enroll(1, stranger);
    const count = async (sql: string, values: unknown[] = []) =>
      Number((await migration.query(sql, values)).rows[0].count);
    assert.equal(
      await count(
        "SELECT count(*) AS count FROM tholi.credit_grants WHERE workspace_id=$1",
        [actor.account.workspaceId],
      ),
      1,
    );
    await client.consent(0, actor, ["cloud_saved_routes", "cloud_inference"]);
    await client.consent(1, stranger, ["cloud_inference"]);
    record("one-free-grant-across-replicas");
    stage = "load-and-saturation";
    const measure = async (total: number, concurrency: number) => {
      const started = performance.now(),
        latencies: number[] = [],
        statuses: Record<string, number> = {};
      let index = 0;
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          while (index++ < total) {
            const sequence = index,
              begin = performance.now();
            const response = await client.send(
              sequence % 2,
              "/api/v1/account/profile",
              actor,
            );
            statuses[response.status] = (statuses[response.status] ?? 0) + 1;
            assert.ok([200, 429, 503].includes(response.status));
            if (response.status === 200) {
              const body = (await response.json()) as { accountId: string };
              assert.equal(body.accountId, actor.account.accountId);
              latencies.push(performance.now() - begin);
            } else await response.body?.cancel();
          }
        }),
      );
      const seconds = (performance.now() - started) / 1000;
      latencies.sort((a, b) => a - b);
      return {
        attempts: total,
        concurrency,
        statuses,
        seconds,
        successfulRequestsPerSecond: latencies.length / seconds,
        p50Ms: latencies[Math.floor((latencies.length - 1) * 0.5)] ?? null,
        p95Ms: latencies[Math.floor((latencies.length - 1) * 0.95)] ?? null,
      };
    };
    metrics.steady = await measure(64, 4);
    metrics.saturation = await measure(64, 64);
    const connections = (
      await migration.query(`SELECT r.rolname,r.rolconnlimit AS limit,
      (SELECT count(*)::integer FROM pg_stat_activity a WHERE a.usename=r.rolname) AS open
      FROM pg_roles r WHERE r.rolname IN('tholi_runtime','tholi_worker','tholi_migrator') ORDER BY r.rolname`)
    ).rows;
    for (const row of connections) assert.ok(row.open <= row.limit);
    assert.equal(
      connections.find((row) => row.rolname === "tholi_runtime")?.limit,
      8,
    );
    assert.equal(
      connections.find((row) => row.rolname === "tholi_worker")?.limit,
      4,
    );
    metrics.databaseConnections = connections;
    const recoveryStart = performance.now();
    await client.request(1, "/api/v1/account/profile", stranger);
    metrics.recoveryMs = performance.now() - recoveryStart;
    record("measured-bounded-load-and-recovery");
    stage = "saved-data-races";
    const artifacts = `/api/v1/workspaces/${actor.account.workspaceId}/artifacts`;
    const artifact = savedDataArtifactFixture();
    const mutation = (expectedRevision = "0") => ({
      idempotencyKey: randomUUID(),
      expectedRevision,
      approved: true,
      artifact,
    });
    const saved = savedDataRecordSchema.parse(
      await client.json(0, artifacts, actor, "POST", mutation()),
    );
    const exhausted = await client.json<{ error: { code: string } }>(
      1,
      artifacts,
      actor,
      "POST",
      { ...mutation(), artifact: savedDataArtifactFixture() },
      429,
    );
    assert.equal(exhausted.error.code, "QUOTA_EXCEEDED");
    await client.request(1, artifacts + "/" + saved.id, actor);
    await client.request(
      1,
      artifacts + "/" + saved.id,
      stranger,
      "GET",
      undefined,
      403,
    );
    const updates = await Promise.all(
      [0, 1].map(async (replica) => {
        const response = await client.send(
          replica,
          artifacts + "/" + saved.id,
          actor,
          "PATCH",
          mutation(saved.revision),
        );
        const value = await response.json();
        return { status: response.status, value };
      }),
    );
    assert.deepEqual(updates.map((v) => v.status).sort(), [200, 409]);
    const current = savedDataRecordSchema.parse(
      updates.find((v) => v.status === 200)!.value,
    );
    stage = "exhausted-export-submit";
    const exported = savedDataExportResultSchema.parse(
      await client.json(1, artifacts + "/export", actor, "POST", {
        idempotencyKey: randomUUID(),
        ids: [saved.id],
      }),
    );
    stage = "export-worker";
    await eventually(
      async () =>
        (
          await migration.query("SELECT status FROM tholi.jobs WHERE id=$1", [
            exported.jobId,
          ])
        ).rows[0]?.status === "succeeded",
    );
    stage = "export-cross-replica-file";
    const file = `/api/v1/account/files/${exported.fileId}`;
    const metadata = await client.json<{ revision: string }>(0, file, actor);
    const link = await client.json<{ url: string }>(
      1,
      file + "/link",
      actor,
      "POST",
      { expectedRevision: metadata.revision },
    );
    const target = new URL(link.url);
    await client.request(0, target.pathname + target.search, actor);
    stage = "exhausted-delete";
    await client.request(0, artifacts + "/" + saved.id, actor, "DELETE", {
      idempotencyKey: randomUUID(),
      expectedRevision: current.revision,
      approved: true,
    });
    stage = "deleted-stale-update";
    await client.request(
      1,
      artifacts + "/" + saved.id,
      actor,
      "PATCH",
      mutation(current.revision),
      409,
    );
    stage = "deleted-create";
    await client.request(1, artifacts, actor, "POST", mutation(), 409);
    const tombstone = async (replica: number) => {
      const value = savedDataRecordSchema.parse(
        await client.json(replica, artifacts + "/" + saved.id, actor),
      );
      assert.ok(value.deletedAt);
      assert.equal(value.data, null);
      return value;
    };
    await tombstone(1);
    record("storage-exhaustion-retains-access-export-delete-and-tombstones");
    stage = "concurrent-inference-idempotency";
    await migration.query(
      "UPDATE tholi.inference_control SET enabled=true,revision=revision+1 WHERE singleton",
    );
    const input = decisionInput(),
      decisions = `/api/v1/workspaces/${actor.account.workspaceId}/decisions`;
    const results = await Promise.all(
      [0, 1].map((replica) =>
        client.json<{ replayed: boolean; decision?: unknown }>(
          replica,
          decisions,
          actor,
          "POST",
          input,
        ),
      ),
    );
    assert.equal(results.filter((v) => v.replayed).length, 1);
    assert.equal(results.filter((v) => v.decision !== undefined).length, 1);
    const freeDenied = await client.json<{ error: { code: string } }>(
      1,
      decisions,
      actor,
      "POST",
      decisionInput(),
      429,
    );
    assert.equal(freeDenied.error.code, "QUOTA_EXCEEDED");
    assert.equal(
      await count(
        "SELECT count(*) AS count FROM tholi.credit_settlements WHERE workspace_id=$1",
        [actor.account.workspaceId],
      ),
      1,
    );
    // A global cap of one is below, never above, the existing development allowance.
    await migration.query(
      "UPDATE tholi.inference_control SET global_requests=1,revision=revision+1 WHERE singleton",
    );
    await client.request(
      1,
      `/api/v1/workspaces/${stranger.account.workspaceId}/decisions`,
      stranger,
      "POST",
      decisionInput(),
      429,
    );
    await client.request(0, "/api/v1/account/profile", actor);
    await client.request(1, decisions + "/" + input.requestId, actor);
    await migration.query(
      "UPDATE tholi.inference_control SET global_requests=1000,revision=revision+1 WHERE singleton",
    );
    record("global-admission-and-single-settlement-with-status-only-replay");
    stage = "rolling-api";
    for (const stopped of [0, 1]) {
      await resiliencePhase(`api-${stopped + 1}-stopped`);
      await client.request(1 - stopped, "/api/v1/account/profile", actor);
      await client.request(
        1 - stopped,
        decisions + "/" + input.requestId,
        actor,
      );
      await tombstone(1 - stopped);
      await resiliencePhase(`api-${stopped + 1}-restored`);
    }
    record("rolling-api-retains-identity-status-and-deletion");
    stage = "competing-worker-claims";
    const enqueue = () =>
      repositories.transaction(actor.account, (tx) =>
        tx.enqueueJob({
          ...REGISTERED_JOB_KINDS[0],
          idempotencyKey: randomUUID(),
          recordReferences: { accountId: actor.account.accountId },
        }),
      );
    const ids: string[] = [];
    await resiliencePhase("competition-workers-paused");
    for (let index = 0; index < 8; index++) ids.push((await enqueue()).id);
    const lock = await migration.connect();
    try {
      await lock.query("BEGIN");
      await lock.query("LOCK TABLE tholi.identity_brokers IN SHARE MODE");
      await resiliencePhase("competition-workers-resumed");
      await eventually(
        async () =>
          Number(
            (
              await migration.query(
                "SELECT count(DISTINCT lease_owner) AS count FROM tholi.jobs WHERE kind='identity.prune-expired-brokers' AND version=1 AND status='running'",
              )
            ).rows[0].count,
          ) === 2,
        1500,
      );
    } finally {
      await lock.query("ROLLBACK");
      lock.release();
    }
    const completed = async (jobIds: string[]) =>
      Number(
        (
          await migration.query(
            "SELECT count(*) AS count FROM tholi.jobs WHERE id=ANY($1::uuid[]) AND status='succeeded'",
            [jobIds],
          )
        ).rows[0].count,
      ) === jobIds.length;
    await eventually(() => completed(ids));
    assert.equal(
      await count(
        "SELECT count(*) AS count FROM tholi.outbox WHERE job_id=ANY($1::uuid[]) AND event_kind='job.completed'",
        [ids],
      ),
      ids.length,
    );
    record("two-independent-workers-with-one-completion-per-job");
    stage = "expired-worker-lease";
    await resiliencePhase("workers-paused");
    const abandoned = await enqueue();
    const old = (
      await jobs.claim({
        workerId: "synthetic-lost-worker",
        kinds: REGISTERED_JOB_KINDS,
        limit: 10,
        leaseMs: 1000,
      })
    ).find((v) => v.id === abandoned.id);
    assert.ok(old);
    await migration.query(
      "UPDATE tholi.jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
      [old.id],
    );
    await resiliencePhase("workers-resumed");
    await eventually(() => completed([old.id]));
    assert.equal((await jobs.heartbeat(old, 1000)).alive, false);
    assert.equal(
      await jobs.fail(old, {
        classification: "failed",
        code: "HANDLER_FAILED",
        backoffMs: 0,
      }),
      false,
    );
    assert.equal(
      await jobs.runJob(old, async () => {
        throw new Error("Stale lease executed.");
      }),
      false,
    );
    assert.equal(
      await count(
        "SELECT count(*) AS count FROM tholi.outbox WHERE job_id=$1 AND event_kind='job.completed'",
        [old.id],
      ),
      1,
    );
    record("lost-lease-reclaimed-and-old-capability-fenced");
    stage = "rolling-worker-and-refill";
    for (const stopped of [0, 1]) {
      await resiliencePhase(`worker-${stopped + 1}-stopped`);
      await eventually(() => completedJob());
      await resiliencePhase(`worker-${stopped + 1}-restored`);
    }
    async function completedJob() {
      const job = await enqueue();
      await eventually(() => completed([job.id]));
      return true;
    }
    const before = await count(
      "SELECT count(*) AS count FROM tholi.credit_grants WHERE workspace_id=$1",
      [actor.account.workspaceId],
    );
    await expireFreePeriod(
      migration,
      actor.account,
      enrolled[0],
      plans.allowance.periodSeconds,
    );
    await eventually(
      async () =>
        (await count(
          "SELECT count(*) AS count FROM tholi.credit_grants WHERE workspace_id=$1",
          [actor.account.workspaceId],
        )) ===
        before + 1,
    );
    const refilled = await Promise.all([
      client.enroll(0, actor),
      client.enroll(1, actor),
    ]);
    assert.equal(refilled[0].grant.id, refilled[1].grant.id);
    assert.equal(
      await count(
        "SELECT count(*) AS count FROM tholi.credit_grants WHERE workspace_id=$1",
        [actor.account.workspaceId],
      ),
      before + 1,
    );
    record("rolling-workers-and-one-period-refill");
    stage = "replica-account-deletion";
    const profile = await client.json<{ account: { revision: string } }>(
      1,
      "/api/v1/account",
      actor,
    );
    await client.request(0, "/api/v1/account/deletion", actor, "POST", {
      operationId: randomUUID(),
      expectedRevision: profile.account.revision,
      confirmation: "DELETE",
    });
    await Promise.all(
      [0, 1].map((replica) =>
        client.request(
          replica,
          "/api/v1/account/profile",
          actor,
          "GET",
          undefined,
          401,
        ),
      ),
    );
    await client.request(1, "/api/v1/account/profile", stranger);
    record("deletion-revokes-both-replicas-without-tenant-crossover");
    stage = "dual-http-provider-faults";
    await plans.restore();
    await resiliencePhase("apis-stopped-for-fault-fixture");
    const faults = await runResilienceModelChecks(
      migration,
      options.runtimeConnection,
    );
    await resiliencePhase("apis-restored-after-fault-fixture");
    await client.request(0, "/health/ready");
    await client.request(1, "/health/ready");
    record("dual-http-provider-faults-and-ephemeral-evidence-loss");
    return {
      passed: true,
      checks,
      metrics,
      faults,
      externalModelCalls: 0,
      identity: "controlled SQL actor; not real OIDC",
    };
  } catch (error) {
    process.stdout.write(JSON.stringify({ failedStage: stage }) + "\n");
    if (
      error instanceof Error &&
      error.message.startsWith("PostgreSQL check failed:")
    )
      throw error;
    throw new Error("PostgreSQL check failed: resilience " + stage + ".");
  } finally {
    await plans.restore();
    await migration.end();
  }
}
