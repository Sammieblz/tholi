import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import type {
  RepositoryScope,
  SavedArtifact,
} from "../../../apps/api/src/database/contracts";
import {
  FREE_DEVELOPMENT_PROGRAM,
  productCatalogSchema,
  type PlanCaps,
} from "../../../packages/navigation-core/contracts-plans";
import {
  beginJourney,
  saveTask,
} from "../../../packages/goal-planner/task-journey";
import { inferenceFixture } from "./inference-fixture";

/** Product plans share the existing database harness, scoped ports and ledger. */
export async function runPlanChecks(
  runtime: Pool,
  migration: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
  worker?: Pool,
) {
  const repositories = new PostgresRepositories(runtime);
  const catalog = productCatalogSchema.parse(
    await repositories.readPlanCatalog(),
  );
  const free = catalog.plans.find((plan) => plan.mode === "free-cloud");
  assert.ok(free?.developmentAllowance);
  const allowance = free.developmentAllowance;
  const { reserveDecision, dispatch, finish } = inferenceFixture(repositories);
  const enroll = (scope: RepositoryScope) =>
    repositories.transaction(scope, (scoped) => scoped.enrollFree());
  const effective = (scope: RepositoryScope) =>
    repositories.transaction(scope, (scoped) => scoped.readEffectivePlan());
  const balance = (scope: RepositoryScope) =>
    repositories.transaction(scope, (scoped) => scoped.creditBalance());
  let nextVersion = free.version;
  const selectFree = async (
    caps: Partial<PlanCaps> = {},
    programId = allowance.programId,
  ) => {
    const catalogVersion = `pg-catalog-${randomUUID()}`;
    const selected = {
      ...free,
      version: ++nextVersion,
      developmentAllowance: {
        ...allowance,
        programId,
        caps: { ...allowance.caps, ...caps },
      },
    };
    productCatalogSchema.parse({
      ...catalog,
      catalogVersion,
      plans: catalog.plans.map((plan) =>
        plan.id === free.id ? selected : plan,
      ),
    });
    await migration.query(
      "INSERT INTO tholi.plan_versions(plan_id,version,name,definition) VALUES($1,$2,$3,$4::jsonb)",
      [selected.id, selected.version, selected.name, JSON.stringify(selected)],
    );
    await migration.query(
      "INSERT INTO tholi.product_catalog_releases(version,charging_policy_version) VALUES($1,$2)",
      [catalogVersion, catalog.chargingPolicyVersion],
    );
    await migration.query(
      `INSERT INTO tholi.product_catalog_entries(catalog_version,plan_id,plan_version,position)
       SELECT $1,plan_id,CASE WHEN plan_id=$2 THEN $3 ELSE plan_version END,position
       FROM tholi.product_catalog_entries WHERE catalog_version=$4`,
      [catalogVersion, selected.id, selected.version, catalog.catalogVersion],
    );
    await migration.query(
      "UPDATE tholi.product_catalog_control SET current_version=$1 WHERE singleton",
      [catalogVersion],
    );
    return selected;
  };
  const organization = async (accountId: string): Promise<RepositoryScope> => {
    const workspaceId = randomUUID();
    await migration.query(
      "INSERT INTO tholi.workspaces(id,kind,owner_account_id) VALUES($1,'organization',$2)",
      [workspaceId, accountId],
    );
    await migration.query(
      "INSERT INTO tholi.memberships(workspace_id,account_id,role) VALUES($1,$2,'owner')",
      [workspaceId, accountId],
    );
    return { accountId, workspaceId };
  };
  const oneSaved = (results: PromiseSettledResult<SavedArtifact>[]) => {
    const accepted = results.filter((result) => result.status === "fulfilled");
    const denied = results.filter((result) => result.status === "rejected");
    assert.equal(accepted.length, 1);
    assert.equal(denied.length, 1);
    assert.equal(denied[0].reason.code, "QUOTA_EXCEEDED");
    return accepted[0].value;
  };
  const route = saveTask(beginJourney("Open Help", "https://example.test"));
  const save = (
    scope: RepositoryScope,
    content = route,
    previous?: SavedArtifact,
  ) =>
    repositories.transaction(scope, (scoped) =>
      scoped.saveArtifact({
        ...(previous ? { id: previous.id } : {}),
        expectedRevision: previous?.revision ?? 0n,
        content,
        userApproved: true,
      }),
    );
  const end = (scope: RepositoryScope) =>
    migration.query(
      `UPDATE tholi.entitlements SET status='ended',revision=revision+1
     WHERE workspace_id=$1 AND id=(SELECT entitlement_id FROM tholi.free_program_enrollments WHERE account_id=$2)`,
      [scope.workspaceId, scope.accountId],
    );

  await record(
    "the canonical catalog replays without publishing unavailable paid allowances or prices",
    async () => {
      assert.deepEqual(await repositories.readPlanCatalog(), catalog);
      const local = catalog.plans.find((plan) => plan.mode === "local");
      assert.equal(local?.requiresAccount, false);
      assert.equal(local?.availability.available, true);
      assert.equal(local?.developmentAllowance, null);
      assert.equal(allowance.programId, FREE_DEVELOPMENT_PROGRAM);
      for (const plan of catalog.plans.filter(
        (entry) => entry.mode === "paid",
      )) {
        assert.equal(plan.availability.available, false);
        assert.deepEqual(plan.pricing, { status: "unpublished", amount: null });
        assert.equal(plan.productionAllowance, null);
        assert.equal(plan.developmentAllowance, null);
      }
      for (const statement of [
        "UPDATE tholi.product_catalog_control SET current_version='forged' WHERE singleton",
        "DELETE FROM tholi.product_catalog_entries",
        "DELETE FROM tholi.product_catalog_releases",
      ])
        await assert.rejects(() => runtime.query(statement), { code: "42501" });
      await assert.rejects(
        () =>
          migration.query(
            "UPDATE tholi.plan_versions SET name='changed' WHERE plan_id=$1 AND version=$2",
            [free.id, free.version],
          ),
        { code: "23514" },
      );
      await assert.rejects(
        () =>
          migration.query(
            "UPDATE tholi.product_catalog_releases SET charging_policy_version=charging_policy_version WHERE version=$1",
            [catalog.catalogVersion],
          ),
        { code: "23514" },
      );
      await assert.rejects(
        () =>
          migration.query(
            "UPDATE tholi.product_catalog_entries SET position=position WHERE catalog_version=$1",
            [catalog.catalogVersion],
          ),
        { code: "23514" },
      );
      assert.deepEqual(await repositories.readPlanCatalog(), catalog);
    },
  );

  await record(
    "concurrent personal Free enrollment creates one entitlement and one existing-ledger grant",
    async () => {
      const scope = await repositories.provisionAccount();
      assert.equal(
        await repositories.transaction(scope, (scoped) =>
          scoped.readEffectivePlan(),
        ),
        null,
      );
      const enrolled = await Promise.all(
        Array.from({ length: 3 }, () =>
          new PostgresRepositories(runtime).transaction(scope, (scoped) =>
            scoped.enrollFree(),
          ),
        ),
      );
      assert.equal(new Set(enrolled.map((entry) => entry.grant.id)).size, 1);
      assert.equal(enrolled.filter((entry) => !entry.replayed).length, 1);
      assert.equal(enrolled[0].effective.planId, free.id);
      assert.equal(enrolled[0].effective.planVersion, free.version);
      assert.equal(enrolled[0].effective.status, "active");
      assert.equal(enrolled[0].grant.amount, allowance.amount);
      assert.equal(
        (
          await repositories.transaction(scope, (scoped) =>
            scoped.creditBalance(),
          )
        ).available,
        BigInt(allowance.amount),
      );
      const history = await repositories.transaction(scope, (scoped) =>
        scoped.listCreditHistory(),
      );
      assert.equal(history.items.length, 1);
      assert.equal(history.items[0].kind, "grant");
      assert.equal(history.items[0].source, "free");
      assert.equal(
        (
          await repositories.transaction(scope, (scoped) =>
            scoped.listEntitlements(),
          )
        ).length,
        1,
      );
      assert.equal(
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM tholi.credit_grants WHERE workspace_id=$1",
            [scope.workspaceId],
          )
        ).rows[0].count,
        1,
      );
    },
  );

  try {
    await record(
      "Free refill expires unused credits and cannot reset through catalog program or workspace replay",
      async () => {
        const scope = await repositories.provisionAccount();
        const first = await enroll(scope);
        const previousStart = new Date(
          Date.parse(first.effective.periodStart) -
            allowance.periodSeconds * 1000,
        );
        const previousEnd = new Date(first.effective.periodStart);
        await migration.query(
          `UPDATE tholi.free_program_grants SET period_start=$1,period_end=$2
           WHERE account_id=$3 AND grant_id=$4`,
          [previousStart, previousEnd, scope.accountId, first.grant.id],
        );
        await migration.query(
          `UPDATE tholi.credit_grants SET created_at=$1,expires_at=$2,
             period_start=$1,period_end=$2,idempotency_key=$3
           WHERE workspace_id=$4 AND id=$5`,
          [
            previousStart,
            previousEnd,
            `historical-free-${randomUUID()}`,
            scope.workspaceId,
            first.grant.id,
          ],
        );
        await migration.query(
          `UPDATE tholi.entitlements SET starts_at=$1,ends_at=$2
           WHERE workspace_id=$3 AND id=(SELECT entitlement_id FROM tholi.free_program_enrollments WHERE account_id=$4)`,
          [previousStart, previousEnd, scope.workspaceId, scope.accountId],
        );
        assert.equal((await effective(scope))?.status, "inactive");
        assert.equal((await balance(scope)).available, 0n);
        await assert.rejects(
          () => repositories.refillFreePlans({ limit: 100 }),
          { code: "FORBIDDEN" },
        );
        const refiller = new PostgresRepositories(worker ?? migration);
        const refilled = await Promise.all([
          refiller.refillFreePlans({ limit: 100 }),
          refiller.refillFreePlans({ limit: 100 }),
        ]);
        assert.equal(
          refilled.reduce((sum, count) => sum + count, 0),
          1,
        );
        const current = await enroll(scope);
        assert.equal(current.replayed, true);
        assert.notEqual(current.grant.id, first.grant.id);
        assert.equal(
          (await balance(scope)).available,
          BigInt(allowance.amount),
        );
        assert.equal((await balance(scope)).expired, BigInt(allowance.amount));
        await selectFree({ maxInputTokens: 1024 });
        const republished = await enroll(scope);
        assert.equal(republished.grant.id, current.grant.id);
        assert.equal(republished.replayed, true);
        const otherWorkspace = await organization(scope.accountId);
        await assert.rejects(() => enroll(otherWorkspace), {
          code: "FORBIDDEN",
        });
        const otherProgram = `pg-free-${randomUUID()}`;
        await migration.query(
          "INSERT INTO tholi.free_programs(id,period_seconds) VALUES($1,$2)",
          [otherProgram, allowance.periodSeconds],
        );
        await selectFree({}, otherProgram);
        await assert.rejects(() => enroll(scope), { code: "CONFLICT" });
        assert.equal(
          (await balance(scope)).granted,
          BigInt(allowance.amount) * 2n,
        );
        assert.equal(
          (
            await repositories.transaction(scope, (scoped) =>
              scoped.listCreditHistory(),
            )
          ).items.length,
          2,
        );
      },
    );

    await record(
      "plan admission counts released attempts and rechecks expiry or downgrade without rewriting prior holds",
      async () => {
        await migration.query(
          "UPDATE tholi.inference_control SET enabled=true,revision=revision+1 WHERE singleton",
        );
        for (const caps of [
          { requestsPerPeriod: 1, requestsPerMinute: 100 },
          { requestsPerPeriod: 6, requestsPerMinute: 1 },
        ]) {
          await selectFree(caps);
          const scope = await repositories.provisionAccount();
          await enroll(scope);
          const held = await reserveDecision(
            scope,
            catalog.chargingPolicyVersion,
          );
          await finish(held, { resolution: "not-sent", outcome: "cancelled" });
          await assert.rejects(
            () => reserveDecision(scope, catalog.chargingPolicyVersion),
            { code: "QUOTA_EXCEEDED" },
          );
          assert.equal(
            (await balance(scope)).available,
            BigInt(allowance.amount),
          );
        }
        await selectFree({ maxInputTokens: 1024 });
        const scope = await repositories.provisionAccount();
        await enroll(scope);
        const expiring = await reserveDecision(
          scope,
          catalog.chargingPolicyVersion,
        );
        assert.equal(expiring.effectivePlan?.caps?.maxInputTokens, 1024);
        await migration.query(
          `UPDATE tholi.entitlements SET ends_at=clock_timestamp()-interval '1 second'
           WHERE workspace_id=$1 AND id=(SELECT entitlement_id FROM tholi.free_program_enrollments WHERE account_id=$2)`,
          [scope.workspaceId, scope.accountId],
        );
        assert.equal((await effective(scope))?.status, "inactive");
        await assert.rejects(() => dispatch(scope, expiring), {
          code: "QUOTA_EXCEEDED",
        });
        await finish(expiring, {
          resolution: "not-sent",
          outcome: "cancelled",
        });
        await enroll(scope);
        const beforeDowngrade = await reserveDecision(
          scope,
          catalog.chargingPolicyVersion,
        );
        await selectFree({ maxInputTokens: 512 });
        await assert.rejects(() => dispatch(scope, beforeDowngrade), {
          code: "QUOTA_EXCEEDED",
        });
        assert.equal(beforeDowngrade.effectivePlan?.caps?.maxInputTokens, 1024);
        await finish(beforeDowngrade, {
          resolution: "not-sent",
          outcome: "cancelled",
        });
        const dispatchedScope = await repositories.provisionAccount();
        await enroll(dispatchedScope);
        const dispatched = await reserveDecision(
          dispatchedScope,
          catalog.chargingPolicyVersion,
        );
        await dispatch(dispatchedScope, dispatched);
        await end(dispatchedScope);
        await finish(dispatched, {
          resolution: "reported",
          outcome: "completed",
          inputUnits: 0n,
          outputUnits: 0n,
          providerUsdMicros: 0n,
          chargedCredits: 1n,
        });
        assert.equal((await effective(dispatchedScope))?.status, "inactive");
        await assert.rejects(
          () => reserveDecision(dispatchedScope, catalog.chargingPolicyVersion),
          { code: "QUOTA_EXCEEDED" },
        );
        assert.equal((await balance(dispatchedScope)).spent, 1n);
        assert.equal(dispatched.maxCredits, 1n);
      },
    );

    await record(
      "saved artifact count and actual byte races preserve shrink delete and read access after downgrade",
      async () => {
        await selectFree({ maxSavedArtifacts: 1 });
        const countScope = await repositories.provisionAccount();
        await enroll(countScope);
        const counted = oneSaved(
          await Promise.allSettled([save(countScope), save(countScope)]),
        );
        await repositories.transaction(countScope, (scoped) =>
          scoped.tombstoneArtifact(counted.id, counted.revision),
        );
        await save(countScope);
        const byteScope = await repositories.provisionAccount();
        const probe = await save(byteScope);
        const bytes = Number(
          (
            await migration.query(
              "SELECT octet_length(content::text) AS bytes FROM tholi.saved_artifacts WHERE workspace_id=$1 AND id=$2",
              [byteScope.workspaceId, probe.id],
            )
          ).rows[0].bytes,
        );
        await repositories.transaction(byteScope, (scoped) =>
          scoped.tombstoneArtifact(probe.id, probe.revision),
        );
        await selectFree({
          maxSavedArtifacts: 10,
          maxSavedArtifactBytes: String(bytes * 4),
          maxStoredBytes: String(bytes + 1),
        });
        await enroll(byteScope);
        const stored = oneSaved(
          await Promise.allSettled([save(byteScope), save(byteScope)]),
        );
        assert.equal(
          (
            await migration.query(
              "SELECT sum(octet_length(content::text))::text AS bytes FROM tholi.saved_artifacts WHERE owner_account_id=$1 AND deleted_at IS NULL",
              [byteScope.accountId],
            )
          ).rows[0].bytes,
          String(bytes),
        );
        const grown = {
          ...route,
          planned: [
            { label: "Help ".repeat(30), evidence: "documented" as const },
          ],
        };
        await assert.rejects(() => save(byteScope, grown, stored), {
          code: "QUOTA_EXCEEDED",
        });
        await selectFree({
          maxSavedArtifacts: 10,
          maxSavedArtifactBytes: String(bytes - 1),
          maxStoredBytes: String(bytes * 4),
        });
        await enroll(byteScope);
        await assert.rejects(() => save(byteScope), { code: "QUOTA_EXCEEDED" });
        await end(byteScope);
        assert.deepEqual(
          await repositories.transaction(byteScope, (scoped) =>
            scoped.getArtifact(stored.id),
          ),
          stored,
        );
        await assert.rejects(() => save(byteScope, grown, stored), {
          code: "QUOTA_EXCEEDED",
        });
        const smaller = {
          ...route,
          goal: "Help",
          canonicalGoal: undefined,
          objective: { purpose: "Help" },
        };
        const shrunk = await save(byteScope, smaller, stored);
        assert.equal(shrunk.revision, stored.revision + 1n);
        const tombstone = await repositories.transaction(byteScope, (scoped) =>
          scoped.tombstoneArtifact(shrunk.id, shrunk.revision),
        );
        assert.equal(tombstone.content, null);
        assert.equal(
          (
            await repositories.transaction(byteScope, (scoped) =>
              scoped.listArtifacts({ includeDeleted: false }),
            )
          ).items.length,
          0,
        );
        assert.equal(
          (
            await repositories.transaction(byteScope, (scoped) =>
              scoped.getArtifact(shrunk.id),
            )
          )?.content,
          null,
        );
        await assert.rejects(() => save(byteScope, smaller), {
          code: "QUOTA_EXCEEDED",
        });
        assert.equal((await enroll(byteScope)).replayed, true);
        await save(byteScope, smaller);
        assert.equal(
          (
            await repositories.transaction(byteScope, (scoped) =>
              scoped.listArtifacts({ includeDeleted: false }),
            )
          ).items.length,
          1,
        );
      },
    );

    await record(
      "runtime-forged program grants catalog selection and foreign scopes cannot acquire plan benefits",
      async () => {
        await selectFree();
        const scope = await repositories.provisionAccount();
        const other = await repositories.provisionAccount();
        await enroll(other);
        for (const table of [
          "free_programs",
          "free_program_enrollments",
          "free_program_grants",
        ]) {
          await assert.rejects(
            () => runtime.query(`DELETE FROM tholi.${table}`),
            { code: "42501" },
          );
          await assert.rejects(
            () => runtime.query(`INSERT INTO tholi.${table} DEFAULT VALUES`),
            { code: "42501" },
          );
        }
        let entered = false;
        await assert.rejects(
          () =>
            repositories.transaction(
              { accountId: scope.accountId, workspaceId: other.workspaceId },
              async (scoped) => {
                entered = true;
                return scoped.enrollFree();
              },
            ),
          { code: "FORBIDDEN" },
        );
        assert.equal(entered, false);
        assert.equal(await effective(scope), null);
        assert.equal((await balance(scope)).available, 0n);
        assert.equal(
          (await balance(other)).available,
          BigInt(allowance.amount),
        );
        const visible = await repositories.transaction(scope, (scoped) =>
          scoped.listEntitlements(),
        );
        assert.deepEqual(visible, []);
        const publicCatalog = await repositories.readPlanCatalog();
        for (const paid of publicCatalog.plans.filter(
          (plan) => plan.mode === "paid",
        )) {
          assert.equal(paid.availability.available, false);
          assert.deepEqual(paid.pricing, {
            status: "unpublished",
            amount: null,
          });
        }
      },
    );
  } finally {
    await migration.query(
      "UPDATE tholi.product_catalog_control SET current_version=$1 WHERE singleton",
      [catalog.catalogVersion],
    );
    await migration.query(
      "UPDATE tholi.inference_control SET enabled=false,revision=revision+1 WHERE singleton",
    );
  }
}
