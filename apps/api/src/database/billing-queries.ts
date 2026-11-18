import type { PoolClient } from "pg";
import {
  billingInvoicesQuerySchema,
  billingSubscriptionSchema,
  billingInvoicesSchema,
  type BillingSubscription,
  type BillingInvoicesQuery,
} from "../../../../packages/navigation-core/contracts-billing";
import type { RepositoryScope } from "./contracts";
import { historyCursor, repositoryPage } from "./history-pages";

type SubscriptionRow = {
  revision: string;
  mode: BillingSubscription["mode"];
  status: BillingSubscription["status"] | null;
  planId: string | null;
  planVersion: number | null;
  startsAt: Date | null;
  endsAt: Date | null;
  cancelAtPeriodEnd: boolean | null;
  managedSpendingHeld: boolean;
  pendingStatus: "pending" | "ready" | "uncertain" | null;
};

/** Existing checked-out scope and RLS own access. These reads never grant service. */
export class ScopedBilling {
  constructor(
    private readonly client: Pick<PoolClient, "query">,
    private readonly scope: Readonly<RepositoryScope>,
  ) {}

  async subscription(): Promise<BillingSubscription> {
    const { rows } = await this.client.query<SubscriptionRow>(
      `SELECT b.revision::text,b.mode,s.status,s.plan_id AS "planId",s.plan_version AS "planVersion",
       s.period_start AS "startsAt",s.period_end AS "endsAt",s.cancel_at_period_end AS "cancelAtPeriodEnd",
       b.managed_spending_held AS "managedSpendingHeld",
       (SELECT o.status FROM tholi.billing_operations o WHERE o.workspace_id=b.workspace_id
         AND o.kind='checkout' AND o.status IN('pending','ready','uncertain')
         ORDER BY o.created_at DESC,o.id DESC LIMIT 1) AS "pendingStatus"
       FROM tholi.billing_workspaces b LEFT JOIN tholi.billing_subscriptions s
         ON s.workspace_id=b.workspace_id AND s.id=b.selected_subscription_id
       WHERE b.workspace_id=$1 AND b.account_id=$2`,
      [this.scope.workspaceId, this.scope.accountId],
    );
    const row = rows[0];
    return billingSubscriptionSchema.parse({
      version: 1,
      workspaceId: this.scope.workspaceId,
      revision: row?.revision ?? "0",
      mode: row?.mode ?? null,
      status:
        row?.status ??
        (row?.pendingStatus === "uncertain"
          ? "uncertain"
          : row?.pendingStatus
            ? "pending"
            : "none"),
      plan: row?.planId ? { id: row.planId, version: row.planVersion } : null,
      period:
        row?.startsAt && row.endsAt
          ? {
              startsAt: row.startsAt.toISOString(),
              endsAt: row.endsAt.toISOString(),
            }
          : null,
      cancelAtPeriodEnd: row?.cancelAtPeriodEnd ?? false,
      managedSpendingHeld: row?.managedSpendingHeld ?? false,
      // Composition must explicitly enable a negotiated development profile.
      available: false,
    });
  }

  async invoices(
    raw: BillingInvoicesQuery = billingInvoicesQuerySchema.parse({}),
  ) {
    const query = billingInvoicesQuerySchema.parse(raw),
      view = { kind: "invoices" as const, ...this.scope },
      cursor = historyCursor(query.cursor, view);
    const { rows } = await this.client.query<{
      id: string;
      status: string;
      amountMinor: string;
      currency: string;
      startsAt: Date;
      endsAt: Date;
      createdAt: Date;
      cursorTime: string;
    }>(
      `SELECT id,status,amount_paid_minor::text AS "amountMinor",currency,
       period_start AS "startsAt",period_end AS "endsAt",issued_at AS "createdAt",
       to_char(issued_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime"
       FROM tholi.billing_invoices WHERE workspace_id=$1
       AND ($2::timestamptz IS NULL OR (issued_at,id)<($2::timestamptz,$3::uuid))
       ORDER BY issued_at DESC,id DESC LIMIT $4`,
      [this.scope.workspaceId, ...cursor, query.limit + 1],
    );
    const page = repositoryPage(
      rows,
      query.limit,
      rows[Math.min(rows.length, query.limit) - 1]?.cursorTime,
      view,
    );
    return billingInvoicesSchema.parse({
      version: 1,
      nextCursor: page.nextCursor,
      items: page.items.map(
        ({
          startsAt,
          endsAt,
          createdAt,
          cursorTime: _cursorTime,
          ...invoice
        }) => ({
          ...invoice,
          period: {
            startsAt: startsAt.toISOString(),
            endsAt: endsAt.toISOString(),
          },
          issuedAt: createdAt.toISOString(),
        }),
      ),
    });
  }
}
