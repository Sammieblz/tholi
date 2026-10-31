import type { Pool } from "pg";
import type { AccountStore, AccountPrincipal } from "../application/account";
import type {
  AccountExportInput,
  AccountDeletionInput,
  AccountExportQuery,
} from "../../../../packages/navigation-core/contracts-account";
import { ACCOUNT_EXPORT_LIMITS } from "../../../../packages/navigation-core/contracts-account";
import { SUPPORT_LIMITS } from "../../../../packages/navigation-core/contracts-support";
import type { JobLease } from "../application/job-contracts";
import { PostgresRepositories, accountingError } from "./repositories";
import { withTransaction } from "./postgres";
import { RepositoryError } from "./contracts";
import {
  DEFAULT_ACCOUNT_EXPORT_BUDGET,
  type AccountExportBudget,
} from "./account-queries";

/** One personal account scope coordinates existing authorized workspace readers. */
export class PostgresAccount implements AccountStore {
  constructor(
    private readonly pool: Pool,
    private readonly repositories: PostgresRepositories,
    private readonly budget: AccountExportBudget = DEFAULT_ACCOUNT_EXPORT_BUDGET,
  ) {
    if (
      !Number.isInteger(budget.rows) ||
      budget.rows < 1 ||
      budget.rows > ACCOUNT_EXPORT_LIMITS.rows ||
      !Number.isInteger(budget.bytes) ||
      budget.bytes < SUPPORT_LIMITS.maxFileBytes ||
      budget.bytes > ACCOUNT_EXPORT_LIMITS.bytes ||
      !Number.isInteger(budget.parts) ||
      budget.parts < 1 ||
      budget.parts > ACCOUNT_EXPORT_LIMITS.parts ||
      !Number.isInteger(budget.pages) ||
      budget.pages < 1 ||
      budget.pages > 256
    )
      throw new Error("Invalid account export budget.");
  }
  private async personal(principal: AccountPrincipal, signal: AbortSignal) {
    signal.throwIfAborted();
    const accountId = principal.accountId;
    const result = await withTransaction(
      this.pool,
      (client) =>
        client.query<{ id: string }>(
          `SELECT w.id FROM tholi.workspaces w JOIN tholi.memberships m ON m.workspace_id=w.id AND m.account_id=$1
       JOIN tholi.accounts a ON a.id=m.account_id AND a.status='active' WHERE w.owner_account_id=$1 AND w.kind='personal'
       AND m.status='active' AND m.role='owner'`,
          [accountId],
        ),
      { accountId },
    );
    signal.throwIfAborted();
    if (!result.rows[0])
      throw new RepositoryError("FORBIDDEN", "The account is unavailable.");
    return { accountId, workspaceId: result.rows[0].id };
  }
  async prepareExport(
    raw: AccountPrincipal,
    input: AccountExportInput,
    signal: AbortSignal,
  ) {
    const principal = structuredClone(raw),
      scope = await this.personal(principal, signal);
    return this.repositories.transaction(scope, async (owner) => {
      const result = await owner.withAccount((queries) =>
        queries.prepareExport(input, principal.id, this.budget, signal),
      );
      signal.throwIfAborted();
      return result;
    });
  }
  async exportStatus(
    raw: AccountPrincipal,
    generation: string,
    signal: AbortSignal,
  ) {
    const principal = structuredClone(raw),
      scope = await this.personal(principal, signal);
    return this.repositories.transaction(scope, async (owner) => {
      const result = await owner.withAccount((queries) =>
        queries.exportStatus(generation),
      );
      signal.throwIfAborted();
      return result;
    });
  }
  async listExports(
    raw: AccountPrincipal,
    query: AccountExportQuery,
    signal: AbortSignal,
  ) {
    const principal = structuredClone(raw),
      scope = await this.personal(principal, signal);
    return this.repositories.transaction(scope, async (owner) => {
      const result = await owner.withAccount((queries) =>
        queries.listExports(query),
      );
      signal.throwIfAborted();
      return result;
    });
  }
  async requestDeletion(
    raw: AccountPrincipal,
    input: AccountDeletionInput,
    signal: AbortSignal,
  ) {
    const principal = structuredClone(raw),
      scope = await this.personal(principal, signal);
    try {
      return await this.repositories.transaction(scope, async (owner) => {
        const result = await owner.withAccount((queries) =>
          queries.requestDeletion(input, principal.id),
        );
        signal.throwIfAborted();
        return result;
      });
    } catch (error) {
      return accountingError(error);
    }
  }
  async cleanupDeletion(raw: JobLease, signal: AbortSignal): Promise<void> {
    const lease = structuredClone(raw);
    signal.throwIfAborted();
    if (lease.kind !== "account.delete" || lease.version !== 1)
      throw new RepositoryError(
        "FORBIDDEN",
        "The account cleanup lease is unavailable.",
      );
    await this.pool.query(
      "SELECT tholi.cleanup_account_deletion($1,$2,$3,$4,100)",
      [lease.workspaceId, lease.accountId, lease.id, lease.leaseToken],
    );
    signal.throwIfAborted();
  }
}
