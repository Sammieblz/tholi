import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  ACCOUNT_EXPORT_LIMITS,
  accountExportInputSchema,
  accountExportStatusSchema,
  accountExportPartSchema,
  accountExportManifestSchema,
  type AccountExportInput,
  type AccountExportStatus,
  type AccountExportSection,
  type AccountExportPart,
  type AccountExportManifest,
  type AccountExportQuery,
  type AccountExportPage,
  accountDeletionResultSchema,
  type AccountDeletionInput,
} from "../../../../packages/navigation-core/contracts-account";
import { fakeDevelopmentChargingPolicy } from "../../../../packages/navigation-core/contracts-credits";
import { SUPPORT_LIMITS } from "../../../../packages/navigation-core/contracts-support";
import type { PostgresRepositories } from "./repositories";
import { RepositoryError, type RepositoryScope } from "./contracts";
import { setDatabaseScope } from "./postgres";
import { readIdentityContactsOnClient } from "./identity-contacts";

type Owner = Parameters<Parameters<PostgresRepositories["transaction"]>[1]>[0];
const globalSections = [
  "profile",
  "contacts",
  "sessions",
  "memberships",
] as const;
const workspaceSections = [
  "consents",
  "saved_data",
  "plans",
  "credits",
  "credit_history",
  "usage",
  "support",
  "product_events",
] as const;
const stateSchema = z
  .object({
    version: z.literal(1),
    generation: z.string().uuid(),
    revision: z.number().int().positive(),
    stage: z.enum(["global", "workspace", "done"]),
    section: z.number().int().min(0).max(12),
    workspaceId: z.string().uuid().nullable(),
    workspaceAfter: z.string().uuid().nullable(),
    cursor: z.string().max(512).nullable(),
    cutoff: z.string().datetime(),
    startedAt: z.string().datetime(),
    sessionId: z.string().uuid(),
    latest: accountExportStatusSchema.nullable(),
    omissions: accountExportManifestSchema.innerType().shape.omissions,
  })
  .strict();
type ExportState = z.infer<typeof stateSchema>;
export interface AccountExportBudget {
  rows: number;
  bytes: number;
  parts: number;
  pages: number;
}
export const DEFAULT_ACCOUNT_EXPORT_BUDGET: AccountExportBudget = {
  ...ACCOUNT_EXPORT_LIMITS,
  pages: 256,
};
const hash = (value: unknown) =>
  createHash("sha256").update(JSON.stringify(value)).digest("hex");
const plain = (value: unknown): unknown =>
  JSON.parse(
    JSON.stringify(value, (_key, item) =>
      typeof item === "bigint" ? item.toString() : item,
    ),
  );
const unavailable = () =>
  new RepositoryError(
    "CONFLICT",
    "The account export is unavailable or has changed.",
  );
const cursor = (state: ExportState) =>
  state.stage === "done"
    ? null
    : Buffer.from(
        JSON.stringify({
          generation: state.generation,
          revision: state.revision,
        }),
      ).toString("base64url");

/** Reuses the existing transaction, scoped read owners, request ledger and file queue. */
export class ScopedAccount {
  constructor(
    private readonly client: Pick<PoolClient, "query">,
    private readonly scope: RepositoryScope,
    private readonly owner: Owner,
    private readonly source: (scope: RepositoryScope) => Owner,
  ) {}
  private get parameters() {
    return [this.scope.workspaceId, this.scope.accountId];
  }

  private async currentState(
    generation: string,
    lock = false,
  ): Promise<ExportState> {
    const result = await this.client.query<{ state: unknown }>(
      `SELECT account_export_state AS state FROM tholi.requests WHERE workspace_id=$1 AND account_id=$2
       AND id=$3 AND operation='account.export.v1' ${lock ? "FOR UPDATE" : ""}`,
      [...this.parameters, generation],
    );
    if (!result.rows[0]?.state) throw unavailable();
    return stateSchema.parse(result.rows[0].state);
  }

  private async delivery(
    receipt: AccountExportStatus,
  ): Promise<AccountExportStatus> {
    const result = await this.client.query<{
      count: number;
      ready: boolean;
      allowed: boolean;
      failed: boolean;
      expired: boolean;
    }>(
      `SELECT count(*)::integer AS count,COALESCE(bool_and(f.status='ready'),false) AS ready,
        COALESCE(bool_and(tholi.current_account_export_allowed(f.snapshot)),false) AS allowed,
        COALESCE(bool_or(j.status IN ('failed','dead','cancelled','uncertain')),false) AS failed,
        COALESCE(bool_or(f.status IN ('deleted','deleting') OR f.expires_at<=clock_timestamp()),false) AS expired
       FROM tholi.private_files f JOIN tholi.jobs j ON j.workspace_id=f.workspace_id AND j.request_id=f.request_id
         AND j.kind='file.'||f.purpose WHERE f.workspace_id=$1 AND f.account_id=$2 AND f.account_export_generation=$3`,
      [...this.parameters, receipt.generation],
    );
    const state = result.rows[0];
    const delivery: AccountExportStatus["delivery"] =
      !state.count || state.expired
        ? "expired"
        : !state.allowed || state.failed
          ? "failed"
          : state.ready
            ? "ready"
            : "pending";
    return accountExportStatusSchema.parse({ ...receipt, delivery });
  }

  async exportStatus(generation: string) {
    const state = await this.currentState(generation);
    if (!state.latest) throw unavailable();
    return this.delivery(state.latest);
  }
  async listExports(query: AccountExportQuery): Promise<AccountExportPage> {
    let after: string | null = null;
    if (query.cursor) {
      try {
        const parsed = z
          .object({
            accountId: z.literal(this.scope.accountId),
            after: z.string().uuid(),
          })
          .strict()
          .parse(
            JSON.parse(Buffer.from(query.cursor, "base64url").toString("utf8")),
          );
        after = parsed.after;
      } catch {
        throw unavailable();
      }
    }
    const rows = (
      await this.client.query<{ id: string; state: unknown }>(
        `SELECT id,account_export_state AS state FROM tholi.requests WHERE workspace_id=$1 AND account_id=$2
        AND operation='account.export.v1' AND account_export_state IS NOT NULL AND ($3::uuid IS NULL OR id>$3)
       ORDER BY id LIMIT $4`,
        [...this.parameters, after, query.limit + 1],
      )
    ).rows;
    const items = [];
    for (const row of rows.slice(0, query.limit)) {
      const state = stateSchema.parse(row.state);
      if (state.latest) items.push(await this.delivery(state.latest));
    }
    return {
      items,
      ...(rows.length > query.limit
        ? {
            nextCursor: Buffer.from(
              JSON.stringify({
                accountId: this.scope.accountId,
                after: rows[query.limit - 1].id,
              }),
            ).toString("base64url"),
          }
        : {}),
    };
  }

  async requestDeletion(input: AccountDeletionInput, sessionId: string) {
    const { request, replayed } = await this.owner.beginRequest({
      operation: "account.delete.v1",
      idempotencyKey: input.operationId,
      payloadHash: hash({ expectedRevision: input.expectedRevision }),
    });
    if (replayed) {
      const row = (
        await this.client.query<{ receipt: unknown }>(
          "SELECT account_deletion_receipt AS receipt FROM tholi.requests WHERE workspace_id=$1 AND account_id=$2 AND id=$3",
          [...this.parameters, request.id],
        )
      ).rows[0];
      return accountDeletionResultSchema.parse(row?.receipt);
    }
    const job = await this.owner.enqueueJob({
      requestId: request.id,
      kind: "account.delete",
      version: 1,
      replaySafe: true,
      idempotencyKey: `account-delete:${request.id}`,
      recordReferences: {
        accountId: this.scope.accountId,
        requestId: request.id,
      },
    });
    const result = await this.client.query<{ receipt: unknown }>(
      "SELECT tholi.request_account_deletion($1,$2,$3,$4) AS receipt",
      [request.id, job.id, input.expectedRevision, sessionId],
    );
    return accountDeletionResultSchema.parse(result.rows[0]?.receipt);
  }

  private async read(
    state: ExportState,
    size: number,
  ): Promise<{
    section: AccountExportSection;
    items: unknown[];
    next: string | null;
  }> {
    const section =
      state.stage === "global"
        ? globalSections[state.section]
        : workspaceSections[state.section];
    if (!section) throw unavailable();
    const scope = {
      accountId: this.scope.accountId,
      workspaceId: state.workspaceId ?? this.scope.workspaceId,
    };
    await setDatabaseScope(this.client, scope);
    const owner = this.source(scope),
      after = state.cursor;
    const idPage = <T extends { id: string }>(items: T[]) => ({
      section,
      items,
      next: items.length === size ? items.at(-1)!.id : null,
    });
    if (section === "profile") {
      const row = (
        await this.client.query(
          `SELECT id AS "accountId",revision::text,created_at AS "createdAt",updated_at AS "updatedAt"
        FROM tholi.accounts WHERE id=$1 AND status='active'`,
          [scope.accountId],
        )
      ).rows[0];
      if (!row) throw unavailable();
      return { section, items: [plain(row)], next: null };
    }
    if (section === "contacts") {
      const items = await readIdentityContactsOnClient(
        this.client,
        scope.accountId,
        { after: after ?? undefined, limit: size },
      );
      return {
        section,
        items,
        next: items.length === size ? items.at(-1)!.identityId : null,
      };
    }
    if (section === "sessions") {
      const rows = (
        await this.client.query(
          `SELECT id,client_id AS "clientId",client_kind AS "clientKind",expires_at AS "expiresAt",
        created_at AS "createdAt",last_used_at AS "lastUsedAt",(id=$4) AS current FROM tholi.sessions
        WHERE account_id=$1 AND status='active' AND expires_at>clock_timestamp() AND created_at<=$3
          AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $5`,
          [scope.accountId, after, state.cutoff, state.sessionId, size],
        )
      ).rows;
      return idPage(rows.map((row) => plain(row) as { id: string }));
    }
    if (section === "memberships") {
      const items = (
        await this.client.query(
          `SELECT w.id AS "workspaceId",w.kind,m.role,m.status,m.revision::text FROM tholi.workspaces w
        JOIN tholi.memberships m ON m.workspace_id=w.id AND m.account_id=$1 AND m.status='active'
        WHERE w.created_at<=$3 AND ($2::uuid IS NULL OR w.id>$2) ORDER BY w.id LIMIT $4`,
          [scope.accountId, after, state.cutoff, size],
        )
      ).rows;
      return {
        section,
        items,
        next: items.length === size ? items.at(-1)!.workspaceId : null,
      };
    }
    const workspace = await owner.getWorkspace();
    if (
      ["credits", "credit_history"].includes(section) &&
      workspace.kind !== "personal"
    )
      return { section, items: [], next: null };
    if (section === "consents")
      return idPage(
        (
          await owner.listConsents({ after: after ?? undefined, limit: size })
        ).map((row) => plain(row) as { id: string }),
      );
    if (section === "saved_data") {
      if (
        after === null &&
        !state.omissions.some(
          (item) =>
            item.workspaceId === scope.workspaceId &&
            item.section === "saved_data",
        )
      ) {
        const legacy = (
          await this.client.query<{ present: boolean }>(
            `SELECT EXISTS(SELECT FROM tholi.saved_artifacts
          WHERE workspace_id=$1 AND owner_account_id=$2 AND format_version=1 AND deleted_at IS NULL) AS present`,
            [scope.workspaceId, scope.accountId],
          )
        ).rows[0].present;
        if (legacy && state.omissions.length < 100)
          state.omissions.push({
            workspaceId: scope.workspaceId,
            section: "saved_data",
            reason: "not-exportable",
          });
      }
      const ids = (
        await this.client.query<{ id: string }>(
          `SELECT id FROM tholi.saved_artifacts WHERE workspace_id=$1 AND owner_account_id=$2
        AND format_version=2 AND created_at<=$3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5`,
          [scope.workspaceId, scope.accountId, state.cutoff, after, size],
        )
      ).rows;
      const items = [];
      for (const row of ids) {
        const item = await owner.getSavedArtifact(row.id);
        if (item) items.push(item);
      }
      return {
        section,
        items,
        next: ids.length === size ? ids.at(-1)!.id : null,
      };
    }
    if (section === "plans") {
      if (after === null)
        return {
          section,
          items: [
            { kind: "effective", value: await owner.readEffectivePlan() },
          ],
          next: "entitlements",
        };
      const rows = await owner.listEntitlements({
        after: after === "entitlements" ? undefined : after,
        limit: size,
      });
      return {
        section,
        items: rows.map((row) => ({ kind: "entitlement", value: plain(row) })),
        next: rows.length === size ? rows.at(-1)!.id : null,
      };
    }
    if (section === "credits")
      return {
        section,
        items: [
          {
            balance: plain(await owner.creditBalance()),
            policy: fakeDevelopmentChargingPolicy,
          },
        ],
        next: null,
      };
    if (section === "credit_history" || section === "usage") {
      const page =
        section === "usage"
          ? await owner.listUsage({ after: after ?? undefined, limit: size })
          : await owner.listCreditHistory({
              after: after ?? undefined,
              limit: size,
            });
      const items = page.items
        .filter((item) => item.createdAt.getTime() <= Date.parse(state.cutoff))
        .map(plain);
      return {
        section,
        items,
        next:
          items.length < page.items.length ? null : (page.nextCursor ?? null),
      };
    }
    if (section === "support") {
      const rows = (
        await this.client.query(
          `SELECT s.request_id AS "requestId",s.name,s.email,s.topic,s.subject,s.message,
        r.created_at AS "createdAt",s.purged_at AS "purgedAt",s.expires_at AS "expiresAt"
        FROM tholi.support_requests s JOIN tholi.requests r ON r.workspace_id=s.workspace_id AND r.id=s.request_id
        WHERE s.workspace_id=$1 AND s.account_id=$2 AND r.created_at<=$3 AND ($4::uuid IS NULL OR s.request_id>$4)
        ORDER BY s.request_id LIMIT $5`,
          [scope.workspaceId, scope.accountId, state.cutoff, after, size],
        )
      ).rows;
      return {
        section,
        items: rows.map(plain),
        next: rows.length === size ? rows.at(-1)!.requestId : null,
      };
    }
    const rows = await owner.listProductEvents({
      after: after ?? undefined,
      limit: size,
    });
    return {
      section,
      items: rows
        .filter((item) => item.recordedAt.getTime() <= Date.parse(state.cutoff))
        .map(plain),
      next: rows.length === size ? rows.at(-1)!.eventId : null,
    };
  }

  private async advanceSource(state: ExportState) {
    state.cursor = null;
    state.section++;
    if (state.stage === "global" && state.section >= globalSections.length) {
      state.stage = "workspace";
      state.section = 0;
    }
    if (
      state.stage === "workspace" &&
      state.section >= workspaceSections.length
    ) {
      state.workspaceAfter = state.workspaceId;
      state.workspaceId = null;
      state.section = 0;
    }
  }

  async prepareExport(
    raw: AccountExportInput,
    sessionId: string,
    budget = DEFAULT_ACCOUNT_EXPORT_BUDGET,
    signal?: AbortSignal,
  ): Promise<AccountExportStatus> {
    const input = accountExportInputSchema.parse(raw);
    let selected: { generation: string; revision: number } | null = null;
    if (input.continuation) {
      try {
        selected = z
          .object({
            generation: z.string().uuid(),
            revision: z.number().int().positive(),
          })
          .strict()
          .parse(
            JSON.parse(
              Buffer.from(input.continuation, "base64url").toString("utf8"),
            ),
          );
      } catch {
        throw unavailable();
      }
    }
    const page = await this.owner.beginRequest({
      operation: selected ? "account.export.continue.v1" : "account.export.v1",
      idempotencyKey: input.idempotencyKey,
      payloadHash: hash({ continuation: input.continuation ?? null }),
    });
    if (page.replayed) {
      const old = (
        await this.client.query<{ receipt: unknown }>(
          `SELECT account_export_receipt AS receipt FROM tholi.requests
        WHERE workspace_id=$1 AND account_id=$2 AND id=$3`,
          [...this.parameters, page.request.id],
        )
      ).rows[0];
      return this.delivery(accountExportStatusSchema.parse(old?.receipt));
    }
    await this.owner.withSupport((queries) =>
      queries.quota(page.request.operation),
    );
    const now = new Date().toISOString();
    const state: ExportState = selected
      ? await this.currentState(selected.generation, true)
      : {
          version: 1,
          generation: page.request.id,
          revision: 1,
          stage: "global",
          section: 0,
          workspaceId: null,
          workspaceAfter: null,
          cursor: null,
          cutoff: now,
          startedAt: now,
          sessionId,
          latest: null,
          omissions: [],
        };
    if (
      selected &&
      (selected.revision !== state.revision || state.stage === "done")
    )
      throw unavailable();
    const parts: AccountExportManifest["parts"] = [],
      workspaceIds = new Set<string>();
    let bytes = 0,
      rows = 0;
    try {
      for (
        let pages = 0;
        pages < budget.pages &&
        state.stage !== "done" &&
        rows < budget.rows &&
        parts.length < budget.parts;
        pages++
      ) {
        signal?.throwIfAborted();
        if (state.stage === "workspace" && state.workspaceId === null) {
          await setDatabaseScope(this.client, this.scope);
          const next = (
            await this.client.query<{ id: string }>(
              `SELECT w.id FROM tholi.workspaces w JOIN tholi.memberships m
            ON m.workspace_id=w.id AND m.account_id=$1 AND m.status='active' WHERE w.created_at<=$3
            AND ($2::uuid IS NULL OR w.id>$2) ORDER BY w.id LIMIT 1`,
              [this.scope.accountId, state.workspaceAfter, state.cutoff],
            )
          ).rows[0];
          if (!next) {
            state.stage = "done";
            break;
          }
          state.workspaceId = next.id;
        }
        if (state.workspaceId) {
          const allowed = (
            await this.client.query<{ allowed: boolean }>(
              "SELECT tholi.current_member_role($1) IS NOT NULL AS allowed",
              [state.workspaceId],
            )
          ).rows[0].allowed;
          if (!allowed) {
            if (state.omissions.length < 100)
              state.omissions.push({
                workspaceId: state.workspaceId,
                section: workspaceSections[state.section],
                reason: "workspace-access-revoked",
              });
            state.workspaceAfter = state.workspaceId;
            state.workspaceId = null;
            state.section = 0;
            state.cursor = null;
            continue;
          }
        }
        let size = Math.min(100, budget.rows - rows),
          source: Awaited<ReturnType<ScopedAccount["read"]>>;
        let candidate: {
          body: AccountExportPart;
          bytes: number;
          sha256: string;
        }[] = [];
        while (true) {
          source = await this.read(state, size);
          candidate = [];
          for (const item of source.items) {
            let last = candidate.at(-1);
            const create = (items: unknown[]) =>
              accountExportPartSchema.parse({
                schemaVersion: 1,
                kind: "account-export-part",
                generation: state.generation,
                accountId: this.scope.accountId,
                workspaceId: state.workspaceId,
                cutoff: state.cutoff,
                section: source.section,
                items,
              });
            const combined = create([...(last?.body.items ?? []), item]),
              encoded = Buffer.from(JSON.stringify(combined));
            if (last && encoded.byteLength <= SUPPORT_LIMITS.maxFileBytes) {
              last.body = combined;
              last.bytes = encoded.byteLength;
              last.sha256 = hash(combined);
            } else {
              const body = create([item]),
                amount = Buffer.byteLength(JSON.stringify(body));
              if (amount > SUPPORT_LIMITS.maxFileBytes)
                throw new RepositoryError(
                  "INVALID_INPUT",
                  "One export record exceeds the private file limit.",
                );
              candidate.push({ body, bytes: amount, sha256: hash(body) });
            }
          }
          const amount = candidate.reduce((sum, item) => sum + item.bytes, 0);
          if (
            bytes + amount <= budget.bytes - SUPPORT_LIMITS.maxFileBytes / 2 &&
            parts.length + candidate.length <= budget.parts
          )
            break;
          if (rows > 0 || size <= 1) {
            candidate = [];
            break;
          }
          size = Math.max(1, Math.floor(size / 2));
        }
        if (!candidate.length && source!.items.length) break;
        await setDatabaseScope(this.client, this.scope);
        for (const item of candidate) {
          const request = await this.owner.beginRequest({
            operation: "account.export.part.v1",
            idempotencyKey: `${page.request.id}:part:${parts.length}`,
            payloadHash: item.sha256,
          });
          const file = await this.owner.withSupport((queries) =>
            queries.createFile(
              request.request.id,
              item.body,
              "account-export-part",
            ),
          );
          parts.push({
            fileId: file.fileId,
            section: source!.section,
            workspaceId: state.workspaceId,
            count: item.body.items.length,
            bytes: item.bytes,
            sha256: item.sha256,
          });
          bytes += item.bytes;
        }
        rows += source!.items.length;
        if (state.workspaceId) workspaceIds.add(state.workspaceId);
        state.cursor = source!.next;
        if (source!.next === null) await this.advanceSource(state);
      }
    } finally {
      await setDatabaseScope(this.client, this.scope);
    }
    state.revision++;
    const continuation = cursor(state);
    const manifest = accountExportManifestSchema.parse({
      schemaVersion: 1,
      kind: "account-export-manifest",
      generation: state.generation,
      accountId: this.scope.accountId,
      startedAt: state.startedAt,
      completedAt: new Date().toISOString(),
      cutoff: state.cutoff,
      consistency: "collected-over-interval",
      scope: {
        workspaces: "current-memberships",
        workspaceIds: [...workspaceIds],
      },
      parts,
      previousManifestFileId: state.latest?.fileId ?? null,
      continuation,
      complete: state.stage === "done" && !state.omissions.length,
      omissions: state.omissions,
    });
    const file = await this.owner.withSupport((queries) =>
      queries.createFile(page.request.id, manifest, "account-export-manifest"),
    );
    const stored = (
      await this.client.query<{ expiresAt: Date }>(
        'SELECT expires_at AS "expiresAt" FROM tholi.private_files WHERE workspace_id=$1 AND account_id=$2 AND id=$3',
        [...this.parameters, file.fileId],
      )
    ).rows[0];
    const receipt = accountExportStatusSchema.parse({
      ...file,
      generation: state.generation,
      preparation: manifest.complete ? "complete" : "partial",
      delivery: "pending",
      continuation,
      expiresAt: stored.expiresAt.toISOString(),
    });
    state.latest = receipt;
    await this.client.query(
      `UPDATE tholi.requests SET account_export_receipt=$4::jsonb WHERE workspace_id=$1 AND account_id=$2 AND id=$3`,
      [...this.parameters, page.request.id, JSON.stringify(receipt)],
    );
    await this.client.query(
      `UPDATE tholi.requests SET account_export_state=$4::jsonb WHERE workspace_id=$1 AND account_id=$2 AND id=$3`,
      [...this.parameters, state.generation, JSON.stringify(state)],
    );
    return receipt;
  }
}
