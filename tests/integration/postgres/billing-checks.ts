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
      for (const version of [null, 0, 3])
        await assert.rejects(
          () =>
            migration.query("SELECT tholi.read_product_catalog($1::integer)", [
              version,
            ]),
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
      const invoiceIds = Array.from(
        { length: BILLING_LIMITS.maxInvoices + 3 },
        () => randomUUID(),
      );
      await migration.query(
        `INSERT INTO tholi.billing_invoices(workspace_id,id,mode,merchant_id,provider_invoice_id,subscription_id,plan_id,plan_version,catalog_version,status,amount_paid_minor,currency,period_start,period_end,issued_at)
      SELECT $1,id,'fake','acct_fixture','in_'||$2::text||'_'||n,$3,'paid-cloud',2,$4,'paid',9007199254740993,'usd',$5,$6,
        date_trunc('second',$8::timestamptz)+interval '0.123456 seconds'-n*interval '1 microsecond'
      FROM unnest($7::uuid[]) WITH ORDINALITY AS seeded(id,n)`,
        [
          owner.workspaceId,
          providerSuffix,
          subscriptionId,
          billingCatalogSeed.catalogVersion,
          start,
          end,
          invoiceIds,
          start,
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
        invoiceIds.slice(0, BILLING_LIMITS.maxInvoices),
      );
      assert.ok(result.invoices.nextCursor);
      const rest = await repositories.transaction(owner, (scope) =>
        scope.withBilling((billing) =>
          billing.invoices({
            limit: BILLING_LIMITS.maxInvoices,
            cursor: result.invoices.nextCursor,
          }),
        ),
      );
      assert.deepEqual(
        rest.items.map((invoice) => invoice.id),
        invoiceIds.slice(BILLING_LIMITS.maxInvoices),
      );
      assert.equal(rest.nextCursor, undefined);
      await assert.rejects(
        () =>
          repositories.transaction(stranger, (scope) =>
            scope.withBilling((billing) =>
              billing.invoices({
                limit: 1,
                cursor: result.invoices.nextCursor,
              }),
            ),
          ),
        { code: "INVALID_INPUT" },
      );
      const walked: string[] = [];
      let cursor: string | undefined;
      do {
        const page = await repositories.transaction(owner, (scope) =>
          scope.withBilling((billing) =>
            billing.invoices({ limit: 2, cursor }),
          ),
        );
        walked.push(...page.items.map((invoice) => invoice.id));
        cursor = page.nextCursor;
        assert.ok(walked.length <= invoiceIds.length);
      } while (cursor);
      assert.deepEqual(walked, invoiceIds);
      assert.equal(
        new Set(result.invoices.items.map((invoice) => invoice.issuedAt)).size,
        1,
        "Sub-millisecond database ordering cannot be reconstructed from public Dates.",
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
      // Additional members belong to an organization. Personal workspaces
      // retain the existing canonical-owner-only membership invariant.
      await migration.query(
        "UPDATE tholi.workspaces SET kind='organization' WHERE id=$1",
        [owner.workspaceId],
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
