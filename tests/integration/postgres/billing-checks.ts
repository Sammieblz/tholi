import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { withTransaction } from "../../../apps/api/src/database/postgres";
import { billingCatalogSeed } from "../../../apps/api/src/database/migrations/017-subscription-billing";
import { productCatalogSchema } from "../../../packages/navigation-core/contracts-plans";
import { BILLING_LIMITS } from "../../../packages/navigation-core/contracts-billing";

/** Additive storage coverage. No payment dispatch or entitlement grant is enabled. */
export async function runBillingChecks(
  runtime: Pool,
  migration: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
) {
  const repositories = new PostgresRepositories(runtime);
  const owner = await repositories.provisionAccount(),
    stranger = await repositories.provisionAccount();
  const read = () =>
    repositories.transaction(owner, (scope) =>
      scope.withBilling(async (billing) => ({
        subscription: await billing.subscription(),
        invoices: await billing.invoices(),
      })),
    );
  await record(
    "billing catalog negotiation preserves legacy paid unavailability",
    async () => {
      const legacy = await repositories.readPlanCatalog(),
        negotiated = await repositories.readPlanCatalog(2);
      assert.equal(legacy.version, 1);
      assert.equal(negotiated.version, 2);
      assert.equal(
        negotiated.catalogVersion,
        billingCatalogSeed.catalogVersion,
      );
      assert.equal(productCatalogSchema.safeParse(negotiated).success, false);
      assert.ok(
        legacy.plans
          .filter((plan) => plan.mode === "paid")
          .every(
            (plan) =>
              !plan.availability.available &&
              plan.pricing.status === "unpublished",
          ),
      );
      assert.deepEqual(
        negotiated.plans
          .filter((plan) => plan.mode !== "paid")
          .map(({ billing: _billing, ...plan }) => plan),
        legacy.plans.filter((plan) => plan.mode !== "paid"),
      );
      await assert.rejects(
        () => migration.query("SELECT tholi.read_product_catalog(3)"),
        { code: "22023" },
      );
    },
  );
  await record(
    "billing reads grant no plan, credits or implicit profile and deny direct financial writes",
    async () => {
      const before = await read();
      assert.equal(before.subscription.revision, "0");
      assert.equal(before.subscription.status, "none");
      assert.equal(before.subscription.available, false);
      assert.deepEqual(before.invoices.items, []);
      await repositories.transaction(owner, async (scope) => {
        assert.equal((await scope.creditBalance()).granted, 0n);
        assert.deepEqual(await scope.listEntitlements(), []);
      });
      assert.equal(
        (
          await migration.query(
            "SELECT count(*)::int AS count FROM tholi.billing_workspaces WHERE workspace_id=$1",
            [owner.workspaceId],
          )
        ).rows[0].count,
        0,
      );
      for (const table of [
        "billing_workspaces",
        "billing_subscriptions",
        "billing_operations",
        "billing_invoices",
      ])
        assert.equal(
          (
            await runtime.query(
              "SELECT has_table_privilege(current_user,$1,'INSERT') AS allowed",
              [`tholi.${table}`],
            )
          ).rows[0].allowed,
          false,
        );
      await assert.rejects(
        () => runtime.query("SELECT * FROM tholi.billing_events"),
        { code: "42501" },
      );
    },
  );
  await record(
    "billing metadata is bounded, exact and isolated by owner and workspace",
    async () => {
      const entitlementId = randomUUID(),
        subscriptionId = randomUUID(),
        providerSuffix = randomBytes(12).toString("hex"),
        start = new Date(Date.now() - 60000),
        end = new Date(Date.now() + 3600000);
      await migration.query(
        `INSERT INTO tholi.billing_workspaces(workspace_id,account_id,mode,merchant_id,profile_id,profile_revision,profile_digest,provider_customer_id,revision)
      VALUES($1,$2,'fake','acct_fixture','offline-development',1,$3,$4,7)`,
        [
          owner.workspaceId,
          owner.accountId,
          randomBytes(32),
          "cus_" + providerSuffix,
        ],
      );
      await migration.query(
        `INSERT INTO tholi.entitlements(workspace_id,id,plan_id,plan_version,status,starts_at,ends_at)
      VALUES($1,$2,'paid-cloud',2,'suspended',$3,$4)`,
        [owner.workspaceId, entitlementId, start, end],
      );
      await migration.query(
        `INSERT INTO tholi.billing_subscriptions(workspace_id,id,mode,merchant_id,provider_subscription_id,plan_id,plan_version,catalog_version,entitlement_id,status,period_start,period_end,cancel_at_period_end)
      VALUES($1,$2,'fake','acct_fixture',$3,'paid-cloud',2,$4,$5,'past-due',$6,$7,true)`,
        [
          owner.workspaceId,
          subscriptionId,
          "sub_" + providerSuffix,
          billingCatalogSeed.catalogVersion,
          entitlementId,
          start,
          end,
        ],
      );
      await migration.query(
        "UPDATE tholi.billing_workspaces SET selected_subscription_id=$2 WHERE workspace_id=$1",
        [owner.workspaceId, subscriptionId],
      );
      const inserted = await migration.query<{ id: string; issuedAt: Date }>(
        `INSERT INTO tholi.billing_invoices(workspace_id,id,mode,merchant_id,provider_invoice_id,subscription_id,plan_id,plan_version,catalog_version,status,amount_paid_minor,currency,period_start,period_end,issued_at)
      SELECT $1,gen_random_uuid(),'fake','acct_fixture','in_'||$2::text||'_'||n,$3,'paid-cloud',2,$4,'paid',9007199254740993,'usd',$5,$6,clock_timestamp()-n*interval '1 minute'
      FROM generate_series(1,$7::integer) AS n RETURNING id,issued_at AS "issuedAt"`,
        [
          owner.workspaceId,
          providerSuffix,
          subscriptionId,
          billingCatalogSeed.catalogVersion,
          start,
          end,
          BILLING_LIMITS.maxInvoices + 3,
        ],
      );
      const result = await read();
      assert.equal(result.subscription.revision, "7");
      assert.equal(result.subscription.status, "past-due");
      assert.equal(result.subscription.cancelAtPeriodEnd, true);
      assert.equal(result.subscription.available, false);
      assert.equal(result.invoices.items.length, BILLING_LIMITS.maxInvoices);
      assert.deepEqual(
        result.invoices.items.map((invoice) => invoice.id),
        inserted.rows
          .sort(
            (left, right) => right.issuedAt.getTime() - left.issuedAt.getTime(),
          )
          .slice(0, BILLING_LIMITS.maxInvoices)
          .map((invoice) => invoice.id),
      );
      assert.ok(
        result.invoices.items.every(
          (invoice) =>
            invoice.amountMinor === "9007199254740993" &&
            invoice.period.startsAt === start.toISOString() &&
            invoice.period.endsAt === end.toISOString(),
        ),
      );
      assert.equal(JSON.stringify(result).includes(providerSuffix), false);
      for (const table of [
        "billing_workspaces",
        "billing_subscriptions",
        "billing_operations",
        "billing_invoices",
      ])
        assert.equal(
          (
            await runtime.query(
              `SELECT count(*)::int AS count FROM tholi.${table}`,
            )
          ).rows[0].count,
          0,
        );
      await migration.query(
        "INSERT INTO tholi.memberships(workspace_id,account_id,role) VALUES($1,$2,'admin')",
        [owner.workspaceId, stranger.accountId],
      );
      await withTransaction(
        runtime,
        async (client) => {
          for (const table of [
            "billing_workspaces",
            "billing_subscriptions",
            "billing_operations",
            "billing_invoices",
          ])
            assert.equal(
              (
                await client.query(
                  `SELECT count(*)::int AS count FROM tholi.${table}`,
                )
              ).rows[0].count,
              0,
            );
        },
        { accountId: stranger.accountId, workspaceId: owner.workspaceId },
      );
      await assert.rejects(
        () =>
          repositories.transaction(
            { accountId: stranger.accountId, workspaceId: owner.workspaceId },
            (scope) => scope.withBilling((billing) => billing.subscription()),
          ),
        { code: "FORBIDDEN" },
      );
      await repositories.transaction(owner, async (scope) =>
        assert.equal((await scope.creditBalance()).granted, 0n),
      );
      await migration.query(
        "UPDATE tholi.accounts SET status='deletion_pending' WHERE id=$1",
        [owner.accountId],
      );
      await assert.rejects(read, { code: "FORBIDDEN" });
      await withTransaction(
        runtime,
        async (client) =>
          assert.equal(
            (
              await client.query(
                "SELECT count(*)::int AS count FROM tholi.billing_invoices",
              )
            ).rows[0].count,
            0,
          ),
        owner,
      );
    },
  );
}
