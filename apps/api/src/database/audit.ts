import type { PoolClient } from "pg";
import { z } from "zod";
import type { Observability } from "../application/observability";

const revision = z.string().regex(/^[1-9]\d{0,18}$/);
const base = {
  accountId: z.string().uuid(),
  workspaceId: z.string().uuid().optional(),
};
const sessionKinds = [
  "session.created",
  "session.rotated",
  "session.revoked",
  "session.refresh_replay",
] as const;
const securityAuditSchema = z.union([
  z
    .object({
      ...base,
      kind: z.enum(sessionKinds),
      subjectId: z.string().uuid(),
      details: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.enum(["sessions.revoked_all", "sessions.provider_revoked"]),
      details: z.object({}).strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("membership.changed"),
      subjectId: z.string().uuid(),
      details: z
        .object({
          role: z.enum(["admin", "member"]),
          status: z.enum(["active", "revoked"]),
          revision,
        })
        .strict(),
    })
    .strict(),
  z
    .object({
      ...base,
      kind: z.literal("consent.changed"),
      subjectId: z.string().uuid(),
      details: z
        .object({
          purpose: z.string().regex(/^[a-z][a-z0-9_-]{0,99}$/),
          policyVersion: z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/),
          granted: z.boolean(),
          revision,
        })
        .strict(),
    })
    .strict(),
]);
export type SecurityAuditInput = z.infer<typeof securityAuditSchema>;

/** Called only after the existing owner changed a record, on its same client. */
export async function appendSecurityAudit(
  client: Pick<PoolClient, "query">,
  input: SecurityAuditInput,
  observer?: Observability,
) {
  const event = securityAuditSchema.parse(input);
  await client.query(
    `INSERT INTO tholi.security_audit(account_id,workspace_id,subject_id,kind,details,request_id)
    VALUES($1,$2,$3,$4,$5::jsonb,$6)`,
    [
      event.accountId,
      event.workspaceId ?? null,
      "subjectId" in event ? event.subjectId : null,
      event.kind,
      JSON.stringify(event.details),
      observer?.current()?.requestId ?? null,
    ],
  );
}

export const auditReadSchema = z
  .object({
    accountId: z.string().uuid().optional(),
    workspaceId: z.string().uuid().optional(),
    after: z.string().uuid().optional(),
    limit: z.number().int().min(1).max(100).default(50),
  })
  .strict()
  .refine(
    (value) => !!(value.accountId || value.workspaceId),
    "Select an account or workspace.",
  );
export type AuditRead = z.input<typeof auditReadSchema>;

/** Operator-owned connection only. Runtime roles deliberately have no SELECT. */
export async function readSecurityAudit(
  client: Pick<PoolClient, "query">,
  input: AuditRead,
) {
  const filter = auditReadSchema.parse(input);
  return (
    await client.query(
      `SELECT id,account_id AS "accountId",workspace_id AS "workspaceId",subject_id AS "subjectId",
      kind,details,request_id AS "requestId",occurred_at AS "occurredAt",expires_at AS "expiresAt"
    FROM tholi.security_audit WHERE ($1::uuid IS NULL OR account_id=$1) AND ($2::uuid IS NULL OR workspace_id=$2)
      AND expires_at>clock_timestamp() AND ($3::uuid IS NULL OR (occurred_at,id)>(
        SELECT occurred_at,id FROM tholi.security_audit WHERE id=$3))
    ORDER BY occurred_at,id LIMIT $4`,
      [
        filter.accountId ?? null,
        filter.workspaceId ?? null,
        filter.after ?? null,
        filter.limit,
      ],
    )
  ).rows;
}
