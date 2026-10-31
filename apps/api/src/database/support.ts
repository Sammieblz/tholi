import type { Pool } from "pg";
import { z } from "zod";
import { jobErrorCodeSchema } from "../../../../packages/navigation-core/contracts-jobs";
import type { AuthorizationAction } from "../../../../packages/navigation-core/contracts-authorization";
import {
  evaluateAuthorization,
  readAuthorizationContext,
} from "../application/authorization-policy";
import type { JobLease } from "../application/job-contracts";
import type {
  ExternalOutcome,
  PreparedCleanup,
  SupportCommand,
  SupportStore,
} from "../application/support-contracts";
import { RepositoryError, type RepositoryScope } from "./contracts";
import { PostgresRepositories } from "./repositories";
import type { ScopedSupport } from "./support-queries";
import { withTransaction } from "./postgres";

/** HTTP and worker composition reuse the same scoped transaction and pool owner. */
export class PostgresSupport implements SupportStore {
  private readonly repositories: PostgresRepositories;
  constructor(private readonly pool: Pool) {
    this.repositories = new PostgresRepositories(pool);
  }

  private async scoped<T>(
    scope: RepositoryScope,
    work: (queries: ScopedSupport) => Promise<T>,
    signal?: AbortSignal,
    action: AuthorizationAction = "support.request",
    accountLock = false,
  ): Promise<T> {
    scope = Object.freeze({
      accountId: scope.accountId,
      workspaceId: scope.workspaceId,
    });
    signal?.throwIfAborted();
    return this.repositories.transaction(scope, async (owner) => {
      const context = await readAuthorizationContext(owner);
      const personalOnly =
        action === "support.request" || action === "diagnostics.export";
      if (
        !evaluateAuthorization(context, action).allowed ||
        (personalOnly &&
          (context.workspace?.kind !== "personal" ||
            context.workspace.ownerAccountId !== scope.accountId))
      )
        throw new RepositoryError(
          "FORBIDDEN",
          "The requested workspace is unavailable.",
        );
      const result = await owner.withSupport(work, personalOnly, accountLock);
      signal?.throwIfAborted();
      return result;
    });
  }

  submit(
    scope: RepositoryScope,
    command: SupportCommand,
    signal?: AbortSignal,
  ) {
    command = structuredClone(command);
    return this.scoped(scope, (queries) => queries.submit(command), signal);
  }

  requestDiagnostic(
    scope: RepositoryScope,
    input: { idempotencyKey: string; payloadHash: string; version: string },
    signal?: AbortSignal,
  ) {
    input = structuredClone(input);
    return this.scoped(
      scope,
      (queries) => queries.requestDiagnostic(input),
      signal,
    );
  }

  async getFile(scope: RepositoryScope, fileId: string, signal?: AbortSignal) {
    scope = Object.freeze({
      accountId: scope.accountId,
      workspaceId: scope.workspaceId,
    });
    z.string().uuid().parse(fileId);
    signal?.throwIfAborted();
    const workspaceId = await withTransaction(
      this.pool,
      async (client) =>
        (
          await client.query<{ workspaceId: string | null }>(
            'SELECT tholi.resolve_owned_file_workspace($1) AS "workspaceId"',
            [fileId],
          )
        ).rows[0]?.workspaceId,
      { accountId: scope.accountId },
    );
    signal?.throwIfAborted();
    if (!workspaceId)
      return this.scoped(scope, async () => null, signal, "files.read");
    return this.scoped(
      { accountId: scope.accountId, workspaceId },
      (queries) => queries.getFile(fileId),
      signal,
      "files.read",
    );
  }

  requestSavedExport(
    scope: RepositoryScope,
    raw: { idempotencyKey: string; payloadHash: string; ids: string[] },
    signal?: AbortSignal,
  ) {
    const input = structuredClone(raw);
    return this.scoped(
      scope,
      (queries) => queries.requestSavedExport(input),
      signal,
      "saved-data.export",
      true,
    );
  }

  async prepareExternal(lease: JobLease) {
    lease = structuredClone(lease);
    try {
      return await this.scoped(
        lease,
        (queries) => queries.prepareExternal(lease),
        undefined,
        [
          "file.saved-data-export",
          "file.account-export-part",
          "file.account-export-manifest",
        ].includes(lease.kind)
          ? "saved-data.export"
          : "support.request",
      );
    } catch (error) {
      if ((error as { code?: string }).code === "40001") return null;
      throw error;
    }
  }

  async authorizeExternal(
    lease: JobLease,
    attemptId: string,
  ): Promise<boolean> {
    lease = structuredClone(lease);
    z.string().uuid().parse(attemptId);
    if (
      ![
        "file.saved-data-export",
        "file.account-export-part",
        "file.account-export-manifest",
      ].includes(lease.kind) ||
      lease.version !== 1
    )
      return false;
    return (
      (
        await this.pool.query<{ allowed: boolean }>(
          lease.kind === "file.saved-data-export"
            ? "SELECT tholi.authorize_saved_export($1,$2,$3,$4) AS allowed"
            : "SELECT tholi.authorize_account_export($1,$2,$3,$4) AS allowed",
          [lease.workspaceId, lease.id, lease.leaseToken, attemptId],
        )
      ).rows[0]?.allowed === true
    );
  }

  async finishExternal(
    lease: JobLease,
    attemptId: string,
    outcome: ExternalOutcome,
  ): Promise<boolean> {
    lease = structuredClone(lease);
    outcome = structuredClone(outcome);
    z.string().uuid().parse(attemptId);
    if (
      !["committed", "retryable", "uncertain", "failed"].includes(
        outcome.status,
      ) ||
      !Number.isInteger(outcome.backoffMs) ||
      outcome.backoffMs < (outcome.status === "retryable" ? 1000 : 0) ||
      outcome.backoffMs > 60000
    )
      throw new RepositoryError(
        "INVALID_INPUT",
        "Use a bounded external outcome.",
      );
    if (outcome.code !== undefined) jobErrorCodeSchema.parse(outcome.code);
    try {
      return (
        await this.pool.query<{ changed: boolean }>(
          "SELECT tholi.finish_external_effect($1,$2,$3,$4,$5,$6,$7) AS changed",
          [
            lease.workspaceId,
            lease.id,
            lease.leaseToken,
            attemptId,
            outcome.status,
            outcome.code ?? null,
            outcome.backoffMs,
          ],
        )
      ).rows[0].changed;
    } catch (error) {
      if ((error as { code?: string }).code === "40001") return false;
      throw error;
    }
  }

  async prepareCleanup(lease: JobLease): Promise<PreparedCleanup | null> {
    lease = structuredClone(lease);
    if (
      lease.kind !== "file.expire" ||
      lease.version !== 1 ||
      Object.keys(lease.recordReferences).length !== 1 ||
      !lease.recordReferences.requestId
    )
      throw new RepositoryError(
        "INVALID_INPUT",
        "Use a registered expiry workflow.",
      );
    try {
      const result = await this.pool.query<{
        attempt_id: string;
        effect_id: string;
        command_hash: string;
        file_id: string;
        object_key: string;
      }>("SELECT * FROM tholi.prepare_file_cleanup($1,$2,$3)", [
        lease.workspaceId,
        lease.id,
        lease.leaseToken,
      ]);
      const row = result.rows[0];
      return row
        ? {
            attemptId: row.attempt_id,
            effectId: row.effect_id,
            commandHash: row.command_hash,
            file: { id: row.file_id, key: row.object_key },
          }
        : null;
    } catch (error) {
      if ((error as { code?: string }).code === "40001") return null;
      throw error;
    }
  }

  finishCleanup(lease: JobLease, attemptId: string, outcome: ExternalOutcome) {
    if (lease.kind !== "file.expire" || lease.version !== 1)
      throw new RepositoryError(
        "INVALID_INPUT",
        "Use a registered expiry workflow.",
      );
    return this.finishExternal(lease, attemptId, outcome);
  }

  async scheduleFileExpiry(input: {
    limit: number;
    intervalMs: number;
  }): Promise<number> {
    input = structuredClone(input);
    if (
      !Number.isInteger(input.limit) ||
      input.limit < 1 ||
      input.limit > 100 ||
      !Number.isInteger(input.intervalMs) ||
      input.intervalMs < 1000 ||
      input.intervalMs > 86400000
    )
      throw new RepositoryError(
        "INVALID_INPUT",
        "Use a bounded cleanup schedule.",
      );
    return (
      await this.pool.query<{ count: number }>(
        "SELECT tholi.schedule_file_expiry($1) AS count",
        [input.limit],
      )
    ).rows[0].count;
  }
}
