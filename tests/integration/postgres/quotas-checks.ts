import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import type {
  InferenceReservation,
  RepositoryScope,
} from "../../../apps/api/src/database/contracts";
import { NAVIGATION_TRANSPORT_OPERATION } from "../../../packages/navigation-core/contracts-navigation";
import { PostgresJobs } from "../../../apps/api/src/database/jobs";
import { withTransaction } from "../../../apps/api/src/database/postgres";
import {
  createInferenceReconciliationHandler,
  INFERENCE_RECONCILIATION_JOB_KIND,
} from "../../../apps/api/src/application/quotas";
import { inferenceFixture } from "./inference-fixture";

/** Durable accounting checks reuse the smoke database and its scoped repositories. */
export async function runQuotaChecks(
  runtime: Pool,
  migration: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
  worker?: Pool,
) {
  const repositories = new PostgresRepositories(runtime);
  const expiresAt = new Date(Date.now() + 60 * 60 * 1000);
  const balance = (scope: RepositoryScope) =>
    repositories.transaction(scope, (scoped) => scoped.creditBalance());
  const expireGrant = (scope: RepositoryScope, id: string) =>
    migration.query(
      `UPDATE tholi.credit_grants
       SET created_at=clock_timestamp()-interval '2 hours',
           expires_at=clock_timestamp()-interval '1 hour'
       WHERE workspace_id=$1 AND id=$2`,
      [scope.workspaceId, id],
    );
  const reserve = (scope: RepositoryScope, key: string, amount: bigint) =>
    repositories.transaction(scope, async (scoped) => {
      const { request } = await scoped.beginRequest({
        operation: "navigation",
        idempotencyKey: key,
        payloadHash: "a".repeat(64),
      });
      return scoped.reserveCredits({
        requestId: request.id,
        amount,
        expiresAt,
      });
    });
  const fund = (scope: RepositoryScope) =>
    repositories.transaction(scope, (scoped) =>
      scoped.grantCredits({ idempotencyKey: "quota-fixture", amount: 100n }),
    );
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
    const scope = { accountId, workspaceId };
    await fund(scope);
    return scope;
  };
  const memberIn = async (scope: RepositoryScope) => {
    const member = await repositories.provisionAccount();
    await repositories.transaction(scope, (scoped) =>
      scoped.setMembership({
        accountId: member.accountId,
        role: "member",
        status: "active",
        expectedRevision: 0n,
      }),
    );
    return { ...scope, accountId: member.accountId };
  };
  const policy = async (
    limits: {
      journeyRequests?: number;
      accountRequests?: number;
      workspaceRequests?: number;
      accountCost?: bigint;
      workspaceCost?: bigint;
      journeyCost?: bigint;
    } = {},
  ) => {
    const version = `synthetic-pg-${randomUUID()}`;
    await migration.query(
      `INSERT INTO tholi.inference_policy_versions
       (version,provider,model,price_revision,max_credits,max_provider_usd_micros,
        max_input_units,max_output_units,max_images,max_retries,
        max_journey_requests,period_seconds,account_requests,workspace_requests,
        account_provider_usd_micros,workspace_provider_usd_micros,
        journey_provider_usd_micros)
       VALUES($1,'vertex','synthetic-offline-model','synthetic-offline-price-v1',
         1,10,100,100,1,0,$2,86400,$3,$4,$5,$6,$7)`,
      [
        version,
        limits.journeyRequests ?? 8,
        limits.accountRequests ?? 1000,
        limits.workspaceRequests ?? 1000,
        limits.accountCost ?? 100000n,
        limits.workspaceCost ?? 100000n,
        limits.journeyCost ?? 100000n,
      ],
    );
    return version;
  };
  const globalBudget = (limits: { requests?: bigint; cost?: bigint } = {}) =>
    migration.query(
      `UPDATE tholi.inference_control SET global_requests=$1,
         global_provider_usd_micros=$2,revision=revision+1 WHERE singleton`,
      [limits.requests ?? 100000n, limits.cost ?? 100000n],
    );
  const { reserveDecision, dispatch, finish } = inferenceFixture(repositories);
  const reported = (cost = 6n, chargedCredits = 1n) => ({
    resolution: "reported" as const,
    outcome: "completed" as const,
    inputUnits: 10n,
    outputUnits: 5n,
    providerUsdMicros: cost,
    chargedCredits,
  });
  const soleAdmission = <T>(
    results: PromiseSettledResult<T>[],
    deniedCode: string,
  ) => {
    const accepted = results.filter(
      (item): item is PromiseFulfilledResult<T> => item.status === "fulfilled",
    );
    const denied = results.filter((item) => item.status === "rejected");
    assert.equal(accepted.length, 1);
    assert.equal(denied.length, 1);
    assert.equal(denied[0].reason.code, deniedCode);
    return accepted[0].value;
  };
  const state = async (held: InferenceReservation) =>
    (
      await migration.query(
        `SELECT state,resolution,outcome,provider_usd_micros::text AS cost,
           charged_credits::text AS credits
         FROM tholi.inference_reservations WHERE id=$1`,
        [held.id],
      )
    ).rows[0];

  await record(
    "inference defaults stay disabled without grants and runtime roles cannot change policy",
    async () => {
      const scope = await repositories.provisionAccount();
      assert.equal((await balance(scope)).available, 0n);
      assert.equal(
        (
          await migration.query(
            "SELECT enabled FROM tholi.inference_control WHERE singleton",
          )
        ).rows[0].enabled,
        false,
      );
      for (const statement of [
        "UPDATE tholi.inference_control SET enabled=true WHERE singleton",
        "UPDATE tholi.inference_policy_versions SET max_journey_requests=1",
        "DELETE FROM tholi.inference_policy_versions",
      ])
        await assert.rejects(() => runtime.query(statement), { code: "42501" });
      for (const table of [
        "inference_reservations",
        "credit_allocations",
        "credit_refunds",
      ])
        assert.equal(
          (
            await runtime.query(
              `SELECT count(*)::integer AS count FROM tholi.${table}`,
            )
          ).rows[0].count,
          0,
          "Unscoped runtime reads cannot expose private accounting records.",
        );
      if (worker)
        for (const statement of [
          "UPDATE tholi.inference_control SET enabled=true WHERE singleton",
          "UPDATE tholi.inference_policy_versions SET max_journey_requests=1",
          "INSERT INTO tholi.credit_grants(workspace_id,id,idempotency_key,amount) VALUES(gen_random_uuid(),gen_random_uuid(),'worker-grant',1)",
        ])
          await assert.rejects(() => worker.query(statement), {
            code: "42501",
          });
    },
  );

  await record(
    "expired spent grants do not consume a later credit grant again",
    async () => {
      const scope = await repositories.provisionAccount();
      const grant = await repositories.transaction(scope, (scoped) =>
        scoped.grantCredits({
          idempotencyKey: "expiring-period",
          amount: 100n,
          expiresAt,
        }),
      );
      const held = await reserve(scope, "expired-period-spend", 60n);
      await repositories.transaction(scope, (scoped) =>
        scoped.settleCredits({ reservationId: held.id, amount: 60n }),
      );
      assert.equal((await balance(scope)).available, 40n);
      await expireGrant(scope, grant.id);
      assert.equal((await balance(scope)).available, 0n);
      await repositories.transaction(scope, (scoped) =>
        scoped.grantCredits({
          idempotencyKey: "next-period",
          amount: 100n,
        }),
      );
      assert.equal((await balance(scope)).available, 100n);
    },
  );

  await record(
    "credit allocations spend the earliest expiring grant first",
    async () => {
      const scope = await repositories.provisionAccount();
      const early = await repositories.transaction(scope, (scoped) =>
        scoped.grantCredits({
          idempotencyKey: "early-expiry",
          amount: 100n,
          expiresAt,
        }),
      );
      await repositories.transaction(scope, (scoped) =>
        scoped.grantCredits({
          idempotencyKey: "later-expiry",
          amount: 100n,
          expiresAt: new Date(expiresAt.getTime() + 60 * 60 * 1000),
        }),
      );
      const held = await reserve(scope, "cross-grant-spend", 120n);
      await repositories.transaction(scope, (scoped) =>
        scoped.settleCredits({ reservationId: held.id, amount: 120n }),
      );
      assert.equal((await balance(scope)).available, 80n);
      await expireGrant(scope, early.id);
      assert.equal((await balance(scope)).available, 80n);
    },
  );

  await record(
    "settling an uncertain hold after grant expiry cannot renew unused credits",
    async () => {
      const scope = await repositories.provisionAccount();
      const grant = await repositories.transaction(scope, (scoped) =>
        scoped.grantCredits({
          idempotencyKey: "held-expiring-period",
          amount: 100n,
          expiresAt,
        }),
      );
      const held = await reserve(scope, "held-across-expiry", 80n);
      await repositories.transaction(scope, (scoped) =>
        scoped.markReservationUncertain(held.id),
      );
      await expireGrant(scope, grant.id);
      await repositories.transaction(scope, (scoped) =>
        scoped.grantCredits({
          idempotencyKey: "fresh-during-uncertainty",
          amount: 100n,
        }),
      );
      assert.equal((await balance(scope)).available, 100n);
      const settlements = await Promise.all(
        Array.from({ length: 2 }, () =>
          repositories.transaction(scope, (scoped) =>
            scoped.settleCredits({ reservationId: held.id, amount: 60n }),
          ),
        ),
      );
      assert.equal(settlements[0].id, settlements[1].id);
      assert.equal((await balance(scope)).available, 100n);
    },
  );

  await record(
    "competing recurring grant keys cannot fund the same source period twice",
    async () => {
      const scope = await repositories.provisionAccount();
      const version = await policy();
      const periodStart = new Date(Date.now() - 1000);
      soleAdmission(
        await Promise.allSettled(
          ["first-scheduler", "second-scheduler"].map((idempotencyKey) =>
            new PostgresRepositories(runtime).transaction(scope, (scoped) =>
              scoped.grantCredits({
                idempotencyKey,
                amount: 10n,
                source: "free",
                periodStart,
                periodEnd: expiresAt,
                expiresAt,
                policyVersion: version,
              }),
            ),
          ),
        ),
        "CONFLICT",
      );
      assert.equal((await balance(scope)).available, 10n);
      const history = await repositories.transaction(scope, (scoped) =>
        scoped.listCreditHistory(),
      );
      assert.equal(history.items.length, 1);
      assert.equal(history.items[0].source, "free");
      assert.equal(history.items[0].policyVersion, version);
    },
  );

  await migration.query(
    "UPDATE tholi.inference_control SET enabled=true,revision=revision+1 WHERE singleton",
  );
  await globalBudget();
  try {
    await record(
      "competing replicas cannot exceed the global request ceiling",
      async () => {
        const version = await policy();
        await globalBudget({ requests: 1n });
        const scopes = await Promise.all(
          Array.from({ length: 2 }, () => repositories.provisionAccount()),
        );
        await Promise.all(scopes.map(fund));
        const held = soleAdmission(
          await Promise.allSettled(
            scopes.map((scope) =>
              reserveDecision(
                scope,
                version,
                randomUUID(),
                new PostgresRepositories(runtime),
              ),
            ),
          ),
          "QUOTA_EXCEEDED",
        );
        await finish(held, { resolution: "not-sent", outcome: "cancelled" });
        assert.equal((await state(held)).state, "released");
        await globalBudget();
      },
    );

    await record(
      "competing replicas atomically reserve a nonzero global provider budget",
      async () => {
        const version = await policy();
        await globalBudget({ cost: 10n });
        const scopes = await Promise.all(
          Array.from({ length: 2 }, () => repositories.provisionAccount()),
        );
        await Promise.all(scopes.map(fund));
        const held = soleAdmission(
          await Promise.allSettled(
            scopes.map((scope) =>
              reserveDecision(
                scope,
                version,
                randomUUID(),
                new PostgresRepositories(runtime),
              ),
            ),
          ),
          "QUOTA_EXCEEDED",
        );
        // Admission is actor-private. Resolve only the synthetic owner through
        // the migration connection rather than exposing another actor's row.
        const owner = (
          await migration.query<RepositoryScope>(
            'SELECT account_id AS "accountId",workspace_id AS "workspaceId" FROM tholi.inference_reservations WHERE id=$1',
            [held.id],
          )
        ).rows[0];
        await dispatch(owner, held);
        await finish(held, reported());
        assert.deepEqual(await state(held), {
          state: "settled",
          resolution: "reported",
          outcome: "completed",
          cost: "6",
          credits: "1",
        });
        await assert.rejects(() => reserveDecision(scopes[0], version), {
          code: "QUOTA_EXCEEDED",
        });
        const otherPolicy = await policy({
          accountCost: 1000000n,
          workspaceCost: 1000000n,
          journeyCost: 1000000n,
        });
        await assert.rejects(() => reserveDecision(scopes[1], otherPolicy), {
          code: "QUOTA_EXCEEDED",
        });
        await globalBudget();
      },
    );

    await record(
      "zero-provider-cost fake decisions remain available after priced history without bypassing the shared cap",
      async () => {
        const scope = await repositories.provisionAccount();
        await fund(scope);
        await globalBudget({ cost: 0n });
        const held = await reserveDecision(scope, "fake-development-v1");
        await dispatch(scope, held);
        const measured = await finish(held, {
          resolution: "reported",
          outcome: "completed",
          inputUnits: 0n,
          outputUnits: 0n,
          providerUsdMicros: 0n,
          chargedCredits: 1n,
        });
        assert.equal(measured.inputUnits, 0n);
        assert.equal(measured.outputUnits, 0n);
        const usage = await repositories.transaction(scope, (scoped) =>
          scoped.listUsage(),
        );
        assert.equal(usage.items[0].inputUnits, 0n);
        assert.equal(usage.items[0].outputUnits, 0n);
        assert.equal((await state(held)).cost, "0");
        assert.equal((await balance(scope)).available, 99n);
        const pricedPolicy = await policy();
        await assert.rejects(() => reserveDecision(scope, pricedPolicy), {
          code: "QUOTA_EXCEEDED",
        });
        await globalBudget();
      },
    );

    await record(
      "one durable foreground decision spans an account's organization workspaces",
      async () => {
        const account = await repositories.provisionAccount();
        const scopes = await Promise.all([
          organization(account.accountId),
          organization(account.accountId),
        ]);
        const version = await policy();
        const held = soleAdmission(
          await Promise.allSettled(
            scopes.map((scope) =>
              reserveDecision(
                scope,
                version,
                randomUUID(),
                new PostgresRepositories(runtime),
              ),
            ),
          ),
          "CONFLICT",
        );
        await finish(held, { resolution: "not-sent", outcome: "cancelled" });
        const next = await reserveDecision(scopes[0], version);
        await finish(next, { resolution: "not-sent", outcome: "cancelled" });
      },
    );

    await record(
      "reconnects and new journey identifiers cannot reset account request limits",
      async () => {
        const scope = await repositories.provisionAccount();
        await fund(scope);
        const version = await policy({
          accountRequests: 2,
          journeyRequests: 1,
        });
        const journeyId = randomUUID();
        const first = await reserveDecision(scope, version, journeyId);
        await dispatch(scope, first);
        await finish(first, reported());
        await assert.rejects(
          () =>
            reserveDecision(
              scope,
              version,
              journeyId,
              new PostgresRepositories(runtime),
            ),
          { code: "QUOTA_EXCEEDED" },
        );
        const second = await reserveDecision(scope, version, randomUUID());
        await dispatch(scope, second);
        await finish(second, reported());
        await assert.rejects(
          () =>
            reserveDecision(
              scope,
              version,
              randomUUID(),
              new PostgresRepositories(runtime),
            ),
          { code: "QUOTA_EXCEEDED" },
        );
        assert.equal((await balance(scope)).available, 98n);
      },
    );

    await record(
      "duplicate admission keys reserve one financial hold and reject a changed journey",
      async () => {
        const scope = await repositories.provisionAccount();
        await fund(scope);
        const version = await policy();
        const { request } = await repositories.transaction(scope, (scoped) =>
          scoped.beginRequest({
            operation: NAVIGATION_TRANSPORT_OPERATION,
            idempotencyKey: "duplicate-admission",
            payloadHash: "c".repeat(64),
          }),
        );
        const input = {
          requestId: request.id,
          journeyId: randomUUID(),
          policyVersion: version,
          expiresAt: new Date(Date.now() + 20000),
        };
        const admitted = await Promise.all(
          Array.from({ length: 2 }, () =>
            new PostgresRepositories(runtime).transaction(scope, (scoped) =>
              scoped.reserveInference(input),
            ),
          ),
        );
        assert.equal(admitted[0].id, admitted[1].id);
        assert.equal(admitted[0].claimToken, admitted[1].claimToken);
        assert.equal((await balance(scope)).reserved, 1n);
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.reserveInference({ ...input, journeyId: randomUUID() }),
            ),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        await finish(admitted[0], {
          resolution: "not-sent",
          outcome: "cancelled",
        });
        assert.equal((await balance(scope)).available, 100n);
      },
    );

    await record(
      "organization request ceilings aggregate different member accounts",
      async () => {
        const owner = await repositories.provisionAccount();
        const scope = await organization(owner.accountId);
        const member = await memberIn(scope);
        const version = await policy({ workspaceRequests: 1 });
        const held = soleAdmission(
          await Promise.allSettled(
            [scope, member].map((actor) =>
              reserveDecision(
                actor,
                version,
                randomUUID(),
                new PostgresRepositories(runtime),
              ),
            ),
          ),
          "QUOTA_EXCEEDED",
        );
        await finish(held, { resolution: "not-sent", outcome: "cancelled" });
      },
    );

    await record(
      "measured provider spending follows an account across organization workspaces",
      async () => {
        const owner = await repositories.provisionAccount();
        const first = await organization(owner.accountId);
        const second = await organization(owner.accountId);
        const version = await policy({ accountCost: 15n });
        const held = await reserveDecision(first, version);
        await dispatch(first, held);
        await finish(held, reported());
        await assert.rejects(() => reserveDecision(second, version), {
          code: "QUOTA_EXCEEDED",
        });
        assert.equal((await balance(first)).available, 99n);
        assert.equal((await balance(second)).available, 100n);
      },
    );

    await record(
      "measured organization spending cannot be bypassed by switching member accounts",
      async () => {
        const owner = await repositories.provisionAccount();
        const scope = await organization(owner.accountId);
        const member = await memberIn(scope);
        const version = await policy({ workspaceCost: 15n });
        const held = await reserveDecision(scope, version);
        await dispatch(scope, held);
        await finish(held, reported());
        await assert.rejects(() => reserveDecision(member, version), {
          code: "QUOTA_EXCEEDED",
        });
      },
    );

    await record(
      "a charged provider failure records cost once without granting or deducting user credits",
      async () => {
        const scope = await repositories.provisionAccount();
        await fund(scope);
        const version = await policy();
        const held = await reserveDecision(scope, version);
        await dispatch(scope, held);
        const failure = { ...reported(6n, 0n), outcome: "failed" as const };
        await Promise.all([finish(held, failure), finish(held, failure)]);
        assert.deepEqual(await state(held), {
          state: "settled",
          resolution: "reported",
          outcome: "failed",
          cost: "6",
          credits: "0",
        });
        assert.equal((await balance(scope)).available, 100n);
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.usage_records WHERE workspace_id=$1 AND request_id=$2",
              [scope.workspaceId, held.requestId],
            )
          ).rows[0].count,
          1,
        );
        await assert.rejects(
          () => finish(held, { ...failure, providerUsdMicros: 7n }),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        await assert.rejects(
          () =>
            repositories.finishInference({
              id: held.id,
              claimToken: randomUUID(),
              ...failure,
            }),
          { code: "FORBIDDEN" },
        );
      },
    );

    await record(
      "unknown dispatched charges survive expiry and can settle after account revocation",
      async () => {
        const scope = await repositories.provisionAccount();
        await fund(scope);
        const existingLiability = BigInt(
          (
            await migration.query(
              `SELECT COALESCE(sum(CASE
                 WHEN state IN('reserved','dispatched','uncertain')
                   THEN max_provider_usd_micros
                 ELSE COALESCE(provider_usd_micros,0) END),0)::text AS amount
               FROM tholi.inference_reservations`,
            )
          ).rows[0].amount,
        );
        const version = await policy({ accountCost: 10n });
        await globalBudget({ cost: existingLiability + 10n });
        const held = await reserveDecision(scope, version);
        await dispatch(scope, held);
        const unknown = await finish(held, {
          resolution: "unknown",
          outcome: "uncertain",
        });
        assert.equal(unknown.inputUnits, null);
        assert.equal(unknown.outputUnits, null);
        const usage = await repositories.transaction(scope, (scoped) =>
          scoped.listUsage(),
        );
        assert.equal(usage.items.length, 1);
        assert.equal(usage.items[0].requestId, held.requestId);
        assert.equal(usage.items[0].inputUnits, null);
        assert.equal(usage.items[0].outputUnits, null);
        assert.deepEqual(await state(held), {
          state: "uncertain",
          resolution: "unknown",
          outcome: "uncertain",
          cost: null,
          credits: null,
        });
        assert.equal((await balance(scope)).reserved, 1n);
        await migration.query(
          "UPDATE tholi.inference_reservations SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
          [held.id],
        );
        await assert.rejects(
          () =>
            reserveDecision(
              scope,
              version,
              randomUUID(),
              new PostgresRepositories(runtime),
            ),
          { code: "CONFLICT" },
        );
        const other = await repositories.provisionAccount();
        await fund(other);
        await assert.rejects(() => reserveDecision(other, version), {
          code: "QUOTA_EXCEEDED",
        });
        await migration.query(
          "UPDATE tholi.accounts SET status='suspended',revision=revision+1 WHERE id=$1",
          [scope.accountId],
        );
        await assert.rejects(() => balance(scope), { code: "FORBIDDEN" });
        await new PostgresRepositories(runtime).finishInference({
          id: held.id,
          claimToken: held.claimToken,
          ...reported(),
        });
        assert.equal((await state(held)).state, "settled");
        assert.equal((await state(held)).cost, "6");
        await assert.rejects(() => balance(scope), { code: "FORBIDDEN" });
        await globalBudget();
      },
    );

    await record(
      "a trusted no-send receipt after dispatch intent releases only the original hold",
      async () => {
        const scope = await repositories.provisionAccount();
        await fund(scope);
        const version = await policy();
        const held = await reserveDecision(scope, version);
        await dispatch(scope, held);
        const receipt = {
          resolution: "not-sent" as const,
          outcome: "cancelled" as const,
        };
        await Promise.all([finish(held, receipt), finish(held, receipt)]);
        assert.deepEqual(await state(held), {
          state: "released",
          resolution: "not-sent",
          outcome: "cancelled",
          cost: "0",
          credits: "0",
        });
        const current = await balance(scope);
        assert.equal(current.available, 100n);
        assert.equal(current.spent, 0n);
        assert.equal(current.refunded, 0n);
      },
    );

    await record(
      "the shared disable control fences dispatch but preserves late financial settlement",
      async () => {
        const scope = await repositories.provisionAccount();
        await fund(scope);
        const version = await policy();
        const beforeSend = await reserveDecision(scope, version);
        await migration.query(
          "UPDATE tholi.inference_control SET enabled=false,revision=revision+1 WHERE singleton",
        );
        try {
          await assert.rejects(() => dispatch(scope, beforeSend), {
            code: "INFERENCE_DISABLED",
          });
          await assert.rejects(() => reserveDecision(scope, version), {
            code: "INFERENCE_DISABLED",
          });
          await finish(beforeSend, {
            resolution: "not-sent",
            outcome: "cancelled",
          });
          assert.equal((await balance(scope)).available, 100n);
        } finally {
          await migration.query(
            "UPDATE tholi.inference_control SET enabled=true,revision=revision+1 WHERE singleton",
          );
        }
        const afterSend = await reserveDecision(scope, version);
        await dispatch(scope, afterSend);
        await migration.query(
          "UPDATE tholi.inference_control SET enabled=false,revision=revision+1 WHERE singleton",
        );
        try {
          await finish(afterSend, reported());
          assert.equal((await state(afterSend)).state, "settled");
          assert.equal((await balance(scope)).available, 99n);
        } finally {
          await migration.query(
            "UPDATE tholi.inference_control SET enabled=true,revision=revision+1 WHERE singleton",
          );
        }
      },
    );

    await record(
      "duplicate refunds restore only their original unexpired credit lots and never provider spend",
      async () => {
        const scope = await repositories.provisionAccount();
        const version = await policy();
        const grantCommand = {
          idempotencyKey: "refund-expiring-period",
          amount: 100n,
          expiresAt,
          source: "synthetic-evaluation",
          periodStart: new Date(Date.now() - 60 * 60 * 1000),
          periodEnd: expiresAt,
          policyVersion: version,
        };
        const grant = await repositories.transaction(scope, (scoped) =>
          scoped.grantCredits(grantCommand),
        );
        await assert.rejects(
          () =>
            repositories.transaction(scope, (scoped) =>
              scoped.grantCredits({
                ...grantCommand,
                source: "changed-source",
              }),
            ),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        const held = await reserveDecision(scope, version);
        await dispatch(scope, held);
        await finish(held, reported());
        await expireGrant(scope, grant.id);
        await repositories.transaction(scope, (scoped) =>
          scoped.grantCredits({
            idempotencyKey: "refund-new-period",
            amount: 100n,
          }),
        );
        assert.equal((await balance(scope)).available, 100n);
        const refund = {
          id: held.id,
          claimToken: held.claimToken,
          idempotencyKey: "one-policy-refund",
          amount: 1n,
        };
        await Promise.all([
          repositories.refundInference(refund),
          new PostgresRepositories(runtime).refundInference(refund),
        ]);
        assert.equal((await balance(scope)).available, 100n);
        assert.equal((await balance(scope)).refunded, 1n);
        assert.equal((await state(held)).cost, "6");
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.credit_refunds WHERE workspace_id=$1",
              [scope.workspaceId],
            )
          ).rows[0].count,
          1,
        );
        await assert.rejects(
          () => repositories.refundInference({ ...refund, amount: 2n }),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        await assert.rejects(
          () =>
            repositories.refundInference({
              ...refund,
              claimToken: randomUUID(),
            }),
          { code: "FORBIDDEN" },
        );
        await assert.rejects(
          () =>
            repositories.refundInference({
              ...refund,
              idempotencyKey: "second-unearned-refund",
            }),
          { code: "CONFLICT" },
        );
        const history = await repositories.transaction(scope, (scoped) =>
          scoped.listCreditHistory(),
        );
        const original = history.items.find((entry) => entry.id === grant.id);
        assert.equal(original?.source, grantCommand.source);
        assert.equal(original?.policyVersion, version);
        assert.equal(
          original?.periodStart?.toISOString(),
          grantCommand.periodStart.toISOString(),
        );
        assert.equal(
          original?.periodEnd?.toISOString(),
          grantCommand.periodEnd.toISOString(),
        );
        assert.deepEqual(
          history.items
            .filter((entry) => entry.kind === "refund")
            .map((entry) => ({
              amount: entry.amount,
              policyVersion: entry.policyVersion,
            })),
          [{ amount: 1n, policyVersion: version }],
        );
      },
    );

    if (worker) {
      const workerRepositories = new PostgresRepositories(worker);
      const jobs = new PostgresJobs(worker);
      const handler = createInferenceReconciliationHandler(workerRepositories);
      const expireInference = (held: InferenceReservation) =>
        migration.query(
          `UPDATE tholi.inference_reservations
           SET expires_at=clock_timestamp()-interval '2 seconds',
               updated_at=clock_timestamp()-interval '2 seconds'
           WHERE id=$1`,
          [held.id],
        );
      const claimReconciliation = async (held: InferenceReservation) => {
        const claims = await jobs.claim({
          workerId: "quota-reconciliation",
          kinds: [INFERENCE_RECONCILIATION_JOB_KIND],
          leaseMs: 30000,
          limit: 10,
        });
        const lease = claims.find(
          (item) => item.recordReferences.requestId === held.requestId,
        );
        assert.ok(
          lease,
          "The worker claims the owned accounting metadata job.",
        );
        return lease;
      };
      const completionCount = async (jobId: string) =>
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM tholi.outbox WHERE job_id=$1 AND event_kind='job.completed' AND status='published'",
            [jobId],
          )
        ).rows[0].count;

      await record(
        "an actual provider overrun survives settlement failure and freezes inference without user credit overage",
        async () => {
          const scope = await repositories.provisionAccount();
          const other = await repositories.provisionAccount();
          await Promise.all([fund(scope), fund(other)]);
          const version = await policy();
          const held = await reserveDecision(scope, version);
          const pending = await reserveDecision(other, version);
          await dispatch(scope, held);
          const before = (
            await migration.query(
              "SELECT revision::text FROM tholi.inference_control WHERE singleton",
            )
          ).rows[0];
          try {
            await runtime.query(
              "SELECT tholi.record_inference_outcome($1,$2,'reported','completed',32769,5,13,1,NULL)",
              [held.id, held.claimToken],
            );
            const stopped = (
              await migration.query(
                "SELECT enabled,revision::text FROM tholi.inference_control WHERE singleton",
              )
            ).rows[0];
            assert.equal(stopped.enabled, false);
            assert.ok(BigInt(stopped.revision) > BigInt(before.revision));
            const deliberate = new Error(
              "Rollback overrun settlement after the receipt commit.",
            );
            await assert.rejects(
              () =>
                withTransaction(runtime, async (client) => {
                  await client.query(
                    "SELECT tholi.finish_inference($1,$2,'reported','completed',32769,5,13,1,NULL)",
                    [held.id, held.claimToken],
                  );
                  throw deliberate;
                }),
              (error) => error === deliberate,
            );
            await assert.rejects(() => dispatch(other, pending), {
              code: "INFERENCE_DISABLED",
            });
            await finish(pending, {
              resolution: "not-sent",
              outcome: "cancelled",
            });
            await finish(held, { resolution: "unknown", outcome: "uncertain" });
            assert.equal((await state(held)).cost, "13");
            assert.equal((await balance(scope)).reserved, 1n);
            assert.equal(
              (
                await worker.query(
                  "SELECT reserved_provider_usd_micros FROM tholi.inference_health()",
                )
              ).rows[0].reserved_provider_usd_micros,
              "13",
              "The committed actual liability cannot shrink back to the estimate.",
            );
            await assert.rejects(() => reserveDecision(other, version), {
              code: "INFERENCE_DISABLED",
            });
            await expireInference(held);
            assert.equal(
              await workerRepositories.scheduleInferenceReconciliation({
                limit: 100,
                intervalMs: 1000,
              }),
              1,
            );
            const lease = await claimReconciliation(held);
            await handler.execute(lease, new AbortController().signal, 1000);
            assert.deepEqual(await state(held), {
              state: "settled",
              resolution: "reported",
              outcome: "completed",
              cost: "13",
              credits: "1",
            });
            const usage = await repositories.transaction(scope, (scoped) =>
              scoped.listUsage(),
            );
            assert.equal(usage.items.length, 1);
            assert.equal(usage.items[0].inputUnits, 32769n);
            assert.equal(usage.items[0].outputUnits, 5n);
            assert.equal(usage.items[0].providerUsdMicros, 13n);
            assert.equal(usage.items[0].chargedCredits, 1n);
            assert.equal((await balance(scope)).available, 99n);
            assert.equal(
              (
                await migration.query(
                  "SELECT max_provider_usd_micros::text FROM tholi.inference_reservations WHERE id=$1",
                  [held.id],
                )
              ).rows[0].max_provider_usd_micros,
              "10",
            );
            assert.deepEqual(
              (
                await migration.query(
                  "SELECT enabled,revision::text FROM tholi.inference_control WHERE singleton",
                )
              ).rows[0],
              stopped,
              "Reconciliation cannot silently re-enable inference or count a duplicate receipt twice.",
            );
            assert.equal(await completionCount(lease.id), 1);
          } finally {
            await migration.query(
              "UPDATE tholi.inference_control SET enabled=true,revision=revision+1 WHERE singleton",
            );
          }
        },
      );

      await record(
        "a committed provider receipt reconciles after a crash and revocation with one atomic completion outbox",
        async () => {
          const scope = await repositories.provisionAccount();
          await fund(scope);
          const version = await policy();
          const held = await reserveDecision(scope, version);
          await dispatch(scope, held);
          // This is the first committed step of finishInference. The process
          // can disappear before its independent settlement transaction starts.
          await runtime.query(
            "SELECT tholi.record_inference_outcome($1,$2,'reported','completed',10,5,6,1,NULL)",
            [held.id, held.claimToken],
          );
          await expireInference(held);
          await migration.query(
            "UPDATE tholi.accounts SET status='suspended',revision=revision+1 WHERE id=$1",
            [scope.accountId],
          );
          const scheduled = await Promise.all(
            Array.from({ length: 2 }, () =>
              workerRepositories.scheduleInferenceReconciliation({
                limit: 100,
                intervalMs: 1000,
              }),
            ),
          );
          assert.equal(
            scheduled.reduce((sum, count) => sum + count, 0),
            1,
          );
          const lease = await claimReconciliation(held);
          await assert.rejects(
            () =>
              workerRepositories.reconcileInference({
                ...lease,
                leaseToken: randomUUID(),
              }),
            { code: "FORBIDDEN" },
          );
          const deliberate = new Error(
            "Rollback accounting before acknowledgement.",
          );
          await assert.rejects(
            () =>
              withTransaction(worker, async (client) => {
                await client.query(
                  "SELECT * FROM tholi.reconcile_inference($1,$2,$3,$4)",
                  [
                    lease.workspaceId,
                    lease.accountId,
                    lease.id,
                    lease.leaseToken,
                  ],
                );
                throw deliberate;
              }),
            (error) => error === deliberate,
          );
          assert.equal((await state(held)).state, "dispatched");
          assert.equal(await completionCount(lease.id), 0);
          await handler.execute(lease, new AbortController().signal, 1000);
          assert.deepEqual(await state(held), {
            state: "settled",
            resolution: "reported",
            outcome: "completed",
            cost: "6",
            credits: "1",
          });
          assert.equal(await completionCount(lease.id), 1);
          assert.deepEqual(
            (
              await migration.query(
                "SELECT status,result_count FROM tholi.jobs WHERE id=$1",
                [lease.id],
              )
            ).rows[0],
            { status: "succeeded", result_count: 1 },
          );
          await assert.rejects(
            () => workerRepositories.reconcileInference(lease),
            {
              code: "FORBIDDEN",
            },
          );
          assert.equal(await completionCount(lease.id), 1);
          assert.equal(
            (
              await migration.query(
                "SELECT count(*)::integer AS count FROM tholi.credit_settlements WHERE workspace_id=$1 AND reservation_id=$2",
                [scope.workspaceId, held.creditReservationId],
              )
            ).rows[0].count,
            1,
          );
          await assert.rejects(() => balance(scope), { code: "FORBIDDEN" });
        },
      );

      await record(
        "reconciliation releases an expired lease only when dispatch never started",
        async () => {
          const scope = await repositories.provisionAccount();
          await fund(scope);
          const version = await policy();
          const held = await reserveDecision(scope, version);
          await expireInference(held);
          assert.equal(
            await workerRepositories.scheduleInferenceReconciliation({
              limit: 100,
              intervalMs: 1000,
            }),
            1,
          );
          const lease = await claimReconciliation(held);
          await handler.execute(lease, new AbortController().signal, 1000);
          assert.deepEqual(await state(held), {
            state: "released",
            resolution: "not-sent",
            outcome: "cancelled",
            cost: "0",
            credits: "0",
          });
          assert.equal((await balance(scope)).available, 100n);
          assert.equal(await completionCount(lease.id), 1);
        },
      );

      await record(
        "proofless dispatched reconciliation retains liability and never publishes completion or retries inference",
        async () => {
          const scope = await repositories.provisionAccount();
          await fund(scope);
          const version = await policy();
          const held = await reserveDecision(scope, version);
          await dispatch(scope, held);
          await expireInference(held);
          assert.equal(
            await workerRepositories.scheduleInferenceReconciliation({
              limit: 100,
              intervalMs: 1000,
            }),
            1,
          );
          const lease = await claimReconciliation(held);
          await handler.execute(lease, new AbortController().signal, 1000);
          assert.deepEqual(await state(held), {
            state: "uncertain",
            resolution: "unknown",
            outcome: "uncertain",
            cost: null,
            credits: null,
          });
          assert.equal((await balance(scope)).reserved, 1n);
          assert.equal(await completionCount(lease.id), 0);
          assert.equal(
            (
              await migration.query(
                "SELECT status FROM tholi.jobs WHERE id=$1",
                [lease.id],
              )
            ).rows[0].status,
            "uncertain",
          );
          assert.deepEqual(
            await jobs.claim({
              workerId: "restarted-quota-reconciliation",
              kinds: [INFERENCE_RECONCILIATION_JOB_KIND],
              leaseMs: 30000,
              limit: 10,
            }),
            [],
          );
          await assert.rejects(() => reserveDecision(scope, version), {
            code: "CONFLICT",
          });
        },
      );
    }
  } finally {
    await migration.query(
      `UPDATE tholi.inference_control SET enabled=false,global_requests=1000,
         global_provider_usd_micros=0,revision=revision+1 WHERE singleton`,
    );
  }
}
