import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import type { Pool, PoolClient } from "pg";
import {
  savedTaskSchema,
  type SavedTask,
} from "../../../../packages/page-model";
import { parameterizedTask } from "../../../../packages/navigation-core/privacy";
import { withTransaction } from "./postgres";
import {
  RepositoryError,
  type Account,
  type ArtifactPage,
  type Consent,
  type CreditBalance,
  type CreditGrant,
  type CreditReservation,
  type CreditSettlement,
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
} from "./contracts";

type Int8Row<T, K extends keyof T> = Omit<T, K> & Record<K, string>;
type ArtifactRow = Int8Row<SavedArtifact, "revision" | "syncRevision">;
type ReservationRow = Int8Row<CreditReservation, "amount">;
const maxInt8 = 9223372036854775807n;
const artifactColumns = `id, owner_account_id AS "ownerAccountId", kind, content,
  revision::text, sync_revision::text AS "syncRevision", deleted_at AS "deletedAt"`;
const requestColumns = `id, operation, idempotency_key AS "idempotencyKey",
  encode(payload_hash, 'hex') AS "payloadHash", status`;
const reservationColumns = `id, request_id AS "requestId", amount::text,
  status, expires_at AS "expiresAt"`;
const jobColumns = `id, account_id AS "accountId", request_id AS "requestId",
  kind, version, record_references AS "recordReferences", status,
  available_at AS "availableAt", max_attempts AS "maxAttempts"`;

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
    ...row,
    revision: BigInt(row.revision),
    syncRevision: BigInt(row.syncRevision),
  };
}

function reservation(row: ReservationRow): CreditReservation {
  return { ...row, amount: BigInt(row.amount) };
}

/** Pool lifetime belongs to the runtime. Callbacks contain database work only. */
export class PostgresRepositories {
  constructor(private readonly pool: Pool) {}

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

  async transaction<T>(
    scope: RepositoryScope,
    work: (repositories: ScopedRepositories) => Promise<T>,
  ): Promise<T> {
    const authorizedScope = Object.freeze({ ...scope });
    return withTransaction(
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
            new ScopedRepositories(capability, authorizedScope),
          );
        } finally {
          active = false;
        }
      },
      authorizedScope,
    );
  }
}

/** Identity linking and operator seeding share the same atomic provisioning. */
export async function provisionAccountOnClient(
  client: PoolClient,
  input: RepositoryScope,
): Promise<RepositoryScope> {
  await client.query(
    "INSERT INTO tholi.accounts (id) VALUES ($1) ON CONFLICT DO NOTHING",
    [input.accountId],
  );
  await client.query(
    `INSERT INTO tholi.workspaces (id, kind, owner_account_id)
         VALUES ($1, 'personal', $2) ON CONFLICT DO NOTHING`,
    [input.workspaceId, input.accountId],
  );
  const workspace = await client.query(
    `SELECT w.id FROM tholi.workspaces w
         JOIN tholi.accounts a ON a.id = w.owner_account_id
         WHERE w.id = $1 AND w.owner_account_id = $2
           AND w.kind = 'personal' AND a.status = 'active'`,
    [input.workspaceId, input.accountId],
  );
  if (!workspace.rowCount) conflict();
  await client.query(
    `INSERT INTO tholi.memberships (workspace_id, account_id, role)
         VALUES ($1, $2, 'owner') ON CONFLICT DO NOTHING`,
    [input.workspaceId, input.accountId],
  );
  const membership = await client.query(
    `SELECT 1 FROM tholi.memberships
         WHERE workspace_id = $1 AND account_id = $2
           AND role = 'owner' AND status = 'active'`,
    [input.workspaceId, input.accountId],
  );
  if (!membership.rowCount) conflict();
  return { ...input };
}

/** Created by PostgresRepositories.transaction, on its checked-out connection. */
class ScopedRepositories {
  constructor(
    private readonly client: Pick<PoolClient, "query">,
    private readonly scope: Readonly<RepositoryScope>,
  ) {}

  private get parameters() {
    return [this.scope.workspaceId, this.scope.accountId];
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

  async getAccount(): Promise<Account> {
    const result = await this.client.query<Int8Row<Account, "revision">>(
      "SELECT id, status, revision::text FROM tholi.accounts WHERE id = $1",
      [this.scope.accountId],
    );
    if (!result.rows[0]) conflict();
    return { ...result.rows[0], revision: BigInt(result.rows[0].revision) };
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
    if (
      input.accountId === this.scope.accountId &&
      (input.role !== "owner" || input.status !== "active")
    )
      invalid("The workspace owner must retain active ownership.");
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
    return { ...result.rows[0], revision: BigInt(result.rows[0].revision) };
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

  async recordConsent(input: {
    purpose: string;
    policyVersion: string;
    granted: boolean;
    expectedRevision: bigint;
  }): Promise<Consent> {
    input = snapshot(input);
    integer(input.expectedRevision);
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
            `UPDATE tholi.consents SET policy_version = $4, granted = $5,
             revision = revision + 1, updated_at = now()
           WHERE workspace_id = $1 AND account_id = $2 AND purpose = $3 AND revision = $6
           RETURNING ${columns}`,
            [...parameters, input.expectedRevision.toString()],
          );
    if (!result.rows[0]) conflict();
    return { ...result.rows[0], revision: BigInt(result.rows[0].revision) };
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
  ): Promise<ServiceRequest> {
    const result = await this.client.query<ServiceRequest>(
      `UPDATE tholi.requests SET status = $4, updated_at = now()
       WHERE workspace_id = $1 AND account_id = $2 AND id = $3
         AND (status IN ('pending', 'uncertain') OR status = $4)
       RETURNING ${requestColumns}`,
      [...this.parameters, id, status],
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
    }>(
      `SELECT
        (SELECT COALESCE(sum(amount), 0)::text FROM tholi.credit_grants
          WHERE workspace_id = $1 AND (expires_at IS NULL OR expires_at > now())) AS granted,
        (SELECT COALESCE(sum(amount), 0)::text FROM tholi.credit_settlements
          WHERE workspace_id = $1) AS spent,
        (SELECT COALESCE(sum(amount), 0)::text FROM tholi.credit_reservations
          WHERE workspace_id = $1 AND status IN ('active', 'uncertain')) AS reserved`,
      [this.scope.workspaceId],
    );
    const { granted, spent, reserved } = result.rows[0];
    const available = BigInt(granted) - BigInt(spent) - BigInt(reserved);
    return {
      granted: BigInt(granted),
      spent: BigInt(spent),
      reserved: BigInt(reserved),
      available: available > 0n ? available : 0n,
    };
  }

  async grantCredits(input: {
    id?: string;
    idempotencyKey: string;
    amount: bigint;
    expiresAt?: Date;
  }): Promise<CreditGrant> {
    input = snapshot(input);
    const amount = integer(input.amount, 1n);
    const expiresAt = input.expiresAt ? timestamp(input.expiresAt) : null;
    await this.lockWorkspace(true);
    await this.client.query(
      `INSERT INTO tholi.credit_grants (workspace_id, id, idempotency_key, amount, expires_at)
       VALUES ($1, $2, $3, $4, $5) ON CONFLICT DO NOTHING`,
      [
        this.scope.workspaceId,
        input.id || randomUUID(),
        text(input.idempotencyKey, 200),
        amount,
        expiresAt,
      ],
    );
    const result = await this.client.query<Int8Row<CreditGrant, "amount">>(
      `SELECT id, amount::text, expires_at AS "expiresAt" FROM tholi.credit_grants
       WHERE workspace_id = $1 AND idempotency_key = $2`,
      [this.scope.workspaceId, input.idempotencyKey],
    );
    const row = result.rows[0];
    if (!row) conflict();
    if (
      row.amount !== amount ||
      (row.expiresAt?.toISOString() || null) !== expiresAt
    )
      replayConflict();
    return { ...row, amount: BigInt(row.amount) };
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
    return reservation(result.rows[0]);
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
      `UPDATE tholi.credit_reservations r SET status = $4, updated_at = now()
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
       WHERE workspace_id = $1 AND owner_account_id = $2 AND id = $3`,
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
       WHERE workspace_id = $1 AND owner_account_id = $2 AND sync_revision > $3
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
    await this.lockWorkspace();
    const stamp = await this.nextSyncRevision();
    const values = [
      ...this.parameters,
      input.id || randomUUID(),
      JSON.stringify(content),
      stamp,
    ];
    const result =
      input.expectedRevision === 0n
        ? await this.client.query<ArtifactRow>(
            `INSERT INTO tholi.saved_artifacts
             (workspace_id, owner_account_id, id, kind, content, sync_revision)
           VALUES ($1, $2, $3, 'saved_route', $4::jsonb, $5)
           ON CONFLICT DO NOTHING RETURNING ${artifactColumns}`,
            values,
          )
        : await this.client.query<ArtifactRow>(
            `UPDATE tholi.saved_artifacts SET content = $4::jsonb,
             sync_revision = $5, revision = revision + 1, updated_at = now()
           WHERE workspace_id = $1 AND owner_account_id = $2 AND id = $3
             AND revision = $6 AND deleted_at IS NULL RETURNING ${artifactColumns}`,
            [...values, input.expectedRevision.toString()],
          );
    if (!result.rows[0]) conflict();
    return artifact(result.rows[0]);
  }

  async tombstoneArtifact(
    id: string,
    expectedRevision: bigint,
  ): Promise<SavedArtifact> {
    integer(expectedRevision, 1n);
    await this.lockWorkspace();
    const stamp = await this.nextSyncRevision();
    const result = await this.client.query<ArtifactRow>(
      `UPDATE tholi.saved_artifacts SET content = NULL, deleted_at = now(),
         revision = revision + 1, sync_revision = $5, updated_at = now()
       WHERE workspace_id = $1 AND owner_account_id = $2 AND id = $3
         AND revision = $4 AND deleted_at IS NULL RETURNING ${artifactColumns}`,
      [...this.parameters, id, expectedRevision.toString(), stamp],
    );
    if (!result.rows[0]) conflict();
    return artifact(result.rows[0]);
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
    if (
      !Number.isInteger(input.version) ||
      input.version < 1 ||
      !Number.isInteger(maxAttempts) ||
      maxAttempts < 1 ||
      maxAttempts > 100
    )
      invalid("Use bounded job versions and attempt counts.");
    await this.client.query(
      `INSERT INTO tholi.jobs (workspace_id, account_id, id, request_id, kind,
         version, idempotency_key, record_references, available_at, max_attempts)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, COALESCE($9::timestamptz, now()), $10)
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
      ],
    );
    const row = (
      await this.client.query<Job>(
        `SELECT ${jobColumns} FROM tholi.jobs
       WHERE workspace_id = $1 AND account_id = $2 AND kind = $3 AND version = $4
         AND idempotency_key = $5`,
        [...this.parameters, input.kind, input.version, input.idempotencyKey],
      )
    ).rows[0];
    if (!row) conflict();
    if (
      row.requestId !== (input.requestId || null) ||
      row.maxAttempts !== maxAttempts ||
      !isDeepStrictEqual(row.recordReferences, references) ||
      (input.availableAt &&
        row.availableAt.toISOString() !== timestamp(input.availableAt))
    )
      replayConflict();
    return row;
  }

  async getJob(id: string): Promise<Job | undefined> {
    return (
      await this.client.query<Job>(
        `SELECT ${jobColumns} FROM tholi.jobs
       WHERE workspace_id = $1 AND account_id = $2 AND id = $3`,
        [...this.parameters, id],
      )
    ).rows[0];
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
