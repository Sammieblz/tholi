import { createHash, randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import {
  diagnosticSnapshotSchema,
  supportInputSchema,
  SUPPORT_LIMITS,
} from "../../../../packages/navigation-core/contracts-support";
import { jobStatusSchema } from "../../../../packages/navigation-core/contracts-jobs";
import { diagnosticBytes } from "../application/private-files";
import { savedDataExportBytes } from "../application/private-files";
import {
  savedDataExportInputSchema,
  savedDataExportSnapshotSchema,
} from "../../../../packages/navigation-core/contracts-saved-data";
import type {
  ApprovedMail,
  DiagnosticRecord,
  PreparedExternal,
  PrivateFile,
  SupportCommand,
  SupportRecord,
} from "../application/support-contracts";
import type { JobLease } from "../application/job-contracts";
import { RepositoryError, type RepositoryScope } from "./contracts";
import type { PostgresRepositories } from "./repositories";

type ScopeOwner = Parameters<
  Parameters<PostgresRepositories["transaction"]>[1]
>[0];
const fileColumns = `id,workspace_id AS "workspaceId",request_id AS "requestId",revision::text,object_key AS key,bytes,
  encode(checksum,'hex') AS sha256,content_type AS "contentType",expires_at AS "expiresAt",status,purpose`;
type FileRow = Omit<PrivateFile, "revision"> & {
  revision: string;
  snapshot?: unknown;
};
const file = (row: FileRow): PrivateFile => ({
  ...row,
  revision: BigInt(row.revision),
});
const unavailable = () =>
  new RepositoryError("FORBIDDEN", "The requested workflow is unavailable.");

/** Uses the existing scoped transaction's guarded client and request/job owners. */
export class ScopedSupport {
  constructor(
    private readonly client: Pick<PoolClient, "query">,
    private readonly scope: RepositoryScope,
    private readonly owner: ScopeOwner,
  ) {}

  private get parameters() {
    return [this.scope.workspaceId, this.scope.accountId];
  }

  private async quota(operation: string) {
    const result = await this.client.query<{ hour: number; day: number }>(
      `SELECT count(*) FILTER(WHERE created_at>clock_timestamp()-interval '1 hour')::integer AS hour,
        count(*)::integer AS day FROM tholi.requests WHERE workspace_id=$1 AND account_id=$2 AND operation=$3
        AND created_at>clock_timestamp()-interval '1 day'`,
      [...this.parameters, operation],
    );
    if (
      result.rows[0].hour > SUPPORT_LIMITS.hourlyRequests ||
      result.rows[0].day > SUPPORT_LIMITS.dailyRequests
    )
      throw new RepositoryError(
        "RATE_LIMITED",
        "The request allowance has been reached. Try again later.",
      );
  }

  async submit(command: SupportCommand): Promise<SupportRecord> {
    const { payloadHash, ...submitted } = command;
    const input = supportInputSchema.parse(submitted);
    const { request, replayed } = await this.owner.beginRequest({
      operation: "support.request.v1",
      idempotencyKey: input.idempotencyKey,
      payloadHash,
    });
    if (replayed) {
      const old = await this.client.query<
        SupportRecord & {
          name: string | null;
          email: string | null;
          topic: string;
          subject: string | null;
          message: string | null;
          purged: boolean;
        }
      >(
        `SELECT request_id AS id,operator_job_id AS "operatorJobId",receipt_job_id AS "receiptJobId",expires_at AS "expiresAt",
          name,email,topic,subject,message,purged_at IS NOT NULL AS purged FROM tholi.support_requests
          WHERE workspace_id=$1 AND account_id=$2 AND request_id=$3`,
        [...this.parameters, request.id],
      );
      const row = old.rows[0];
      if (
        !row ||
        (!row.purged &&
          ((row.name ?? undefined) !== input.name ||
            row.email !== input.email ||
            row.topic !== input.topic ||
            row.subject !== input.subject ||
            row.message !== input.message))
      )
        throw new RepositoryError(
          "IDEMPOTENCY_CONFLICT",
          "The operation key was used for a different command.",
        );
      return {
        id: row.id,
        operatorJobId: row.operatorJobId,
        receiptJobId: row.receiptJobId,
        expiresAt: row.expiresAt,
      };
    }
    await this.quota("support.request.v1");
    const contacts = await this.client.query<{
      identity_id: string;
      revision: string;
      email: string | null;
    }>(
      `SELECT identity_id,revision::text,email FROM tholi.identity_delivery_contacts WHERE account_id=$1
        ORDER BY provider_issued_at DESC,identity_id LIMIT 1`,
      [this.scope.accountId],
    );
    const contact = contacts.rows[0]?.email ? contacts.rows[0] : undefined;
    const enqueue = (kind: string) =>
      this.owner.enqueueJob({
        requestId: request.id,
        kind,
        version: 1,
        replaySafe: true,
        idempotencyKey: `${kind}:${request.id}`,
        recordReferences: { requestId: request.id },
      });
    const operator = await enqueue("support.operator");
    const receipt = contact ? await enqueue("support.received") : undefined;
    const inserted = await this.client.query<{ expiresAt: Date }>(
      `INSERT INTO tholi.support_requests(workspace_id,account_id,request_id,name,email,topic,subject,message,
        operator_job_id,receipt_job_id,receipt_identity_id,receipt_contact_revision,expires_at)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,clock_timestamp()+$13*interval '1 millisecond') RETURNING expires_at AS "expiresAt"`,
      [
        ...this.parameters,
        request.id,
        input.name ?? null,
        input.email,
        input.topic,
        input.subject,
        input.message,
        operator.id,
        receipt?.id ?? null,
        contact?.identity_id ?? null,
        contact?.revision ?? null,
        SUPPORT_LIMITS.supportRetentionMs,
      ],
    );
    return {
      id: request.id,
      operatorJobId: operator.id,
      receiptJobId: receipt?.id ?? null,
      expiresAt: inserted.rows[0].expiresAt,
    };
  }

  async requestDiagnostic(input: {
    idempotencyKey: string;
    payloadHash: string;
    version: string;
  }): Promise<DiagnosticRecord> {
    const { request, replayed } = await this.owner.beginRequest({
      operation: "diagnostic.export.v1",
      idempotencyKey: input.idempotencyKey,
      payloadHash: input.payloadHash,
    });
    if (replayed) {
      const old = await this.client.query<
        DiagnosticRecord & { version: string }
      >(
        `SELECT f.request_id AS "requestId",j.id AS "jobId",f.id AS "fileId",f.snapshot->>'version' AS version
          FROM tholi.private_files f JOIN tholi.jobs j ON j.workspace_id=f.workspace_id AND j.request_id=f.request_id AND j.kind='file.diagnostic'
          WHERE f.workspace_id=$1 AND f.account_id=$2 AND f.request_id=$3`,
        [...this.parameters, request.id],
      );
      if (
        !old.rows[0] ||
        (old.rows[0].version !== null && old.rows[0].version !== input.version)
      )
        throw new RepositoryError(
          "IDEMPOTENCY_CONFLICT",
          "The operation key was used for a different command.",
        );
      return {
        requestId: request.id,
        jobId: old.rows[0].jobId,
        fileId: old.rows[0].fileId,
      };
    }
    await this.quota("diagnostic.export.v1");
    const counts = await this.client.query<{ status: string; count: string }>(
      "SELECT status,count(*)::text AS count FROM tholi.jobs WHERE workspace_id=$1 AND account_id=$2 GROUP BY status",
      this.parameters,
    );
    const jobs = Object.fromEntries(
      jobStatusSchema.options.map((status) => [status, 0]),
    );
    for (const row of counts.rows) jobs[row.status] = Number(row.count);
    const snapshot = diagnosticSnapshotSchema.parse({
      schemaVersion: 1,
      version: input.version,
      profile: "service",
      accountStatus: "active",
      workspaceKind: "personal",
      role: "owner",
      jobs,
    });
    return this.createFile(request.id, snapshot, "diagnostic");
  }

  private async createFile(
    requestId: string,
    snapshot: unknown,
    purpose: NonNullable<PrivateFile["purpose"]>,
  ): Promise<DiagnosticRecord> {
    const encoded =
        purpose === "diagnostic"
          ? diagnosticBytes(snapshot)
          : savedDataExportBytes(snapshot),
      id = randomUUID();
    await this.client.query(
      `INSERT INTO tholi.private_files(workspace_id,account_id,id,request_id,object_key,content_type,bytes,checksum,snapshot,expires_at,purpose)
        VALUES($1,$2,$3,$4,$5,'application/json',$6,decode($7,'hex'),$8::jsonb,clock_timestamp()+$9*interval '1 millisecond',$10)`,
      [
        ...this.parameters,
        id,
        requestId,
        `exports/${this.scope.workspaceId}/${id}.json`,
        encoded.bytes,
        encoded.sha256,
        JSON.stringify(snapshot),
        SUPPORT_LIMITS.fileRetentionMs,
        purpose,
      ],
    );
    const queued = await this.owner.enqueueJob({
      requestId,
      kind:
        purpose === "diagnostic" ? "file.diagnostic" : "file.saved-data-export",
      version: 1,
      replaySafe: true,
      idempotencyKey: `${purpose}:${requestId}`,
      recordReferences: { requestId },
    });
    return { requestId, jobId: queued.id, fileId: id };
  }

  async requestSavedExport(raw: {
    idempotencyKey: string;
    payloadHash: string;
    ids: string[];
  }): Promise<DiagnosticRecord> {
    const input = savedDataExportInputSchema.parse({
      idempotencyKey: raw.idempotencyKey,
      ids: raw.ids,
    });
    const { request, replayed } = await this.owner.beginRequest({
      operation: "saved-data.export.v1",
      idempotencyKey: input.idempotencyKey,
      payloadHash: raw.payloadHash,
    });
    if (replayed) {
      const old = await this.client.query<DiagnosticRecord>(
        `SELECT f.request_id AS "requestId",j.id AS "jobId",f.id AS "fileId" FROM tholi.private_files f
         JOIN tholi.jobs j ON j.workspace_id=f.workspace_id AND j.request_id=f.request_id AND j.kind='file.saved-data-export'
         WHERE f.workspace_id=$1 AND f.account_id=$2 AND f.request_id=$3 AND f.purpose='saved-data-export'`,
        [...this.parameters, request.id],
      );
      if (!old.rows[0]) throw unavailable();
      return old.rows[0];
    }
    await this.quota("saved-data.export.v1");
    const items = [];
    for (const id of input.ids) {
      const item = await this.owner.getSavedArtifact(id);
      if (!item || item.deletedAt !== null) throw unavailable();
      items.push(item);
    }
    const snapshot = savedDataExportSnapshotSchema.parse({
      schemaVersion: 1,
      kind: "saved-data-export",
      createdAt: new Date().toISOString(),
      items,
    });
    return this.createFile(request.id, snapshot, "saved-data-export");
  }

  async getFile(id: string): Promise<PrivateFile | null> {
    const result = await this.client.query<FileRow>(
      `SELECT ${fileColumns} FROM tholi.private_files WHERE workspace_id=$1 AND account_id=$2 AND id=$3 AND expires_at>clock_timestamp()`,
      [...this.parameters, id],
    );
    return result.rows[0] ? file(result.rows[0]) : null;
  }

  async prepareExternal(lease: JobLease): Promise<PreparedExternal | null> {
    if (
      lease.version !== 1 ||
      ![
        "support.operator",
        "support.received",
        "file.diagnostic",
        "file.saved-data-export",
      ].includes(lease.kind)
    )
      throw unavailable();
    const selected = await this.client.query<{
      request_id: string;
      claim_token: string;
    }>(
      `SELECT request_id,claim_token FROM tholi.jobs WHERE workspace_id=$1 AND account_id=$2 AND id=$3 AND claim_token=$4
        AND kind=$5 AND version=$6 AND status='running' AND cancel_requested_at IS NULL AND lease_expires_at>clock_timestamp() FOR UPDATE`,
      [
        ...this.parameters,
        lease.id,
        lease.leaseToken,
        lease.kind,
        lease.version,
      ],
    );
    const row = selected.rows[0];
    if (!row) return null;
    if (
      JSON.stringify(lease.recordReferences) !==
      JSON.stringify({ requestId: row.request_id })
    )
      throw unavailable();
    let command: PreparedExternal["command"];
    if (
      lease.kind === "file.diagnostic" ||
      lease.kind === "file.saved-data-export"
    ) {
      const found = await this.client.query<FileRow>(
        `SELECT ${fileColumns},snapshot FROM tholi.private_files WHERE workspace_id=$1 AND account_id=$2 AND request_id=$3
          AND status='pending' AND expires_at>clock_timestamp()`,
        [...this.parameters, row.request_id],
      );
      if (!found.rows[0]) throw unavailable();
      const { snapshot, ...metadata } = found.rows[0];
      if (
        metadata.purpose !==
        (lease.kind === "file.diagnostic" ? "diagnostic" : "saved-data-export")
      )
        throw unavailable();
      const encoded =
        metadata.purpose === "diagnostic"
          ? diagnosticBytes(snapshot)
          : savedDataExportBytes(snapshot);
      if (
        encoded.bytes !== metadata.bytes ||
        encoded.sha256 !== metadata.sha256
      )
        throw unavailable();
      command = { type: "put", file: file(metadata), body: encoded.body };
    } else {
      const found = await this.client.query<{
        name: string | null;
        email: string;
        topic: SupportCommand["topic"];
        subject: string;
        message: string;
        recipient: string | null;
        contact_current: boolean;
      }>(
        `SELECT s.name,s.email,s.topic,s.subject,s.message,c.email AS recipient,
          c.revision=s.receipt_contact_revision AS contact_current FROM tholi.support_requests s
          LEFT JOIN tholi.identity_delivery_contacts c ON c.identity_id=s.receipt_identity_id AND c.account_id=s.account_id
          WHERE s.workspace_id=$1 AND s.account_id=$2 AND s.request_id=$3 AND s.purged_at IS NULL AND s.expires_at>clock_timestamp()`,
        [...this.parameters, row.request_id],
      );
      const support = found.rows[0];
      if (
        !support ||
        (lease.kind === "support.received" &&
          (!support.recipient || !support.contact_current))
      )
        throw unavailable();
      const base = {
        templateVersion: 1 as const,
        messageId: lease.id,
        requestId: row.request_id,
        subject: support.subject,
      };
      const message: ApprovedMail =
        lease.kind === "support.operator"
          ? {
              ...base,
              template: "support.operator",
              ...(support.name ? { name: support.name } : {}),
              email: support.email,
              topic: support.topic,
              message: support.message,
            }
          : {
              ...base,
              template: "support.received",
              recipient: support.recipient!,
            };
      command = { type: "mail", message };
    }
    const commandHash = createHash("sha256")
      .update(
        command.type === "mail"
          ? JSON.stringify(command.message)
          : `${command.file.key}:${command.file.sha256}`,
      )
      .digest("hex");
    await this.client.query(
      `INSERT INTO tholi.external_effects(workspace_id,id,job_id,command_hash)
      VALUES($1,$2,$3,decode($4,'hex')) ON CONFLICT(workspace_id,job_id) DO NOTHING`,
      [this.scope.workspaceId, lease.id, lease.id, commandHash],
    );
    const effects = await this.client.query<{
      id: string;
      commandHash: string;
    }>(
      `SELECT id,encode(command_hash,'hex') AS "commandHash" FROM tholi.external_effects WHERE workspace_id=$1 AND job_id=$2`,
      [this.scope.workspaceId, lease.id],
    );
    const effect = effects.rows[0];
    if (!effect || effect.commandHash !== commandHash)
      throw new RepositoryError("CONFLICT", "The external effect has changed.");
    const attempts = await this.client.query<{
      id: string;
      state: string;
      claim_token: string;
    }>(
      `SELECT id,state,claim_token FROM tholi.external_attempts WHERE workspace_id=$1 AND effect_id=$2 ORDER BY started_at DESC,id DESC`,
      [this.scope.workspaceId, effect.id],
    );
    if (
      attempts.rows.some((attempt) => attempt.claim_token === lease.leaseToken)
    )
      return null;
    if (
      command.type === "mail" &&
      attempts.rows.some((attempt) =>
        ["started", "uncertain", "committed"].includes(attempt.state),
      )
    ) {
      await this.client.query(
        `UPDATE tholi.external_attempts SET state='uncertain',finished_at=clock_timestamp()
        WHERE workspace_id=$1 AND effect_id=$2 AND state='started'`,
        [this.scope.workspaceId, effect.id],
      );
      const changed = await this.client.query<{ changed: boolean }>(
        "SELECT tholi.fail_job($1,$2,$3,'uncertain','UNAVAILABLE',0) AS changed",
        [this.scope.workspaceId, lease.id, lease.leaseToken],
      );
      if (changed.rows[0].changed && lease.kind === "support.operator")
        await this.client.query(
          `UPDATE tholi.requests SET status='uncertain',updated_at=clock_timestamp()
            WHERE workspace_id=$1 AND account_id=$2 AND id=$3 AND status IN ('pending','uncertain')`,
          [...this.parameters, row.request_id],
        );
      return null;
    }
    const attemptId = randomUUID();
    await this.client.query(
      `INSERT INTO tholi.external_attempts(workspace_id,id,effect_id,claim_token,state)
      VALUES($1,$2,$3,$4,'started')`,
      [this.scope.workspaceId, attemptId, effect.id, lease.leaseToken],
    );
    await this.client.query(
      "SELECT tholi.require_live_external_lease($1,$2,$3)",
      [this.scope.workspaceId, lease.id, lease.leaseToken],
    );
    return { attemptId, effectId: effect.id, commandHash, command };
  }
}
