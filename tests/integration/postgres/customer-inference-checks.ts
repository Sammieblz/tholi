import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { PostgresJobs } from "../../../apps/api/src/database/jobs";
import type {
  CustomerInferenceBinding,
  FinishInferenceInput,
  InferenceReservation,
} from "../../../apps/api/src/database/contracts";
import { INFERENCE_RECONCILIATION_JOB_KIND } from "../../../apps/api/src/application/quotas";
import { customerDevelopmentChargingPolicy } from "../../../packages/navigation-core/contracts-credits";
import { providerConnectionSelection } from "../../../packages/navigation-core/contracts-providers";
import { inferenceFixture } from "./inference-fixture";
import { providerConnectionFixture } from "./provider-fixture";

/** Synthetic receipts exercise real admission, locks and reconciliation without provider requests. */
export async function runCustomerInferenceChecks(
  runtime: Pool,
  migration: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
  worker?: Pool,
) {
  const repositories = new PostgresRepositories(runtime);
  const fixture = inferenceFixture(repositories);
  const version = customerDevelopmentChargingPolicy("openai").version;
  const setup = async () => {
    const scope = await repositories.provisionAccount();
    const provider = await providerConnectionFixture(runtime, scope.accountId);
    const binding: CustomerInferenceBinding = {
      ...provider.selection,
      retrievalSnapshotDigest: "a".repeat(64),
    };
    return {
      scope,
      provider,
      binding,
      reserve: (journey = randomUUID()) =>
        fixture.reserveDecision(scope, version, journey, repositories, binding),
    };
  };
  const receipt: Omit<FinishInferenceInput, "id" | "claimToken"> = {
    resolution: "reported",
    outcome: "completed",
    inputUnits: 18n,
    outputUnits: 12n,
    providerUsdMicros: 0n,
    chargedCredits: 0n,
    usageVersion: 2,
    customerUsdMicros: null,
    cacheReadInputUnits: null,
    cacheWriteInputUnits: null,
    reasoningOutputUnits: 8n,
  };
  const original = (
    await migration.query(
      "SELECT enabled,customer_enabled,global_requests::text,global_provider_usd_micros::text FROM tholi.inference_control WHERE singleton",
    )
  ).rows[0];
  await record(
    "customer model admission remains disabled independently of the managed gate",
    async () => {
      const f = await setup();
      assert.equal(original.customer_enabled, false);
      await assert.rejects(() => f.reserve(), { code: "INFERENCE_DISABLED" });
      await assert.rejects(
        () =>
          runtime.query(
            "UPDATE tholi.inference_control SET customer_enabled=true WHERE singleton",
          ),
        { code: "42501" },
      );
    },
  );
  try {
    await migration.query(
      "UPDATE tholi.inference_control SET customer_enabled=true,global_requests=100000,revision=revision+1 WHERE singleton",
    );
    await record(
      "customer funding preserves exact bindings and settles measured usage without enrollment, managed credits or guessed prices",
      async () => {
        const f = await setup(),
          held = await f.reserve();
        assert.equal(held.creditReservationId, null);
        assert.equal(held.maxCredits, 0n);
        assert.equal(held.effectivePlan, null);
        assert.deepEqual(held.binding, f.binding);
        const totals = await repositories.transaction(f.scope, (scoped) =>
          scoped.creditBalance(),
        );
        assert.equal(totals.available, 0n);
        const repeat = {
          requestId: held.requestId,
          journeyId: (
            await migration.query(
              "SELECT journey_id FROM tholi.inference_reservations WHERE id=$1",
              [held.id],
            )
          ).rows[0].journey_id,
          policyVersion: version,
          expiresAt: held.expiresAt,
          binding: f.binding,
        };
        assert.equal(
          (
            await repositories.transaction(f.scope, (scoped) =>
              scoped.reserveInference(repeat),
            )
          ).id,
          held.id,
        );
        await assert.rejects(
          () =>
            repositories.transaction(f.scope, (scoped) =>
              scoped.reserveInference({
                ...repeat,
                binding: {
                  ...f.binding,
                  retrievalSnapshotDigest: "b".repeat(64),
                },
              }),
            ),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        await fixture.dispatch(f.scope, held);
        const measured = await fixture.finish(held, receipt);
        assert.equal(measured.fundingSource, "customer");
        assert.equal(measured.usageVersion, 2);
        assert.equal(measured.inputUnits, 18n);
        assert.equal(measured.outputUnits, 12n);
        assert.equal(measured.reasoningOutputUnits, 8n);
        assert.equal(measured.customerUsdMicros, null);
        assert.equal(measured.providerUsdMicros, 0n);
        assert.equal(measured.chargedCredits, 0n);
        assert.deepEqual(await fixture.finish(held, receipt), measured);
        await assert.rejects(
          () => fixture.finish(held, { ...receipt, outputUnits: 13n }),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        const second = await f.reserve();
        await fixture.dispatch(f.scope, second);
        await fixture.finish(second, receipt);
        const legacy = await repositories.transaction(f.scope, (scoped) =>
          scoped.listUsage(),
        );
        assert.deepEqual(legacy.items, []);
        const extended = await repositories.transaction(f.scope, (scoped) =>
          scoped.listUsage({ limit: 1 }, 2),
        );
        assert.equal(extended.items.length, 1);
        assert.equal(extended.items[0].fundingSource, "customer");
        assert.ok(extended.nextCursor);
        assert.equal(
          JSON.parse(
            Buffer.from(extended.nextCursor, "base64url").toString("utf8"),
          )[1],
          2,
        );
        await assert.rejects(
          () =>
            repositories.transaction(f.scope, (scoped) =>
              scoped.listUsage({ after: extended.nextCursor }),
            ),
          { code: "INVALID_INPUT" },
        );
        await assert.rejects(
          () =>
            repositories.transaction(f.scope, (scoped) =>
              scoped.listCreditHistory({ after: extended.nextCursor }),
            ),
          { code: "INVALID_INPUT" },
        );
        const following = await repositories.transaction(f.scope, (scoped) =>
          scoped.listUsage({ after: extended.nextCursor }, 2),
        );
        assert.equal(following.items.length, 1);
        assert.notEqual(following.items[0].id, extended.items[0].id);
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.credit_reservations WHERE workspace_id=$1",
              [f.scope.workspaceId],
            )
          ).rows[0].count,
          0,
        );
        assert.equal(
          (
            await migration.query(
              "SELECT count(*)::integer AS count FROM tholi.credit_settlements WHERE workspace_id=$1",
              [f.scope.workspaceId],
            )
          ).rows[0].count,
          0,
        );
        assert.equal(
          (
            await migration.query(
              "SELECT enabled FROM tholi.inference_control WHERE singleton",
            )
          ).rows[0].enabled,
          original.enabled,
        );
      },
    );

    await record(
      "concurrent customer requests share the foreground fence and removed credentials cannot dispatch",
      async () => {
        const f = await setup();
        const simultaneous = await Promise.allSettled([
          f.reserve(),
          f.reserve(),
        ]);
        const accepted = simultaneous.filter(
          (result): result is PromiseFulfilledResult<InferenceReservation> =>
            result.status === "fulfilled",
        );
        const denied = simultaneous.filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        );
        assert.equal(accepted.length, 1);
        assert.equal(denied.length, 1);
        assert.equal(denied[0].reason.code, "CONFLICT");
        const held = accepted[0].value;
        await f.provider.service.remove(
          { accountId: f.scope.accountId },
          f.provider.connection.id,
          { expectedRevision: f.provider.connection.revision },
          f.provider.context,
        );
        await assert.rejects(() => fixture.dispatch(f.scope, held), {
          code: "CONFLICT",
        });
        await fixture.finish(held, {
          resolution: "not-sent",
          outcome: "cancelled",
          usageVersion: 2,
          customerUsdMicros: 0n,
        });
      },
    );

    await record(
      "unknown customer outcomes retain a cross-workspace fence even after key rotation",
      async () => {
        const f = await setup(),
          held = await f.reserve();
        await fixture.dispatch(f.scope, held);
        const uncertain = await fixture.finish(held, {
          resolution: "unknown",
          outcome: "uncertain",
          usageVersion: 2,
          providerUsdMicros: 0n,
          chargedCredits: 0n,
          customerUsdMicros: null,
        });
        assert.equal(uncertain.inputUnits, null);
        assert.equal(uncertain.outputUnits, null);
        assert.equal(uncertain.providerUsdMicros, 0n);
        assert.equal(uncertain.customerUsdMicros, null);
        const rotated = await f.provider.service.replace(
          { accountId: f.scope.accountId },
          f.provider.connection.id,
          {
            expectedRevision: f.provider.connection.revision,
            apiKey: "synthetic-rotated-customer-key",
            model: f.provider.connection.model,
            catalogRevision: f.provider.connection.catalogRevision,
          },
          f.provider.context,
        );
        const binding = {
          ...providerConnectionSelection(rotated),
          retrievalSnapshotDigest: "a".repeat(64),
        };
        await assert.rejects(
          () =>
            fixture.reserveDecision(
              f.scope,
              version,
              randomUUID(),
              repositories,
              binding,
            ),
          { code: "CONFLICT" },
        );
        const workspaceId = randomUUID();
        await migration.query(
          "INSERT INTO tholi.workspaces(id,kind,owner_account_id) VALUES($1,'organization',$2)",
          [workspaceId, f.scope.accountId],
        );
        await migration.query(
          "INSERT INTO tholi.memberships(workspace_id,account_id,role) VALUES($1,$2,'owner')",
          [workspaceId, f.scope.accountId],
        );
        await assert.rejects(
          () =>
            fixture.reserveDecision(
              { accountId: f.scope.accountId, workspaceId },
              version,
              randomUUID(),
              repositories,
              binding,
            ),
          { code: "CONFLICT" },
        );
        const resolved = await fixture.finish(held, receipt);
        assert.equal(resolved.outputUnits, 12n);
        assert.equal(resolved.reasoningOutputUnits, 8n);
        assert.equal(resolved.customerUsdMicros, null);
      },
    );

    await record(
      "customer allowances enforce two per minute, two per journey and six in a rolling day",
      async () => {
        const f = await setup(),
          journey = randomUUID();
        for (let index = 0; index < 2; index++) {
          const held = await f.reserve(journey);
          await fixture.dispatch(f.scope, held);
          await fixture.finish(held, receipt);
        }
        await assert.rejects(() => f.reserve(), { code: "QUOTA_EXCEEDED" });
        const age = () =>
          migration.query(
            "UPDATE tholi.inference_reservations SET created_at=clock_timestamp()-interval '2 minutes' WHERE account_id=$1",
            [f.scope.accountId],
          );
        await age();
        await assert.rejects(() => f.reserve(journey), {
          code: "QUOTA_EXCEEDED",
        });
        for (let index = 0; index < 4; index++) {
          await age();
          const held = await f.reserve();
          await fixture.dispatch(f.scope, held);
          await fixture.finish(held, receipt);
        }
        await migration.query(
          "UPDATE tholi.inference_reservations SET created_at=clock_timestamp()-interval '23 hours 59 minutes' WHERE account_id=$1",
          [f.scope.accountId],
        );
        await assert.rejects(() => f.reserve(), { code: "QUOTA_EXCEEDED" });
        await migration.query(
          "UPDATE tholi.inference_reservations SET created_at=clock_timestamp()-interval '25 hours' WHERE id=(SELECT id FROM tholi.inference_reservations WHERE account_id=$1 ORDER BY id LIMIT 1)",
          [f.scope.accountId],
        );
        const next = await f.reserve();
        await fixture.finish(next, {
          resolution: "not-sent",
          outcome: "cancelled",
          usageVersion: 2,
          customerUsdMicros: 0n,
        });
      },
    );

    if (worker)
      await record(
        "customer receipt reconciliation preserves v2 breakdowns after account revocation",
        async () => {
          const f = await setup(),
            held = await f.reserve();
          await fixture.dispatch(f.scope, held);
          const details = {
            version: 2,
            customerUsdMicros: null,
            cacheReadInputUnits: null,
            cacheWriteInputUnits: null,
            reasoningOutputUnits: "8",
          };
          await runtime.query(
            "SELECT tholi.record_inference_outcome($1,$2,'reported','completed',18,12,0,0,NULL,$3::jsonb)",
            [held.id, held.claimToken, JSON.stringify(details)],
          );
          await migration.query(
            "UPDATE tholi.inference_reservations SET expires_at=clock_timestamp()-interval '1 second',updated_at=clock_timestamp()-interval '2 seconds' WHERE id=$1",
            [held.id],
          );
          await migration.query(
            "UPDATE tholi.accounts SET status='suspended',revision=revision+1 WHERE id=$1",
            [f.scope.accountId],
          );
          const workerRepositories = new PostgresRepositories(worker);
          await workerRepositories.scheduleInferenceReconciliation({
            limit: 100,
            intervalMs: 1000,
          });
          await migration.query(
            "UPDATE tholi.jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind='inference.reconcile' AND status='queued' AND account_id<>$1",
            [f.scope.accountId],
          );
          const leases = await new PostgresJobs(worker).claim({
            workerId: "customer-receipt-reconciliation",
            kinds: [INFERENCE_RECONCILIATION_JOB_KIND],
            leaseMs: 30000,
            limit: 1,
          });
          const lease = leases.find(
            (item) => item.accountId === f.scope.accountId,
          );
          assert.ok(lease);
          await workerRepositories.reconcileInference(lease);
          const result = (
            await migration.query(
              "SELECT r.state,u.usage_details,u.provider_usd_micros::text,u.charged_credits::text FROM tholi.inference_reservations r JOIN tholi.usage_records u ON u.workspace_id=r.workspace_id AND u.request_id=r.request_id WHERE r.id=$1",
              [held.id],
            )
          ).rows[0];
          assert.equal(result.state, "settled");
          assert.deepEqual(result.usage_details, details);
          assert.equal(result.provider_usd_micros, "0");
          assert.equal(result.charged_credits, "0");
        },
      );
  } finally {
    await migration.query(
      "UPDATE tholi.inference_control SET enabled=$1,customer_enabled=$2,global_requests=$3,global_provider_usd_micros=$4,revision=revision+1 WHERE singleton",
      [
        original.enabled,
        original.customer_enabled,
        original.global_requests,
        original.global_provider_usd_micros,
      ],
    );
  }
}
