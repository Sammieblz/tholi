import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import {
  savedTaskSchema,
  type SavedTask,
} from "../../../../packages/page-model";
import { parameterizedTask } from "../../../../packages/navigation-core/privacy";
import {
  savedDataRecordSchema,
  savedDataMutationSchema,
  savedDataDeleteInputSchema,
  savedDataImportInputSchema,
  savedDataListQuerySchema,
  savedDataExportInputSchema,
  savedDataImportHash,
  type SavedDataRecord,
  type SavedDataMutation,
  type SavedDataDeleteInput,
  type SavedDataImportInput,
  type SavedDataImportResult,
  type SavedDataListQuery,
  type SavedDataPage,
  type SavedDataChanges,
} from "../../../../packages/navigation-core/contracts-saved-data";
import {
  productCatalogSchema,
  effectiveProductPlanSchema,
  freeEnrollmentSchema,
  type ProductCatalog,
  type EffectiveProductPlan,
  type FreeEnrollment,
} from "../../../../packages/navigation-core/contracts-plans";
import { withTransaction, databaseObservability } from "./postgres";
import { appendSecurityAudit } from "./audit";
import {
  correlationSchema,
  type Observability,
} from "../application/observability";
import {
  PRODUCT_ANALYTICS_LIMITS,
  recordProductEventInputSchema,
  type RecordProductEventInput,
  type ProductAnalyticsRecord,
} from "../../../../packages/navigation-core/contracts-analytics";
import { pruneExpiredIdentityBrokers } from "./identity-retention";
import { ScopedSupport } from "./support-queries";
import type { JobLease, JobTransaction } from "../application/job-contracts";
import {
  jobResultSchema,
  type JobResult,
} from "../../../../packages/navigation-core/contracts-jobs";
import {
  RepositoryError,
  type Account,
  type ArtifactPage,
  type Consent,
  type CreditBalance,
  type CreditGrant,
  type CreditReservation,
  type CreditSettlement,
  type CreditHistoryEntry,
  type FinishInferenceInput,
  type InferencePolicy,
  type InferenceReservation,
  type InferenceUsage,
  type RepositoryPage,
  type Entitlement,
  type Job,
  type Membership,
  type OutboxEntry,
  type PlanVersion,
  type RecordReferences,
  type RepositoryScope,
  type RequestStatus,
  type SavedArtifact,
  type ServiceRequest,
  type UsageRecord,
  type Workspace,
} from "./contracts";

type Int8Row<T, K extends keyof T> = Omit<T, K> & Record<K, string>;
type ArtifactRow = Int8Row<SavedArtifact, "revision" | "syncRevision">;
type StoredArtifactRow = Omit<ArtifactRow, "kind" | "content"> & {
  kind: string;
  content: unknown;
  formatVersion: 1 | 2;
  metadata: unknown;
  createdAt: Date;
  updatedAt: Date;
};
type ReservationRow = Int8Row<CreditReservation, "amount">;
const maxInt8 = 9223372036854775807n;
const artifactColumns = `id, owner_account_id AS "ownerAccountId", kind, content,
  revision::text, sync_revision::text AS "syncRevision", deleted_at AS "deletedAt"`;
const storedArtifactColumns = `${artifactColumns},format_version AS "formatVersion",metadata,
  created_at AS "createdAt",updated_at AS "updatedAt"`;
const requestColumns = `id, operation, idempotency_key AS "idempotencyKey",
  encode(payload_hash, 'hex') AS "payloadHash", status`;
const reservationColumns = `id, request_id AS "requestId", amount::text,
  status, expires_at AS "expiresAt"`;
const jobColumns = `id, account_id AS "accountId", request_id AS "requestId",
  kind, version, record_references AS "recordReferences", status,
  available_at AS "availableAt", max_attempts AS "maxAttempts",revision::text,attempts,
  (cancel_requested_at IS NOT NULL) AS "cancelRequested",last_error_code AS "errorCode",
  CASE WHEN result_count IS NULL THEN NULL ELSE jsonb_build_object('processed',result_count) END AS result,
  created_at AS "createdAt",updated_at AS "updatedAt"`;
type JobRow = Int8Row<Job, "revision">;
const job = (row: JobRow): Job => ({ ...row, revision: BigInt(row.revision) });
class JobLeaseLost extends Error {}

function invalid(message: string): never {
  throw new RepositoryError("INVALID_INPUT", message);
}

function conflict(): never {
  throw new RepositoryError(
    "CONFLICT",
    "The record is unavailable or has changed.",
  );
}

function replayConflict(): never {
  throw new RepositoryError(
    "IDEMPOTENCY_CONFLICT",
    "The operation key was already used for a different command.",
  );
}

function integer(value: bigint, minimum = 0n) {
  if (typeof value !== "bigint" || value < minimum || value > maxInt8)
    invalid("Use an integer within the supported database range.");
  return value.toString();
}

function text(value: string, maximum: number) {
  if (typeof value !== "string" || !value.trim() || value.length > maximum)
    invalid("A required identifier is missing or too long.");
  return value;
}

function timestamp(value: Date) {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime()))
    invalid("Use a valid timestamp.");
  return value.toISOString();
}

function limit(value = 50) {
  if (!Number.isInteger(value) || value < 1 || value > 100)
    invalid("Page size must be between 1 and 100.");
  return value;
}

function snapshot<T>(input: T): T {
  try {
    return structuredClone(input);
  } catch {
    return invalid("Use plain command data and valid timestamps.");
  }
}

function artifact(row: ArtifactRow): SavedArtifact {
  return {
    id: row.id,
    ownerAccountId: row.ownerAccountId,
    kind: row.kind,
    content: row.content,
    deletedAt: row.deletedAt,
    revision: BigInt(row.revision),
    syncRevision: BigInt(row.syncRevision),
  };
}

function savedDataRecord(row: StoredArtifactRow): SavedDataRecord {
  return savedDataRecordSchema.parse({
    id: row.id,
    schemaVersion: 1,
    kind: row.kind,
    data: row.content,
    metadata: row.metadata,
    revision: row.revision,
    syncRevision: row.syncRevision,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    deletedAt: row.deletedAt?.toISOString() ?? null,
  });
}

function reservation(row: ReservationRow): CreditReservation {
  return { ...row, amount: BigInt(row.amount) };
}

function accountingError(error: unknown): never {
  const code = (error as { code?: string }).code;
  const codes: Partial<Record<string, RepositoryError["code"]>> = {
    P4401: "QUOTA_EXCEEDED",
    P4402: "INSUFFICIENT_CREDITS",
    P4403: "CONFLICT",
    P4404: "IDEMPOTENCY_CONFLICT",
    P4405: "INFERENCE_DISABLED",
    "42501": "FORBIDDEN",
    "22023": "INVALID_INPUT",
  };
  const mapped = code ? codes[code] : undefined;
  if (mapped)
    throw new RepositoryError(
      mapped,
      "The accounting operation is unavailable or exceeds its original policy.",
    );
  throw error;
}

function historyCursor(value?: string): [string | null, string | null] {
  if (!value) return [null, null];
  try {
    if (value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) throw Error();
    const parsed: unknown = JSON.parse(
      Buffer.from(value, "base64url").toString("utf8"),
    );
    if (
      !Array.isArray(parsed) ||
      parsed.length !== 2 ||
      typeof parsed[0] !== "string" ||
      typeof parsed[1] !== "string" ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3,6}Z$/.test(parsed[0]) ||
      !Number.isFinite(Date.parse(parsed[0])) ||
      !/^[a-f0-9]{8}(-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(parsed[1])
    )
      throw Error();
    return [parsed[0], parsed[1]];
  } catch {
    return invalid("Use the opaque history cursor returned by the service.");
  }
}
function repositoryPage<T extends { id: string; createdAt: Date }>(
  rows: T[],
  size: number,
  cursorTime?: string,
): RepositoryPage<T> {
  const more = rows.length > size,
    items = rows.slice(0, size),
    last = items.at(-1);
  return {
    items,
    ...(more && last
      ? {
          nextCursor: Buffer.from(
            JSON.stringify([
              cursorTime ?? last.createdAt.toISOString(),
              last.id,
            ]),
          ).toString("base64url"),
        }
      : {}),
  };
}
type InferenceUsageRow = Omit<
  InferenceUsage,
  "inputUnits" | "outputUnits" | "providerUsdMicros" | "chargedCredits"
> & {
  inputUnits: string | null;
  outputUnits: string | null;
  providerUsdMicros: string | null;
  chargedCredits: string | null;
};
type InferencePolicyRow = Int8Row<
  InferencePolicy,
  | "maxCredits"
  | "maxProviderUsdMicros"
  | "accountProviderUsdMicros"
  | "workspaceProviderUsdMicros"
  | "journeyProviderUsdMicros"
>;
const inferenceUsage = (row: InferenceUsageRow): InferenceUsage => ({
  ...row,
  inputUnits: row.inputUnits === null ? null : BigInt(row.inputUnits),
  outputUnits: row.outputUnits === null ? null : BigInt(row.outputUnits),
  providerUsdMicros:
    row.providerUsdMicros === null ? null : BigInt(row.providerUsdMicros),
  chargedCredits:
    row.chargedCredits === null ? null : BigInt(row.chargedCredits),
});

/** Pool lifetime belongs to the runtime. Callbacks contain database work only. */
export class PostgresRepositories {
  constructor(private readonly pool: Pool) {}

  async readPlanCatalog(): Promise<ProductCatalog> {
    const result = await this.pool.query<{ catalog: unknown }>(
      "SELECT tholi.read_product_catalog() AS catalog",
    );
    return productCatalogSchema.parse(result.rows[0]?.catalog);
  }

  async refillFreePlans(input: { limit: number }): Promise<number> {
    input = snapshot(input);
    try {
      return (
        await this.pool.query<{ refilled: number }>(
          "SELECT tholi.refill_free_plans($1) AS refilled",
          [limit(input.limit)],
        )
      ).rows[0].refilled;
    } catch (error) {
      return accountingError(error);
    }
  }

  /** A persisted receipt makes a known outcome recoverable after an accounting outage. */
  async finishInference(raw: FinishInferenceInput): Promise<InferenceUsage> {
    const input = snapshot(raw);
    const values = [
      input.id,
      input.claimToken,
      input.resolution,
      input.outcome,
      input.inputUnits === undefined ? null : integer(input.inputUnits),
      input.outputUnits === undefined ? null : integer(input.outputUnits),
      input.providerUsdMicros === undefined
        ? null
        : integer(input.providerUsdMicros),
      input.chargedCredits === undefined ? null : integer(input.chargedCredits),
      input.providerRequestId === undefined
        ? null
        : text(input.providerRequestId, 200),
    ];
    try {
      if (input.resolution !== "unknown")
        await withTransaction(this.pool, (client) =>
          client.query(
            "SELECT tholi.record_inference_outcome($1,$2,$3,$4,$5,$6,$7,$8,$9)",
            values,
          ),
        );
      return await withTransaction(this.pool, async (client) => {
        await client.query(
          "SELECT tholi.finish_inference($1,$2,$3,$4,$5,$6,$7,$8,$9)",
          values,
        );
        const result = await client.query<InferenceUsageRow>(
          "SELECT * FROM tholi.inference_usage($1,$2)",
          [input.id, input.claimToken],
        );
        if (!result.rows[0]) conflict();
        return inferenceUsage(result.rows[0]);
      });
    } catch (error) {
      return accountingError(error);
    }
  }

  async refundInference(raw: {
    id: string;
    claimToken: string;
    idempotencyKey: string;
    amount: bigint;
  }) {
    const input = snapshot(raw);
    try {
      const result = await withTransaction(this.pool, (client) =>
        client.query<{ id: string; settlementId: string; amount: string }>(
          'SELECT id,settlement_id AS "settlementId",amount FROM tholi.refund_inference($1,$2,$3,$4)',
          [
            input.id,
            input.claimToken,
            text(input.idempotencyKey, 200),
            integer(input.amount, 1n),
          ],
        ),
      );
      return { ...result.rows[0], amount: BigInt(result.rows[0].amount) };
    } catch (error) {
      return accountingError(error);
    }
  }

  async scheduleInferenceReconciliation(raw: {
    limit: number;
    intervalMs: number;
  }): Promise<number> {
    const input = snapshot(raw);
    if (
      !Number.isInteger(input.intervalMs) ||
      input.intervalMs < 1000 ||
      input.intervalMs > 86400000
    )
      invalid("Use a bounded reconciliation interval.");
    return (
      await this.pool.query<{ scheduled: number }>(
        "SELECT tholi.schedule_inference_reconciliation($1,$2) AS scheduled",
        [limit(input.limit), input.intervalMs],
      )
    ).rows[0].scheduled;
  }

  async reconcileInference(raw: JobLease): Promise<JobResult> {
    const lease = snapshot(raw);
    if (lease.kind !== "inference.reconcile" || lease.version !== 1)
      invalid("Use the registered accounting handler.");
    try {
      return await withTransaction(
        this.pool,
        async (client) =>
          (
            await client.query<JobResult>(
              "SELECT * FROM tholi.reconcile_inference($1,$2,$3,$4)",
              [lease.workspaceId, lease.accountId, lease.id, lease.leaseToken],
            )
          ).rows[0],
      );
    } catch (error) {
      return accountingError(error);
    }
  }

  /** Internal provisioning only; authentication and linking are implemented in #30. */
  async provisionAccount(
    input: RepositoryScope = {
      accountId: randomUUID(),
      workspaceId: randomUUID(),
    },
  ): Promise<RepositoryScope> {
    input = snapshot(input);
    return withTransaction(this.pool, (client) =>
      provisionAccountOnClient(client, input),
    );
  }

  async listWorkspaces(
    accountId: string,
    options: { after?: string; limit?: number } = {},
  ): Promise<Workspace[]> {
    options = snapshot(options);
    return withTransaction(
      this.pool,
      async (client) => {
        const result = await client.query<Int8Row<Workspace, "revision">>(
          `SELECT w.id, w.kind, w.owner_account_id AS "ownerAccountId", w.revision::text
         FROM tholi.workspaces w JOIN tholi.memberships m
          ON m.workspace_id = w.id AND m.account_id = $1
         WHERE m.status = 'active' AND ($2::uuid IS NULL OR w.id > $2)
         ORDER BY w.id LIMIT $3`,
          [accountId, options.after ?? null, limit(options.limit)],
        );
        return result.rows.map((row) => ({
          ...row,
          revision: BigInt(row.revision),
        }));
      },
      { accountId },
    );
  }

  async transaction<T>(
    scope: RepositoryScope,
    work: (repositories: ScopedRepositories) => Promise<T>,
  ): Promise<T> {
    const authorizedScope = Object.freeze({ ...scope });
    try {
      return await withTransaction(
        this.pool,
        async (client) => {
          const membership = await client.query(
            `SELECT 1 FROM tholi.memberships m
           JOIN tholi.accounts a ON a.id = m.account_id
           WHERE m.workspace_id = $1 AND m.account_id = $2
             AND m.status = 'active' AND a.status = 'active'`,
            [authorizedScope.workspaceId, authorizedScope.accountId],
          );
          if (!membership.rowCount)
            throw new RepositoryError(
              "FORBIDDEN",
              "The workspace is unavailable.",
            );
          let active = true;
          const capability: Pick<PoolClient, "query"> = {
            query: ((...args: unknown[]) => {
              if (!active)
                throw new RepositoryError(
                  "CONFLICT",
                  "The database transaction is no longer active.",
                );
              return Reflect.apply(client.query, client, args);
            }) as PoolClient["query"],
          };
          try {
            // Callers await all work. Later continuations cannot reuse this client.
            return await work(
              new ScopedRepositories(
                capability,
                authorizedScope,
                databaseObservability(this.pool),
              ),
            );
          } finally {
            active = false;
          }
        },
        authorizedScope,
      );
    } catch (error) {
      if ((error as { code?: string }).code === "42501")
        throw new RepositoryError("FORBIDDEN", "The workspace is unavailable.");
      throw error;
    }
  }

  async runJob(
    lease: JobLease,
    work: (transaction: JobTransaction) => Promise<JobResult>,
  ): Promise<boolean> {
    lease = snapshot(lease);
    try {
      return await this.transaction(lease, (scoped) =>
        scoped.runJob(lease, work),
      );
    } catch (error) {
      if (error instanceof JobLeaseLost) return false;
      throw error;
    }
  }
}

/** Identity linking and operator seeding share the same atomic provisioning. */
export async function provisionAccountOnClient(
  client: PoolClient,
  input: RepositoryScope,
): Promise<RepositoryScope> {
  await client.query("SELECT tholi.provision_personal_account($1,$2)", [
    input.accountId,
    input.workspaceId,
  ]);
  return { ...input };
}

/** Created by PostgresRepositories.transaction, on its checked-out connection. */
class ScopedRepositories {
  constructor(
    private readonly client: Pick<PoolClient, "query">,
    private readonly scope: Readonly<RepositoryScope>,
    private readonly observer: Observability,
  ) {}

  private get parameters() {
    return [this.scope.workspaceId, this.scope.accountId];
  }

  async withSupport<T>(
    work: (queries: ScopedSupport) => Promise<T>,
    ownerOnly = true,
    accountLock = false,
  ): Promise<T> {
    if (accountLock) await this.lockAccount();
    await this.lockWorkspace(ownerOnly);
    return work(new ScopedSupport(this.client, this.scope, this));
  }

  // Credits and sync stamps share this lock order: workspace, then domain row.
  private async lockWorkspace(ownerOnly = false) {
    const found = await this.client.query(
      `SELECT w.id FROM tholi.workspaces w
       WHERE w.id = $1 AND (NOT $3::boolean OR w.owner_account_id = $2)
         AND EXISTS (SELECT 1 FROM tholi.memberships m
           WHERE m.workspace_id = w.id AND m.account_id = $2 AND m.status = 'active')
       FOR UPDATE OF w`,
      [...this.parameters, ownerOnly],
    );
    if (!found.rowCount)
      throw new RepositoryError("FORBIDDEN", "The workspace is unavailable.");
  }

  private async lockAccount() {
    const result = await this.client.query(
      "SELECT id FROM tholi.accounts WHERE id=$1 AND status='active' FOR UPDATE",
      [this.scope.accountId],
    );
    if (!result.rowCount)
      throw new RepositoryError("FORBIDDEN", "The account is unavailable.");
  }

  async readEffectivePlan(): Promise<EffectiveProductPlan | null> {
    const result = await this.client.query<{ effective: unknown }>(
      "SELECT tholi.read_effective_product_plan() AS effective",
    );
    return effectiveProductPlanSchema
      .nullable()
      .parse(result.rows[0]?.effective);
  }

  async enrollFree(): Promise<FreeEnrollment> {
    try {
      const result = await this.client.query<{ enrollment: unknown }>(
        "SELECT tholi.enroll_free() AS enrollment",
      );
      return freeEnrollmentSchema.parse(result.rows[0]?.enrollment);
    } catch (error) {
      return accountingError(error);
    }
  }

  async getAccount(): Promise<Account> {
    const result = await this.client.query<Int8Row<Account, "revision">>(
      "SELECT id, status, revision::text FROM tholi.accounts WHERE id = $1",
      [this.scope.accountId],
    );
    if (!result.rows[0]) conflict();
    return { ...result.rows[0], revision: BigInt(result.rows[0].revision) };
  }

  async getWorkspace(): Promise<Workspace> {
    const result = await this.client.query<Int8Row<Workspace, "revision">>(
      `SELECT id,kind,owner_account_id AS "ownerAccountId",revision::text
       FROM tholi.workspaces WHERE id = $1`,
      [this.scope.workspaceId],
    );
    if (!result.rows[0])
      throw new RepositoryError("FORBIDDEN", "The workspace is unavailable.");
    return { ...result.rows[0], revision: BigInt(result.rows[0].revision) };
  }

  async listMemberships(
    options: { after?: string; limit?: number } = {},
  ): Promise<Membership[]> {
    options = snapshot(options);
    const result = await this.client.query<Int8Row<Membership, "revision">>(
      `SELECT account_id AS "accountId",role,status,revision::text FROM tholi.memberships
       WHERE workspace_id = $1 AND ($2::uuid IS NULL OR account_id > $2)
       ORDER BY account_id LIMIT $3`,
      [this.scope.workspaceId, options.after ?? null, limit(options.limit)],
    );
    return result.rows.map((row) => ({
      ...row,
      revision: BigInt(row.revision),
    }));
  }

  async getMembership(
    accountId = this.scope.accountId,
  ): Promise<Membership | undefined> {
    const result = await this.client.query<Int8Row<Membership, "revision">>(
      `SELECT account_id AS "accountId", role, status, revision::text
       FROM tholi.memberships WHERE workspace_id = $1 AND account_id = $2`,
      [this.scope.workspaceId, accountId],
    );
    const row = result.rows[0];
    return row && { ...row, revision: BigInt(row.revision) };
  }

  async setMembership(input: {
    accountId: string;
    role: Membership["role"];
    status: Membership["status"];
    expectedRevision: bigint;
  }): Promise<Membership> {
    input = snapshot(input);
    await this.lockWorkspace(true);
    integer(input.expectedRevision);
    const workspace = await this.getWorkspace();
    if (
      workspace.kind === "personal" ||
      input.accountId === workspace.ownerAccountId ||
      input.role === "owner"
    )
      invalid(
        "Membership changes must preserve canonical workspace ownership.",
      );
    const result =
      input.expectedRevision === 0n
        ? await this.client.query<Int8Row<Membership, "revision">>(
            `INSERT INTO tholi.memberships (workspace_id, account_id, role, status)
           VALUES ($1, $2, $3, $4) ON CONFLICT DO NOTHING
           RETURNING account_id AS "accountId", role, status, revision::text`,
            [this.scope.workspaceId, input.accountId, input.role, input.status],
          )
        : await this.client.query<Int8Row<Membership, "revision">>(
            `UPDATE tholi.memberships SET role = $3, status = $4,
             revision = revision + 1, updated_at = now()
           WHERE workspace_id = $1 AND account_id = $2 AND revision = $5
           RETURNING account_id AS "accountId", role, status, revision::text`,
            [
              this.scope.workspaceId,
              input.accountId,
              input.role,
              input.status,
              input.expectedRevision.toString(),
            ],
          );
    if (!result.rows[0]) conflict();
    const membership = {
      ...result.rows[0],
      revision: BigInt(result.rows[0].revision),
    };
    await appendSecurityAudit(
      this.client,
      {
        ...this.scope,
        kind: "membership.changed",
        subjectId: membership.accountId,
        details: {
          role: membership.role as "admin" | "member",
          status: membership.status,
          revision: membership.revision.toString(),
        },
      },
      this.observer,
    );
    return membership;
  }

  async getConsent(purpose: string): Promise<Consent | undefined> {
    const result = await this.client.query<Int8Row<Consent, "revision">>(
      `SELECT id, purpose, policy_version AS "policyVersion", granted, revision::text
       FROM tholi.consents WHERE workspace_id = $1 AND account_id = $2 AND purpose = $3`,
      [...this.parameters, text(purpose, 100)],
    );
    const row = result.rows[0];
    return row && { ...row, revision: BigInt(row.revision) };
  }

  async listConsents(): Promise<Consent[]> {
    const result = await this.client.query<Int8Row<Consent, "revision">>(
      `SELECT id,purpose,policy_version AS "policyVersion",granted,revision::text
       FROM tholi.consents WHERE workspace_id = $1 AND account_id = $2 ORDER BY purpose LIMIT 100`,
      this.parameters,
    );
    return result.rows.map((row) => ({
      ...row,
      revision: BigInt(row.revision),
    }));
  }

  async recordConsent(input: {
    purpose: string;
    policyVersion: string;
    granted: boolean;
    expectedRevision: bigint;
  }): Promise<Consent> {
    input = snapshot(input);
    integer(input.expectedRevision);
    // Match saved-data admission before locking consent. The audit's foreign
    // keys must not invert account/workspace locks during withdrawal.
    await this.lockAccount();
    await this.lockWorkspace();
    const parameters = [
      ...this.parameters,
      text(input.purpose, 100),
      text(input.policyVersion, 100),
      input.granted,
    ];
    const columns = `id, purpose, policy_version AS "policyVersion", granted, revision::text`;
    const result =
      input.expectedRevision === 0n
        ? await this.client.query<Int8Row<Consent, "revision">>(
            `INSERT INTO tholi.consents
             (workspace_id, account_id, purpose, policy_version, granted, id)
           VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING ${columns}`,
            [...parameters, randomUUID()],
          )
        : await this.client.query<Int8Row<Consent, "revision">>(
            `UPDATE tholi.consents SET policy_version = CASE WHEN $5 THEN $4 ELSE policy_version END, granted = $5,
             revision = revision + 1, updated_at = now()
           WHERE workspace_id = $1 AND account_id = $2 AND purpose = $3 AND revision = $6
           RETURNING ${columns}`,
            [...parameters, input.expectedRevision.toString()],
          );
    if (!result.rows[0]) conflict();
    const consent = {
      ...result.rows[0],
      revision: BigInt(result.rows[0].revision),
    };
    await appendSecurityAudit(
      this.client,
      {
        ...this.scope,
        kind: "consent.changed",
        subjectId: consent.id,
        details: {
          purpose: consent.purpose,
          policyVersion: consent.policyVersion,
          granted: consent.granted,
          revision: consent.revision.toString(),
        },
      },
      this.observer,
    );
    return consent;
  }

  async recordProductEvent(
    command: RecordProductEventInput,
  ): Promise<{ recorded: boolean }> {
    const input = recordProductEventInputSchema.parse(command);
    // Lock order matches consent withdrawal. Both retain the membership and
    // consent locks through commit, so no event can commit after withdrawal.
    const admission = await this.client.query<{ allowed: boolean }>(
      "SELECT tholi.lock_product_analytics_consent() AS allowed",
    );
    if (!admission.rows[0].allowed)
      throw new RepositoryError(
        "FORBIDDEN",
        "Current product analytics consent is required.",
      );
    const existing = (
      await this.client.query<{ event: unknown }>(
        `SELECT event FROM tholi.product_events
      WHERE workspace_id=$1 AND account_id=$2 AND event_id=$3`,
        [...this.parameters, input.eventId],
      )
    ).rows[0];
    if (existing) {
      if (!isDeepStrictEqual(existing.event, input.event)) replayConflict();
      return { recorded: false };
    }
    const count = (
      await this.client.query<{ count: number }>(
        `SELECT count(*)::integer AS count FROM tholi.product_events
      WHERE workspace_id=$1 AND account_id=$2 AND recorded_at>clock_timestamp()-interval '1 day'`,
        this.parameters,
      )
    ).rows[0].count;
    if (count >= PRODUCT_ANALYTICS_LIMITS.dailyEvents)
      throw new RepositoryError(
        "RATE_LIMITED",
        "The product event budget is exhausted.",
      );
    await this.client.query(
      `INSERT INTO tholi.product_events(workspace_id,account_id,event_id,schema_version,event)
      VALUES($1,$2,$3,$4,$5::jsonb)`,
      [
        ...this.parameters,
        input.eventId,
        input.schemaVersion,
        JSON.stringify(input.event),
      ],
    );
    return { recorded: true };
  }

  async listProductEvents(options: {
    after?: string;
    limit: number;
  }): Promise<
    (Omit<ProductAnalyticsRecord, "recordedAt"> & { recordedAt: Date })[]
  > {
    options = snapshot(options);
    return (
      await this.client.query<
        Omit<ProductAnalyticsRecord, "recordedAt"> & { recordedAt: Date }
      >(
        `SELECT event_id AS "eventId",schema_version AS "schemaVersion",event,recorded_at AS "recordedAt"
      FROM tholi.product_events WHERE workspace_id=$1 AND account_id=$2 AND expires_at>clock_timestamp()
      AND ($3::uuid IS NULL OR event_id>$3) ORDER BY event_id LIMIT $4`,
        [...this.parameters, options.after ?? null, limit(options.limit)],
      )
    ).rows;
  }

  async deleteProductEvents(): Promise<bigint> {
    const result = await this.client.query(
      "DELETE FROM tholi.product_events WHERE workspace_id=$1 AND account_id=$2",
      this.parameters,
    );
    return BigInt(result.rowCount ?? 0);
  }

  async beginRequest(input: {
    id?: string;
    operation: string;
    idempotencyKey: string;
    payloadHash: string;
  }): Promise<{ request: ServiceRequest; replayed: boolean }> {
    input = snapshot(input);
    if (!/^[a-f0-9]{64}$/i.test(input.payloadHash))
      invalid("Use the canonical command's SHA-256 hash.");
    const values = [
      ...this.parameters,
      text(input.operation, 100),
      text(input.idempotencyKey, 200),
      input.payloadHash.toLowerCase(),
      input.id || randomUUID(),
    ];
    const inserted = await this.client.query<ServiceRequest>(
      `INSERT INTO tholi.requests
         (workspace_id, account_id, operation, idempotency_key, payload_hash, id)
       VALUES ($1, $2, $3, $4, decode($5, 'hex'), $6)
       ON CONFLICT DO NOTHING RETURNING ${requestColumns}`,
      values,
    );
    if (inserted.rows[0]) return { request: inserted.rows[0], replayed: false };
    const existing = await this.client.query<ServiceRequest>(
      `SELECT ${requestColumns} FROM tholi.requests
       WHERE workspace_id = $1 AND account_id = $2 AND operation = $3 AND idempotency_key = $4`,
      values.slice(0, 4),
    );
    if (!existing.rows[0]) conflict();
    if (existing.rows[0].payloadHash !== input.payloadHash.toLowerCase())
      replayConflict();
    return { request: existing.rows[0], replayed: true };
  }

  async getRequest(id: string): Promise<ServiceRequest | undefined> {
    return (
      await this.client.query<ServiceRequest>(
        `SELECT ${requestColumns} FROM tholi.requests
       WHERE workspace_id = $1 AND account_id = $2 AND id = $3`,
        [...this.parameters, id],
      )
    ).rows[0];
  }

  async setRequestStatus(
    id: string,
    status: Exclude<RequestStatus, "pending">,
    expectedStatus?: RequestStatus,
  ): Promise<ServiceRequest> {
    const result = await this.client.query<ServiceRequest>(
      `UPDATE tholi.requests SET status = $4, updated_at = now()
       WHERE workspace_id = $1 AND account_id = $2 AND id = $3
         AND (($5::text IS NULL AND (status IN ('pending', 'uncertain') OR status = $4))
           OR status = $5)
       RETURNING ${requestColumns}`,
      [...this.parameters, id, status, expectedStatus ?? null],
    );
    if (!result.rows[0]) conflict();
    return result.rows[0];
  }

  async publishPlanVersion(input: PlanVersion): Promise<PlanVersion> {
    input = snapshot(input);
    await this.lockWorkspace(true);
    text(input.planId, 100);
    text(input.name, 200);
    if (!Number.isInteger(input.version) || input.version <= 0)
      invalid("Use a positive catalog version.");
    if (
      !input.definition ||
      typeof input.definition !== "object" ||
      Array.isArray(input.definition)
    )
      invalid("Use a catalog definition object.");
    const definition = JSON.parse(JSON.stringify(input.definition)) as Record<
      string,
      unknown
    >;
    await this.client.query(
      `INSERT INTO tholi.plan_versions (plan_id, version, name, definition)
       VALUES ($1, $2, $3, $4::jsonb) ON CONFLICT DO NOTHING`,
      [input.planId, input.version, input.name, JSON.stringify(definition)],
    );
    const existing = await this.getPlanVersion(input.planId, input.version);
    if (
      !existing ||
      existing.name !== input.name ||
      !isDeepStrictEqual(existing.definition, definition)
    )
      replayConflict();
    return existing;
  }

  async getPlanVersion(
    planId: string,
    version: number,
  ): Promise<PlanVersion | undefined> {
    return (
      await this.client.query<PlanVersion>(
        `SELECT plan_id AS "planId", version, name, definition
       FROM tholi.plan_versions WHERE plan_id = $1 AND version = $2`,
        [planId, version],
      )
    ).rows[0];
  }

  async putEntitlement(
    input: Omit<Entitlement, "revision"> & { expectedRevision: bigint },
  ): Promise<Entitlement> {
    input = snapshot(input);
    await this.lockWorkspace(true);
    integer(input.expectedRevision);
    const columns = `id, plan_id AS "planId", plan_version AS "planVersion", status,
      starts_at AS "startsAt", ends_at AS "endsAt", revision::text`;
    const values = [
      this.scope.workspaceId,
      input.id,
      input.planId,
      input.planVersion,
      input.status,
      timestamp(input.startsAt),
      input.endsAt ? timestamp(input.endsAt) : null,
    ];
    const result =
      input.expectedRevision === 0n
        ? await this.client.query<Int8Row<Entitlement, "revision">>(
            `INSERT INTO tholi.entitlements
             (workspace_id, id, plan_id, plan_version, status, starts_at, ends_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING RETURNING ${columns}`,
            values,
          )
        : await this.client.query<Int8Row<Entitlement, "revision">>(
            `UPDATE tholi.entitlements SET plan_id = $3, plan_version = $4, status = $5,
             starts_at = $6, ends_at = $7, revision = revision + 1, updated_at = now()
           WHERE workspace_id = $1 AND id = $2 AND revision = $8 RETURNING ${columns}`,
            [...values, input.expectedRevision.toString()],
          );
    if (!result.rows[0]) conflict();
    return { ...result.rows[0], revision: BigInt(result.rows[0].revision) };
  }

  async listEntitlements(
    options: { after?: string; limit?: number } = {},
  ): Promise<Entitlement[]> {
    const result = await this.client.query<Int8Row<Entitlement, "revision">>(
      `SELECT id, plan_id AS "planId", plan_version AS "planVersion", status,
         starts_at AS "startsAt", ends_at AS "endsAt", revision::text
       FROM tholi.entitlements WHERE workspace_id = $1 AND ($2::uuid IS NULL OR id > $2)
       ORDER BY id LIMIT $3`,
      [this.scope.workspaceId, options.after || null, limit(options.limit)],
    );
    return result.rows.map((row) => ({
      ...row,
      revision: BigInt(row.revision),
    }));
  }

  async creditBalance(): Promise<CreditBalance> {
    const result = await this.client.query<{
      granted: string;
      spent: string;
      reserved: string;
      expired: string;
      refunded: string;
    }>("SELECT * FROM tholi.workspace_credit_totals($1)", [
      this.scope.workspaceId,
    ]);
    const { granted, spent, reserved, expired, refunded } = result.rows[0];
    const available =
      BigInt(granted) -
      BigInt(spent) -
      BigInt(reserved) -
      BigInt(expired) +
      BigInt(refunded);
    return {
      granted: BigInt(granted),
      spent: BigInt(spent),
      reserved: BigInt(reserved),
      available: available > 0n ? available : 0n,
      expired: BigInt(expired),
      refunded: BigInt(refunded),
    };
  }

  async grantCredits(input: {
    id?: string;
    idempotencyKey: string;
    amount: bigint;
    expiresAt?: Date;
    source?: string;
    periodStart?: Date;
    periodEnd?: Date;
    policyVersion?: string;
  }): Promise<CreditGrant> {
    input = snapshot(input);
    const amount = integer(input.amount, 1n);
    const expiresAt = input.expiresAt ? timestamp(input.expiresAt) : null;
    const source = text(input.source ?? "development", 100),
      periodStart = input.periodStart ? timestamp(input.periodStart) : null,
      periodEnd = input.periodEnd ? timestamp(input.periodEnd) : null,
      policyVersion = input.policyVersion
        ? text(input.policyVersion, 100)
        : null;
    if (
      (periodStart === null) !== (periodEnd === null) ||
      (periodStart && periodEnd && periodEnd <= periodStart)
    )
      invalid("Use a complete, increasing grant period.");
    if (
      ["free", "subscription"].includes(source) &&
      (!periodStart || !periodEnd || !policyVersion)
    )
      invalid(
        "Recurring grants require their original period and policy version.",
      );
    await this.lockWorkspace(true);
    await this.client.query(
      `INSERT INTO tholi.credit_grants (workspace_id, id, idempotency_key, amount, expires_at,source,period_start,period_end,policy_version)
       VALUES ($1, $2, $3, $4, $5,$6,$7,$8,$9) ON CONFLICT DO NOTHING`,
      [
        this.scope.workspaceId,
        input.id || randomUUID(),
        text(input.idempotencyKey, 200),
        amount,
        expiresAt,
        source,
        periodStart,
        periodEnd,
        policyVersion,
      ],
    );
    const result = await this.client.query<
      Int8Row<CreditGrant, "amount"> & {
        source: string;
        periodStart: Date | null;
        periodEnd: Date | null;
        policyVersion: string | null;
      }
    >(
      `SELECT id, amount::text, expires_at AS "expiresAt",source,period_start AS "periodStart",period_end AS "periodEnd",policy_version AS "policyVersion" FROM tholi.credit_grants
       WHERE workspace_id = $1 AND idempotency_key = $2`,
      [this.scope.workspaceId, input.idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) conflict();
    if (
      row.amount !== amount ||
      (row.expiresAt?.toISOString() || null) !== expiresAt ||
      row.source !== source ||
      (row.periodStart?.toISOString() ?? null) !== periodStart ||
      (row.periodEnd?.toISOString() ?? null) !== periodEnd ||
      row.policyVersion !== policyVersion
    )
      replayConflict();
    return { id: row.id, expiresAt: row.expiresAt, amount: BigInt(row.amount) };
  }

  private async ownedRequest(id: string) {
    const request = await this.getRequest(id);
    if (!request) conflict();
    return request;
  }

  async reserveCredits(input: {
    id?: string;
    requestId: string;
    amount: bigint;
    expiresAt: Date;
  }): Promise<CreditReservation> {
    input = snapshot(input);
    const amount = integer(input.amount, 1n);
    const expiresAt = timestamp(input.expiresAt);
    await this.lockWorkspace();
    const request = await this.ownedRequest(input.requestId);
    const existing = (
      await this.client.query<ReservationRow>(
        `SELECT ${reservationColumns} FROM tholi.credit_reservations
       WHERE workspace_id = $1 AND request_id = $2`,
        [this.scope.workspaceId, input.requestId],
      )
    ).rows[0];
    if (existing) {
      if (
        existing.amount !== amount ||
        existing.expiresAt.toISOString() !== expiresAt
      )
        replayConflict();
      return reservation(existing);
    }
    if (request.status !== "pending") conflict();
    if ((await this.creditBalance()).available < input.amount)
      throw new RepositoryError(
        "INSUFFICIENT_CREDITS",
        "Available credits do not cover this reservation.",
      );
    const result = await this.client.query<ReservationRow>(
      `INSERT INTO tholi.credit_reservations
         (workspace_id, id, request_id, amount, expires_at)
       VALUES ($1, $2, $3, $4, $5) RETURNING ${reservationColumns}`,
      [
        this.scope.workspaceId,
        input.id || randomUUID(),
        input.requestId,
        amount,
        expiresAt,
      ],
    );
    try {
      await this.client.query("SELECT tholi.allocate_credit_lots($1,$2)", [
        this.scope.workspaceId,
        result.rows[0].id,
      ]);
    } catch (error) {
      return accountingError(error);
    }
    return reservation(result.rows[0]);
  }

  async getInferencePolicy(
    version = "fake-development-v1",
  ): Promise<InferencePolicy | undefined> {
    const found = await this.client.query<InferencePolicyRow>(
      `SELECT version,provider,model,price_revision AS "priceRevision",
      max_credits::text AS "maxCredits",max_provider_usd_micros::text AS "maxProviderUsdMicros",
      max_input_units AS "maxInputUnits",max_output_units AS "maxOutputUnits",max_images AS "maxImages",
      max_retries AS "maxRetries",max_journey_requests AS "maxJourneyRequests",period_seconds AS "periodSeconds",
      account_requests AS "accountRequests",workspace_requests AS "workspaceRequests",
      account_provider_usd_micros::text AS "accountProviderUsdMicros",workspace_provider_usd_micros::text AS "workspaceProviderUsdMicros",
      journey_provider_usd_micros::text AS "journeyProviderUsdMicros"
      FROM tholi.inference_policy_versions WHERE version=$1`,
      [text(version, 100)],
    );
    const row = found.rows[0];
    if (!row) return;
    return {
      ...row,
      maxCredits: BigInt(row.maxCredits),
      maxProviderUsdMicros: BigInt(row.maxProviderUsdMicros),
      accountProviderUsdMicros: BigInt(row.accountProviderUsdMicros),
      workspaceProviderUsdMicros: BigInt(row.workspaceProviderUsdMicros),
      journeyProviderUsdMicros: BigInt(row.journeyProviderUsdMicros),
    };
  }

  async reserveInference(raw: {
    requestId: string;
    journeyId: string;
    policyVersion: string;
    expiresAt: Date;
  }): Promise<InferenceReservation> {
    const input = snapshot(raw),
      policy = await this.getInferencePolicy(input.policyVersion);
    if (!policy) conflict();
    try {
      const result = await this.client.query<{
        id: string;
        requestId: string;
        claimToken: string;
        creditReservationId: string;
        maxCredits: string;
        expiresAt: Date;
      }>(
        `SELECT id,request_id AS "requestId",claim_token AS "claimToken",credit_reservation_id AS "creditReservationId",
        max_credits AS "maxCredits",expires_at AS "expiresAt" FROM tholi.reserve_inference($1,$2,$3,$4)`,
        [
          input.requestId,
          input.journeyId,
          text(input.policyVersion, 100),
          timestamp(input.expiresAt),
        ],
      );
      const row = result.rows[0];
      if (!row) conflict();
      const capturedPlan = await this.client.query<{ plan: unknown }>(
        "SELECT plan_snapshot AS plan FROM tholi.inference_reservations WHERE id=$1",
        [row.id],
      );
      const effectivePlan = effectiveProductPlanSchema
        .nullable()
        .parse(capturedPlan.rows[0]?.plan);
      return {
        ...row,
        maxCredits: BigInt(row.maxCredits),
        policy,
        effectivePlan,
      };
    } catch (error) {
      return accountingError(error);
    }
  }

  async markInferenceDispatched(raw: {
    id: string;
    claimToken: string;
  }): Promise<void> {
    const input = snapshot(raw);
    try {
      await this.client.query("SELECT tholi.mark_inference_dispatched($1,$2)", [
        input.id,
        input.claimToken,
      ]);
    } catch (error) {
      return accountingError(error);
    }
  }

  async listCreditHistory(
    options: { after?: string; limit?: number } = {},
  ): Promise<RepositoryPage<CreditHistoryEntry>> {
    options = snapshot(options);
    const size = limit(options.limit),
      cursor = historyCursor(options.after);
    const result = await this.client.query<
      Int8Row<CreditHistoryEntry, "amount"> & { cursorTime: string }
    >(
      `SELECT l.id,l.kind,l.amount::text,l.created_at AS "createdAt",
      to_char(l.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime",
      g.source,g.period_start AS "periodStart",g.period_end AS "periodEnd",g.expires_at AS "expiresAt",
      COALESCE(g.policy_version,i.policy_version) AS "policyVersion"
      FROM tholi.credit_ledger l LEFT JOIN tholi.credit_grants g ON g.workspace_id=l.workspace_id AND g.id=l.id AND l.kind='grant'
      LEFT JOIN tholi.credit_refunds f ON f.workspace_id=l.workspace_id AND f.id=l.id AND l.kind='refund'
      LEFT JOIN tholi.credit_settlements s ON s.workspace_id=l.workspace_id AND (s.id=l.id AND l.kind='settlement' OR s.id=f.settlement_id)
      LEFT JOIN tholi.inference_reservations i ON i.workspace_id=s.workspace_id AND i.credit_reservation_id=s.reservation_id
      WHERE l.workspace_id=$1 AND ($2::timestamptz IS NULL OR (l.created_at,l.id)>($2::timestamptz,$3::uuid))
      ORDER BY l.created_at,l.id LIMIT $4`,
      [this.scope.workspaceId, ...cursor, size + 1],
    );
    return repositoryPage(
      result.rows.map(({ cursorTime, ...row }) => ({
        ...row,
        amount: BigInt(row.amount),
      })),
      size,
      result.rows[Math.min(size, result.rows.length) - 1]?.cursorTime,
    );
  }

  async listUsage(
    options: { after?: string; limit?: number } = {},
  ): Promise<RepositoryPage<InferenceUsage>> {
    options = snapshot(options);
    const size = limit(options.limit),
      cursor = historyCursor(options.after);
    const result = await this.client.query<
      InferenceUsageRow & { cursorTime: string }
    >(
      `SELECT u.id,u.request_id AS "requestId",u.provider,u.model,
      to_char(u.created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorTime",
      CASE WHEN i.resolution='unknown' THEN NULL ELSE u.input_units::text END AS "inputUnits",
      CASE WHEN i.resolution='unknown' THEN NULL ELSE u.output_units::text END AS "outputUnits",u.provider_usd_micros::text AS "providerUsdMicros",
      u.charged_credits::text AS "chargedCredits",u.policy_version AS "policyVersion",u.created_at AS "createdAt"
      FROM tholi.usage_records u JOIN tholi.requests q ON q.workspace_id=u.workspace_id AND q.id=u.request_id
      LEFT JOIN tholi.inference_reservations i ON i.workspace_id=u.workspace_id AND i.request_id=u.request_id
      WHERE u.workspace_id=$1 AND q.account_id=$2
        AND ($3::timestamptz IS NULL OR (u.created_at,u.id)>($3::timestamptz,$4::uuid)) ORDER BY u.created_at,u.id LIMIT $5`,
      [...this.parameters, ...cursor, size + 1],
    );
    return repositoryPage(
      result.rows.map(({ cursorTime, ...row }) => inferenceUsage(row)),
      size,
      result.rows[Math.min(size, result.rows.length) - 1]?.cursorTime,
    );
  }

  private async ownedReservation(id: string): Promise<CreditReservation> {
    const row = (
      await this.client.query<ReservationRow>(
        `SELECT r.id, r.request_id AS "requestId", r.amount::text, r.status, r.expires_at AS "expiresAt"
       FROM tholi.credit_reservations r JOIN tholi.requests q
         ON q.workspace_id = r.workspace_id AND q.id = r.request_id
       WHERE r.workspace_id = $1 AND q.account_id = $2 AND r.id = $3`,
        [...this.parameters, id],
      )
    ).rows[0];
    if (!row) conflict();
    return reservation(row);
  }

  private async changeReservationStatus(
    id: string,
    status: "settled" | "released" | "uncertain",
  ): Promise<CreditReservation> {
    const result = await this.client.query<ReservationRow>(
      `UPDATE tholi.credit_reservations r SET status = $4, updated_at = clock_timestamp()
       WHERE r.workspace_id = $1 AND r.id = $3
         AND (r.status = 'active' OR ($4 = 'settled' AND r.status = 'uncertain'))
         AND EXISTS (SELECT 1 FROM tholi.requests q
           WHERE q.workspace_id = r.workspace_id AND q.id = r.request_id AND q.account_id = $2)
       RETURNING ${reservationColumns}`,
      [...this.parameters, id, status],
    );
    if (!result.rows[0]) conflict();
    return reservation(result.rows[0]);
  }

  async settleCredits(input: {
    reservationId: string;
    amount: bigint;
  }): Promise<CreditSettlement> {
    input = snapshot(input);
    integer(input.amount);
    await this.lockWorkspace();
    const held = await this.ownedReservation(input.reservationId);
    const existing = (
      await this.client.query<Int8Row<CreditSettlement, "amount">>(
        `SELECT id, reservation_id AS "reservationId", amount::text FROM tholi.credit_settlements
       WHERE workspace_id = $1 AND reservation_id = $2`,
        [this.scope.workspaceId, input.reservationId],
      )
    ).rows[0];
    if (existing) {
      if (BigInt(existing.amount) !== input.amount) replayConflict();
      return { ...existing, amount: BigInt(existing.amount) };
    }
    if (
      !["active", "uncertain"].includes(held.status) ||
      input.amount > held.amount
    )
      conflict();
    const result = await this.client.query<Int8Row<CreditSettlement, "amount">>(
      `INSERT INTO tholi.credit_settlements (workspace_id, id, reservation_id, amount)
       VALUES ($1, $2, $3, $4) RETURNING id, reservation_id AS "reservationId", amount::text`,
      [
        this.scope.workspaceId,
        randomUUID(),
        input.reservationId,
        input.amount.toString(),
      ],
    );
    await this.changeReservationStatus(input.reservationId, "settled");
    return { ...result.rows[0], amount: BigInt(result.rows[0].amount) };
  }

  async releaseCredits(id: string): Promise<CreditReservation> {
    await this.lockWorkspace();
    const held = await this.ownedReservation(id);
    if (held.status === "released") return held;
    if (held.status !== "active") conflict();
    return this.changeReservationStatus(id, "released");
  }

  async markReservationUncertain(id: string): Promise<CreditReservation> {
    await this.lockWorkspace();
    const held = await this.ownedReservation(id);
    if (held.status === "uncertain") return held;
    if (held.status !== "active") conflict();
    return this.changeReservationStatus(id, "uncertain");
  }

  async recordUsage(
    input: Omit<UsageRecord, "id"> & { id?: string },
  ): Promise<UsageRecord> {
    input = snapshot(input);
    await this.ownedRequest(input.requestId);
    const values = [
      this.scope.workspaceId,
      input.requestId,
      text(input.provider, 100),
      text(input.model, 200),
      integer(input.inputUnits),
      integer(input.outputUnits),
    ];
    await this.client.query(
      `INSERT INTO tholi.usage_records
         (workspace_id, request_id, provider, model, input_units, output_units, id)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT DO NOTHING`,
      [...values, input.id || randomUUID()],
    );
    const row = (
      await this.client.query<
        Int8Row<UsageRecord, "inputUnits" | "outputUnits">
      >(
        `SELECT id, request_id AS "requestId", provider, model,
         input_units::text AS "inputUnits", output_units::text AS "outputUnits"
       FROM tholi.usage_records WHERE workspace_id = $1 AND request_id = $2`,
        values.slice(0, 2),
      )
    ).rows[0];
    if (!row) conflict();
    if (
      row.provider !== input.provider ||
      row.model !== input.model ||
      BigInt(row.inputUnits) !== input.inputUnits ||
      BigInt(row.outputUnits) !== input.outputUnits
    )
      replayConflict();
    return {
      ...row,
      inputUnits: BigInt(row.inputUnits),
      outputUnits: BigInt(row.outputUnits),
    };
  }

  async getArtifact(id: string): Promise<SavedArtifact | undefined> {
    const row = (
      await this.client.query<ArtifactRow>(
        `SELECT ${artifactColumns} FROM tholi.saved_artifacts
       WHERE workspace_id = $1 AND owner_account_id = $2 AND id = $3 AND format_version=1`,
        [...this.parameters, id],
      )
    ).rows[0];
    return row && artifact(row);
  }

  async listArtifacts(
    options: {
      after?: bigint;
      limit?: number;
      includeDeleted?: boolean;
    } = {},
  ): Promise<ArtifactPage> {
    const pageSize = limit(options.limit);
    const result = await this.client.query<ArtifactRow>(
      `SELECT ${artifactColumns} FROM tholi.saved_artifacts
       WHERE workspace_id = $1 AND owner_account_id = $2 AND sync_revision > $3 AND format_version=1
         AND ($4::boolean OR deleted_at IS NULL)
       ORDER BY sync_revision, id LIMIT $5`,
      [
        ...this.parameters,
        integer(options.after ?? 0n),
        !!options.includeDeleted,
        pageSize + 1,
      ],
    );
    const items = result.rows.slice(0, pageSize).map(artifact);
    return {
      items,
      ...(result.rows.length > pageSize
        ? { nextCursor: items.at(-1)!.syncRevision }
        : {}),
    };
  }

  private async nextSyncRevision(): Promise<string> {
    const result = await this.client.query<{ revision: string }>(
      `UPDATE tholi.workspaces SET sync_revision = sync_revision + 1, updated_at = now()
       WHERE id = $1 RETURNING sync_revision::text AS revision`,
      [this.scope.workspaceId],
    );
    if (!result.rows[0]) conflict();
    return result.rows[0].revision;
  }

  async getSavedArtifact(id: string): Promise<SavedDataRecord | undefined> {
    savedDataExportInputSchema.shape.ids.parse([id]);
    const result = await this.client.query<StoredArtifactRow>(
      `SELECT ${storedArtifactColumns} FROM tholi.saved_artifacts
       WHERE workspace_id=$1 AND owner_account_id=$2 AND id=$3 AND format_version=2`,
      [...this.parameters, id],
    );
    return result.rows[0] && savedDataRecord(result.rows[0]);
  }

  async listSavedArtifacts(raw: SavedDataListQuery): Promise<SavedDataPage> {
    const query = savedDataListQuerySchema.parse(snapshot(raw));
    const fingerprint = createHash("sha256")
      .update(
        JSON.stringify({
          ...this.scope,
          ...query,
          cursor: undefined,
        }),
      )
      .digest("hex");
    let after = "0";
    if (query.cursor) {
      try {
        const cursor: unknown = JSON.parse(
          Buffer.from(query.cursor, "base64url").toString("utf8"),
        );
        if (
          !Array.isArray(cursor) ||
          cursor.length !== 2 ||
          cursor[1] !== fingerprint ||
          typeof cursor[0] !== "string" ||
          !/^(?:0|[1-9][0-9]*)$/.test(cursor[0])
        )
          throw Error();
        after = integer(BigInt(cursor[0]));
      } catch {
        invalid("The saved-data page has changed. Start again.");
      }
    }
    const result = await this.client.query<StoredArtifactRow>(
      `SELECT ${storedArtifactColumns} FROM tholi.saved_artifacts
       WHERE workspace_id=$1 AND owner_account_id=$2 AND format_version=2 AND deleted_at IS NULL
         AND sync_revision>$3 AND ($4::text IS NULL OR kind=$4)
         AND ($5::text IS NULL OR metadata->>'folder'=$5)
         AND ($6::text IS NULL OR metadata->'tags' ? $6)
         AND ($7::text IS NULL OR strpos(lower(metadata::text||' '||content::text),lower($7))>0)
       ORDER BY sync_revision LIMIT $8`,
      [
        ...this.parameters,
        after,
        query.kind ?? null,
        query.folder ?? null,
        query.tag ?? null,
        query.query ?? null,
        query.limit + 1,
      ],
    );
    const items = result.rows.slice(0, query.limit).map(savedDataRecord);
    return {
      items,
      ...(result.rows.length > query.limit
        ? {
            nextCursor: Buffer.from(
              JSON.stringify([items.at(-1)!.syncRevision, fingerprint]),
            ).toString("base64url"),
          }
        : {}),
    };
  }

  async savedArtifactChanges(
    options: { after?: string; limit?: number } = {},
  ): Promise<SavedDataChanges> {
    if (!/^(?:0|[1-9][0-9]*)$/.test(options.after ?? "0"))
      invalid("Use a saved-data sync revision.");
    const after = integer(BigInt(options.after ?? "0")),
      pageSize = limit(options.limit);
    const result = await this.client.query<StoredArtifactRow>(
      `SELECT ${storedArtifactColumns} FROM tholi.saved_artifacts WHERE workspace_id=$1
        AND owner_account_id=$2 AND format_version=2 AND sync_revision>$3 ORDER BY sync_revision LIMIT $4`,
      [...this.parameters, after, pageSize + 1],
    );
    const items = result.rows.slice(0, pageSize).map(savedDataRecord);
    return {
      items,
      nextAfter: items.at(-1)?.syncRevision ?? after,
      hasMore: result.rows.length > pageSize,
    };
  }

  /** Receipts retain IDs only; replay reads current rows, including deletion tombstones. */
  private async savedMutation(
    operation: string,
    idempotencyKey: string,
    payload: unknown,
    work: () => Promise<SavedDataRecord[]>,
  ): Promise<SavedDataImportResult> {
    await this.lockAccount();
    await this.lockWorkspace();
    const { request, replayed } = await this.beginRequest({
      operation,
      idempotencyKey,
      payloadHash: createHash("sha256")
        .update(JSON.stringify(payload))
        .digest("hex"),
    });
    if (replayed) {
      const result = await this.client.query<{
        receipt: { schemaVersion: number; ids: string[] } | null;
      }>(
        `SELECT saved_data_receipt AS receipt FROM tholi.requests WHERE workspace_id=$1 AND account_id=$2 AND id=$3`,
        [...this.parameters, request.id],
      );
      const receipt = result.rows[0]?.receipt;
      if (!receipt || receipt.schemaVersion !== 1) conflict();
      const ids = savedDataExportInputSchema.shape.ids.parse(receipt.ids);
      const items: SavedDataRecord[] = [];
      for (const id of ids) {
        const current = await this.getSavedArtifact(id);
        if (!current) conflict();
        items.push(current);
      }
      return { items, replayed: true };
    }
    const items = await work();
    await this.client.query(
      `UPDATE tholi.requests SET saved_data_receipt=$4::jsonb,status='completed',updated_at=clock_timestamp()
       WHERE workspace_id=$1 AND account_id=$2 AND id=$3 AND saved_data_receipt IS NULL`,
      [
        ...this.parameters,
        request.id,
        JSON.stringify({ schemaVersion: 1, ids: items.map((item) => item.id) }),
      ],
    );
    return { items, replayed: false };
  }

  async saveSavedArtifact(raw: SavedDataMutation): Promise<SavedDataRecord> {
    const input = savedDataMutationSchema.parse(snapshot(raw));
    const result = await this.savedMutation(
      "saved-data.save.v1",
      input.idempotencyKey,
      {
        expectedRevision: input.expectedRevision,
        approved: input.approved,
        artifact: input.artifact,
      },
      async () => [
        savedDataRecord(
          await this.writeArtifact({
            id: input.artifact.id,
            expectedRevision: BigInt(input.expectedRevision),
            kind: input.artifact.kind,
            formatVersion: 2,
            content: input.artifact.data,
            metadata: input.artifact.metadata,
          }),
        ),
      ],
    );
    return result.items[0];
  }

  async importSavedArtifacts(
    raw: SavedDataImportInput,
  ): Promise<SavedDataImportResult> {
    const input = savedDataImportInputSchema.parse(snapshot(raw));
    if (
      (await savedDataImportHash(this.scope, input.items)) !== input.previewHash
    )
      invalid(
        "The saved-data preview no longer matches this account and workspace.",
      );
    return this.savedMutation(
      "saved-data.import.v1",
      input.idempotencyKey,
      {
        approved: input.approved,
        previewHash: input.previewHash,
        items: input.items,
      },
      async () => {
        const items: SavedDataRecord[] = [];
        for (const item of input.items)
          items.push(
            savedDataRecord(
              await this.writeArtifact({
                id: item.artifact.id,
                expectedRevision: BigInt(item.expectedRevision),
                kind: item.artifact.kind,
                formatVersion: 2,
                content: item.artifact.data,
                metadata: item.artifact.metadata,
              }),
            ),
          );
        return items;
      },
    );
  }

  async deleteSavedArtifact(
    id: string,
    raw: SavedDataDeleteInput,
  ): Promise<SavedDataRecord> {
    savedDataExportInputSchema.shape.ids.parse([id]);
    const input = savedDataDeleteInputSchema.parse(snapshot(raw));
    const result = await this.savedMutation(
      "saved-data.delete.v1",
      input.idempotencyKey,
      {
        id,
        expectedRevision: input.expectedRevision,
        approved: input.approved,
      },
      async () => [
        savedDataRecord(
          await this.deleteArtifact(id, BigInt(input.expectedRevision), 2),
        ),
      ],
    );
    return result.items[0];
  }

  async saveArtifact(input: {
    id?: string;
    expectedRevision: bigint;
    content: SavedTask;
    userApproved: true;
  }): Promise<SavedArtifact> {
    input = snapshot(input);
    if (input.userApproved !== true)
      invalid("Saving cloud data requires explicit approval.");
    integer(input.expectedRevision);
    const parsed = savedTaskSchema.safeParse(input.content);
    if (!parsed.success) invalid("Only a supported saved route can be stored.");
    const content = parameterizedTask(parsed.data);
    const row = await this.writeArtifact({
      id: input.id || randomUUID(),
      expectedRevision: input.expectedRevision,
      kind: "saved_route",
      formatVersion: 1,
      content,
      metadata: null,
    });
    return artifact({
      ...row,
      kind: "saved_route",
      content: savedTaskSchema.parse(row.content),
    });
  }

  /** Both legacy and public formats share one revision, quota and mutation owner. */
  private async writeArtifact(input: {
    id: string;
    expectedRevision: bigint;
    kind: string;
    formatVersion: 1 | 2;
    content: unknown;
    metadata: unknown;
  }): Promise<StoredArtifactRow> {
    integer(input.expectedRevision);
    // Product storage is account-bounded across workspaces. Match accounting's
    // account-before-workspace order before the existing sync/row mutation.
    await this.lockAccount();
    await this.lockWorkspace();
    if (
      input.expectedRevision === 0n &&
      (
        await this.client.query(
          "SELECT id FROM tholi.saved_artifacts WHERE workspace_id=$1 AND owner_account_id=$2 AND id=$3",
          [...this.parameters, input.id],
        )
      ).rowCount
    )
      conflict();
    if (input.formatVersion === 2) {
      const consent = await this.client.query<{ allowed: boolean }>(
        "SELECT tholi.lock_saved_data_consent() AS allowed",
      );
      if (!consent.rows[0]?.allowed)
        throw new RepositoryError(
          "FORBIDDEN",
          "Current saved-data consent is required.",
        );
    }
    const stamp = await this.nextSyncRevision();
    const values = [
      ...this.parameters,
      input.id,
      JSON.stringify(input.content),
      stamp,
      input.kind,
      input.formatVersion,
      input.metadata === null ? null : JSON.stringify(input.metadata),
    ];
    try {
      const result =
        input.expectedRevision === 0n
          ? await this.client.query<StoredArtifactRow>(
              `INSERT INTO tholi.saved_artifacts
             (workspace_id, owner_account_id, id, kind, content, sync_revision,format_version,metadata)
           VALUES ($1, $2, $3, $6, $4::jsonb, $5,$7,$8::jsonb)
           ON CONFLICT DO NOTHING RETURNING ${storedArtifactColumns}`,
              values,
            )
          : await this.client.query<StoredArtifactRow>(
              `UPDATE tholi.saved_artifacts SET content = $4::jsonb,
             sync_revision = $5,kind=$6,format_version=$7,metadata=$8::jsonb,
             revision = revision + 1, updated_at = clock_timestamp()
           WHERE workspace_id = $1 AND owner_account_id = $2 AND id = $3
             AND revision = $9 AND deleted_at IS NULL AND format_version<=$7
             RETURNING ${storedArtifactColumns}`,
              [...values, input.expectedRevision.toString()],
            );
      if (!result.rows[0]) conflict();
      return result.rows[0];
    } catch (error) {
      return accountingError(error);
    }
  }

  async tombstoneArtifact(
    id: string,
    expectedRevision: bigint,
  ): Promise<SavedArtifact> {
    const row = await this.deleteArtifact(id, expectedRevision, 1);
    return artifact({ ...row, kind: "saved_route", content: null });
  }

  private async deleteArtifact(
    id: string,
    expectedRevision: bigint,
    formatVersion: 1 | 2,
  ): Promise<StoredArtifactRow> {
    integer(expectedRevision, 1n);
    await this.lockWorkspace();
    const stamp = await this.nextSyncRevision();
    const result = await this.client.query<StoredArtifactRow>(
      `UPDATE tholi.saved_artifacts SET content = NULL, deleted_at = now(),
         metadata=CASE WHEN format_version=2 THEN '{"label":"Deleted item","folder":null,"tags":[]}'::jsonb ELSE NULL END,
         revision = revision + 1, sync_revision = $5, updated_at = clock_timestamp()
       WHERE workspace_id = $1 AND owner_account_id = $2 AND id = $3
         AND revision = $4 AND deleted_at IS NULL AND format_version=$6 RETURNING ${storedArtifactColumns}`,
      [
        ...this.parameters,
        id,
        expectedRevision.toString(),
        stamp,
        formatVersion,
      ],
    );
    if (!result.rows[0]) conflict();
    return result.rows[0];
  }

  private async checkReferences(references: RecordReferences) {
    for (const [key, value] of Object.entries(references)) {
      if (
        !["accountId", "artifactId", "requestId"].includes(key) ||
        typeof value !== "string" ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value)
      )
        invalid("Jobs accept scoped record identifiers only.");
    }
    if (references.accountId && references.accountId !== this.scope.accountId)
      conflict();
    if (
      references.artifactId &&
      !(await this.getArtifact(references.artifactId))
    )
      conflict();
    if (references.requestId) await this.ownedRequest(references.requestId);
  }

  async enqueueJob(input: {
    id?: string;
    requestId?: string;
    kind: string;
    version: number;
    idempotencyKey: string;
    recordReferences?: RecordReferences;
    availableAt?: Date;
    maxAttempts?: number;
    replaySafe?: boolean;
  }): Promise<Job> {
    input = snapshot(input);
    const references = input.recordReferences || {};
    await this.checkReferences(references);
    if (input.requestId) await this.ownedRequest(input.requestId);
    if (
      input.requestId &&
      references.requestId &&
      input.requestId !== references.requestId
    )
      invalid("The job's request identifiers disagree.");
    const maxAttempts = input.maxAttempts ?? 3;
    const replaySafe = input.replaySafe ?? false;
    if (
      !Number.isInteger(input.version) ||
      input.version < 1 ||
      input.version > 2147483647 ||
      typeof replaySafe !== "boolean" ||
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 100
    )
      invalid("Use bounded job versions and attempt counts.");
    await this.client.query(
      `INSERT INTO tholi.jobs (workspace_id, account_id, id, request_id, kind,
         version, idempotency_key, record_references, available_at, max_attempts,replay_safe,origin_correlation)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, COALESCE($9::timestamptz, now()), $10,$11,$12::jsonb)
       ON CONFLICT DO NOTHING`,
      [
        ...this.parameters,
        input.id || randomUUID(),
        input.requestId || null,
        text(input.kind, 100),
        input.version,
        text(input.idempotencyKey, 200),
        JSON.stringify(references),
        input.availableAt ? timestamp(input.availableAt) : null,
        maxAttempts,
        replaySafe,
        this.observer.current()
          ? JSON.stringify(correlationSchema.parse(this.observer.current()))
          : null,
      ],
    );
    const row = (
      await this.client.query<JobRow & { replaySafe: boolean }>(
        `SELECT ${jobColumns},replay_safe AS "replaySafe" FROM tholi.jobs
       WHERE workspace_id = $1 AND account_id = $2 AND kind = $3 AND version = $4
         AND idempotency_key = $5`,
        [...this.parameters, input.kind, input.version, input.idempotencyKey],
      )
    ).rows[0];
    if (!row) conflict();
    if (
      row.requestId !== (input.requestId || null) ||
      row.maxAttempts !== maxAttempts ||
      row.replaySafe !== replaySafe ||
      !isDeepStrictEqual(row.recordReferences, references) ||
      (input.availableAt &&
        row.availableAt.toISOString() !== timestamp(input.availableAt))
    )
      replayConflict();
    const { replaySafe: _policy, ...stored } = row;
    return job(stored);
  }

  async getJob(id: string): Promise<Job | undefined> {
    const row = (
      await this.client.query<JobRow>(
        `SELECT ${jobColumns} FROM tholi.jobs
       WHERE workspace_id = $1 AND account_id = $2 AND id = $3`,
        [...this.parameters, id],
      )
    ).rows[0];
    return row && job(row);
  }

  async listJobs(
    options: { after?: string; limit?: number; status?: Job["status"] } = {},
  ): Promise<Job[]> {
    options = snapshot(options);
    const result = await this.client.query<JobRow>(
      `SELECT ${jobColumns} FROM tholi.jobs WHERE workspace_id=$1 AND account_id=$2
       AND ($3::uuid IS NULL OR id>$3) AND ($4::text IS NULL OR status=$4)
       ORDER BY id LIMIT $5`,
      [
        ...this.parameters,
        options.after ?? null,
        options.status ?? null,
        limit(options.limit),
      ],
    );
    return result.rows.map(job);
  }

  async cancelJob(input: {
    id: string;
    expectedRevision: bigint;
  }): Promise<Job> {
    input = snapshot(input);
    integer(input.expectedRevision, 1n);
    await this.lockWorkspace();
    const current = await this.getJob(input.id);
    if (!current || current.revision !== input.expectedRevision) conflict();
    if (!["queued", "running"].includes(current.status)) return current;
    const result = await this.client.query<JobRow>(
      `UPDATE tholi.jobs SET
      cancel_requested_at=clock_timestamp(),status=CASE WHEN status='queued' THEN 'cancelled' ELSE status END,
      last_error_code=CASE WHEN status='queued' THEN 'CANCELLED' ELSE last_error_code END,
      revision=revision+1,updated_at=clock_timestamp()
      WHERE workspace_id=$1 AND account_id=$2 AND id=$3 AND revision=$4 RETURNING ${jobColumns}`,
      [...this.parameters, input.id, input.expectedRevision.toString()],
    );
    if (!result.rows[0]) conflict();
    return job(result.rows[0]);
  }

  async pruneExpiredBrokers(batch: number): Promise<number> {
    return pruneExpiredIdentityBrokers(this.client, batch);
  }

  async runJob(
    lease: JobLease,
    work: (transaction: JobTransaction) => Promise<JobResult>,
  ): Promise<boolean> {
    await this.lockWorkspace();
    const parameters = [
      ...this.parameters,
      lease.id,
      lease.leaseToken,
      lease.kind,
      lease.version,
    ];
    const found = await this.client.query<{ cancelled: boolean }>(
      `SELECT cancel_requested_at IS NOT NULL AS cancelled
      FROM tholi.jobs WHERE workspace_id=$1 AND account_id=$2 AND id=$3 AND claim_token=$4
        AND kind=$5 AND version=$6 AND status='running' AND lease_expires_at>clock_timestamp() FOR UPDATE`,
      parameters,
    );
    if (!found.rows[0]) return false;
    if (found.rows[0].cancelled) {
      await this.client.query(
        `UPDATE tholi.jobs SET status='cancelled',last_error_code='CANCELLED',claim_token=NULL,
        lease_owner=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=clock_timestamp()
        WHERE workspace_id=$1 AND account_id=$2 AND id=$3`,
        parameters.slice(0, 3),
      );
      return false;
    }
    const result = jobResultSchema.parse(await work(this));
    const completed = await this.client.query(
      `UPDATE tholi.jobs SET status='succeeded',result_count=$7,last_error_code=NULL,
      claim_token=NULL,lease_owner=NULL,lease_expires_at=NULL,revision=revision+1,updated_at=clock_timestamp()
      WHERE workspace_id=$1 AND account_id=$2 AND id=$3 AND claim_token=$4 AND kind=$5 AND version=$6
        AND status='running' AND cancel_requested_at IS NULL AND lease_expires_at>clock_timestamp() RETURNING id`,
      [...parameters, result.processed],
    );
    if (!completed.rowCount) throw new JobLeaseLost();
    // This event is acknowledged by the database-local completion consumer. It
    // does not claim delivery to SMTP, a broker, a webhook or another service.
    const event = await this.appendOutbox({
      jobId: lease.id,
      eventKind: "job.completed",
      idempotencyKey: `job:${lease.id}:completed`,
    });
    await this.client.query(
      "UPDATE tholi.outbox SET status='published',published_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 AND job_id=$3",
      [this.scope.workspaceId, event.id, lease.id],
    );
    return true;
  }

  async appendOutbox(input: {
    id?: string;
    jobId: string;
    eventKind: string;
    idempotencyKey: string;
    availableAt?: Date;
  }): Promise<OutboxEntry> {
    input = snapshot(input);
    if (!(await this.getJob(input.jobId))) conflict();
    await this.client.query(
      `INSERT INTO tholi.outbox
         (workspace_id, id, job_id, event_kind, idempotency_key, available_at)
       VALUES ($1, $2, $3, $4, $5, COALESCE($6::timestamptz, now())) ON CONFLICT DO NOTHING`,
      [
        this.scope.workspaceId,
        input.id || randomUUID(),
        input.jobId,
        text(input.eventKind, 100),
        text(input.idempotencyKey, 200),
        input.availableAt ? timestamp(input.availableAt) : null,
      ],
    );
    const row = (
      await this.client.query<OutboxEntry>(
        `SELECT o.id, o.job_id AS "jobId", o.event_kind AS "eventKind", o.status,
         o.available_at AS "availableAt" FROM tholi.outbox o JOIN tholi.jobs j
         ON j.workspace_id = o.workspace_id AND j.id = o.job_id
       WHERE o.workspace_id = $1 AND j.account_id = $2
         AND o.event_kind = $3 AND o.idempotency_key = $4`,
        [...this.parameters, input.eventKind, input.idempotencyKey],
      )
    ).rows[0];
    if (!row) conflict();
    if (
      row.jobId !== input.jobId ||
      (input.availableAt &&
        row.availableAt.toISOString() !== timestamp(input.availableAt))
    )
      replayConflict();
    return row;
  }
}
