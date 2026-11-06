import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { z } from "zod";
import {
  ACCOUNT_EXPORT_LIMITS,
  accountExportInputSchema,
  accountExportStatusSchema,
  accountExportPartSchema,
  accountExportPartV2Schema,
  accountExportManifestV2Schema,
  accountExportManifestSchema,
  type AccountExportInput,
  type AccountExportStatus,
  type AccountExportSectionV2 as AccountExportSection,
  type AccountExportPartV2 as AccountExportPart,
  type AccountExportManifestV2 as AccountExportManifest,
  type AccountExportQuery,
  type AccountExportPage,
  accountDeletionResultSchema,
  type AccountDeletionInput,
} from "../../../../packages/navigation-core/contracts-account";
import {
  providerConnectionMetadataColumns,
  providerConnectionMetadataRow,
  type ProviderConnectionMetadataRow,
} from "./provider-connections";
import { navigationKnowledgeSiteSettingsSchema } from "../../../../packages/navigation-core/contracts-navigation-knowledge";
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
const globalSectionsV2 = [...globalSections, "provider_connections"] as const;
const workspaceSectionsV2 = [...workspaceSections, "site_settings"] as const;
const stateSchema = z
  .object({
    version: z.literal(1),
    savedDataSchemaVersion: z.literal(2).optional(),
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
    omissions: accountExportManifestV2Schema.innerType().shape.omissions,
  })
  .strict();
type ExportState = z.infer<typeof stateSchema>;
const globals = (state: ExportState) =>
  state.savedDataSchemaVersion === 2 ? globalSectionsV2 : globalSections;
const workspaces = (state: ExportState) =>
  state.savedDataSchemaVersion === 2 ? workspaceSectionsV2 : workspaceSections;
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
          ...(state.savedDataSchemaVersion === 2 ? { schemaVersion: 2 } : {}),
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
        ? globals(state)[state.section]
        : workspaces(state)[state.section];
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
    if (section === "provider_connections") {
      const rows = (
        await this.client.query<ProviderConnectionMetadataRow>(
          `SELECT ${providerConnectionMetadataColumns} FROM tholi.provider_connections
         WHERE account_id=$1 AND created_at<=$3 AND ($2::uuid IS NULL OR id>$2) ORDER BY id LIMIT $4`,
          [scope.accountId, after, state.cutoff, size],
        )
      ).rows;
      return idPage(rows.map(providerConnectionMetadataRow));
    }
    if (section === "site_settings") {
      const rows = (
        await this.client.query<{
          origin: string;
          revision: string;
          collect: boolean;
          use: boolean;
          updatedAt: Date;
        }>(
          `SELECT origin,revision::text,(collect AND last_activity_at>clock_timestamp()-interval '2160 hours') AS collect,
          (use_knowledge AND last_activity_at>clock_timestamp()-interval '2160 hours') AS use,updated_at AS "updatedAt"
         FROM tholi.navigation_knowledge_sites WHERE workspace_id=$1 AND account_id=$2
         AND updated_at<=$3 AND ($4::text IS NULL OR origin>$4) ORDER BY origin LIMIT $5`,
          [scope.workspaceId, scope.accountId, state.cutoff, after, size],
        )
      ).rows;
      return {
        section,
        items: rows.map((row) =>
          navigationKnowledgeSiteSettingsSchema.parse({
            ...row,
            updatedAt: row.updatedAt.toISOString(),
          }),
        ),
        next: rows.length === size ? rows.at(-1)!.origin : null,
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
          WHERE workspace_id=$1 AND owner_account_id=$2 AND (format_version=1 OR ($3::integer=1 AND format_version=3)) AND deleted_at IS NULL) AS present`,
            [
              scope.workspaceId,
              scope.accountId,
              state.savedDataSchemaVersion ?? 1,
            ],
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
        AND format_version=ANY($6::integer[]) AND created_at<=$3 AND ($4::uuid IS NULL OR id>$4) ORDER BY id LIMIT $5`,
          [
            scope.workspaceId,
            scope.accountId,
            state.cutoff,
            after,
            size,
            state.savedDataSchemaVersion === 2 ? [2, 3] : [2],
          ],
        )
      ).rows;
      const items = [];
      for (const row of ids) {
        const item = await owner.getSavedArtifact(
          row.id,
          state.savedDataSchemaVersion ?? 1,
        );
        if (item) items.push(item);
        else if (
          state.omissions.length < 100 &&
          !state.omissions.some(
            (omission) =>
              omission.workspaceId === scope.workspaceId &&
              omission.section === "saved_data",
          )
        )
          state.omissions.push({
            workspaceId: scope.workspaceId,
            section: "saved_data",
            reason: "changed-during-collection",
          });
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
      if (
        section === "usage" &&
        state.savedDataSchemaVersion !== 2 &&
        after === null &&
        !state.omissions.some(
          (item) =>
            item.workspaceId === scope.workspaceId && item.section === "usage",
        )
      ) {
        const omitted = (
          await this.client.query<{ present: boolean }>(
            `SELECT EXISTS(SELECT FROM tholi.usage_records u JOIN tholi.requests q
              ON q.workspace_id=u.workspace_id AND q.id=u.request_id
              WHERE u.workspace_id=$1 AND q.account_id=$2
                AND u.funding_source='customer' AND u.created_at<=$3) AS present`,
            [scope.workspaceId, scope.accountId, state.cutoff],
          )
        ).rows[0].present;
        if (omitted && state.omissions.length < 100)
          state.omissions.push({
            workspaceId: scope.workspaceId,
            section: "usage",
            reason: "not-exportable",
          });
      }
      const page =
        section === "usage"
          ? await owner.listUsage(
              { after: after ?? undefined, limit: size },
              state.savedDataSchemaVersion ?? 1,
            )
          : await owner.listCreditHistory({
              after: after ?? undefined,
              limit: size,
            });
      const items = page.items
        .filter((item) => item.createdAt.getTime() <= Date.parse(state.cutoff))
        .map((item) => {
          const value = plain(item) as Record<string, unknown>;
          if (section === "usage") {
            const keys = [
              "fundingSource",
              "usageVersion",
              "customerUsdMicros",
              "cacheReadInputUnits",
              "cacheWriteInputUnits",
              "reasoningOutputUnits",
            ];
            if (state.savedDataSchemaVersion !== 2)
              for (const key of keys) delete value[key];
            else {
              value.fundingSource ??= "managed";
              value.usageVersion ??= 1;
              for (const key of keys.slice(2)) value[key] ??= null;
            }
          }
          return value;
        });
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
    if (state.stage === "global" && state.section >= globals(state).length) {
      state.stage = "workspace";
      state.section = 0;
    }
    if (
      state.stage === "workspace" &&
      state.section >= workspaces(state).length
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
    let selected: {
      generation: string;
      revision: number;
      schemaVersion?: 2;
    } | null = null;
    if (input.continuation) {
      try {
        selected = z
          .object({
            generation: z.string().uuid(),
            revision: z.number().int().positive(),
            schemaVersion: z.literal(2).optional(),
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
      payloadHash: hash({
        continuation: input.continuation ?? null,
        ...(input.schemaVersion === 2 ? { schemaVersion: 2 } : {}),
      }),
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
          ...(input.schemaVersion === 2
            ? { savedDataSchemaVersion: 2 as const }
            : {}),
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
      (selected.revision !== state.revision ||
        state.stage === "done" ||
        (selected.schemaVersion ?? 1) !== (state.savedDataSchemaVersion ?? 1) ||
        (input.schemaVersion ?? 1) !== (state.savedDataSchemaVersion ?? 1))
    )
      throw unavailable();
    if (state.savedDataSchemaVersion !== 2 && state.omissions.length < 98) {
      const omitted = (
        await this.client.query<{ providers: boolean; settings: boolean }>(
          `SELECT EXISTS(SELECT FROM tholi.provider_connections WHERE account_id=$1) AS providers,
          EXISTS(SELECT FROM tholi.navigation_knowledge_sites WHERE account_id=$1) AS settings`,
          [this.scope.accountId],
        )
      ).rows[0];
      if (
        omitted.providers &&
        !state.omissions.some(
          (item) => item.workspaceId === null && item.section === "profile",
        )
      )
        state.omissions.push({
          workspaceId: null,
          section: "profile",
          reason: "not-exportable",
        });
      if (
        omitted.settings &&
        !state.omissions.some(
          (item) =>
            item.workspaceId === this.scope.workspaceId &&
            item.section === "saved_data",
        )
      )
        state.omissions.push({
          workspaceId: this.scope.workspaceId,
          section: "saved_data",
          reason: "not-exportable",
        });
    }
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
                section: workspaces(state)[state.section],
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
              (state.savedDataSchemaVersion === 2
                ? accountExportPartV2Schema
                : accountExportPartSchema
              ).parse({
                schemaVersion:
                  state.savedDataSchemaVersion === 2 &&
                  [
                    "saved_data",
                    "site_settings",
                    "provider_connections",
                    "usage",
                  ].includes(source.section)
                    ? 2
                    : 1,
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
    const manifest = (
      state.savedDataSchemaVersion === 2
        ? accountExportManifestV2Schema
        : accountExportManifestSchema
    ).parse({
      schemaVersion: state.savedDataSchemaVersion ?? 1,
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
