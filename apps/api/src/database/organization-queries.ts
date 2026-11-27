import { randomUUID } from "node:crypto";
import { appendSecurityAudit } from "./audit";
import type { PoolClient } from "pg";
import {
  organizationDigest,
  type OrganizationStore,
} from "../application/organization";
import { RepositoryError, type RepositoryScope } from "./contracts";
import {
  DEFAULT_ORGANIZATION_POLICY,
  ORGANIZATION_LIMITS,
  organizationWorkflowSchema,
  knowledgeSourceSchema,
  type OrganizationWorkflow,
  type OrganizationWorkflowDraft,
  type OrganizationWorkflowAction,
  type DocumentaryBundle,
} from "../../../../packages/navigation-core/contracts-organization";

function conflict(): never {
  throw new RepositoryError(
    "CONFLICT",
    "The organization resource changed or is unavailable.",
  );
}
function denied(): never {
  throw new RepositoryError(
    "FORBIDDEN",
    "The organization resource is unavailable.",
  );
}

/** Created only inside the existing scoped transaction, after its workspace lock. */
export class ScopedOrganization implements OrganizationStore {
  constructor(
    private client: Pick<PoolClient, "query">,
    private scope: RepositoryScope,
  ) {}
  async policy() {
    const result = await this.client.query(
      "SELECT revision::text,policy FROM tholi.organization_policies WHERE workspace_id=$1",
      [this.scope.workspaceId],
    );
    return (
      result.rows[0] || {
        revision: "0",
        policy: {
          ...DEFAULT_ORGANIZATION_POLICY,
          allowedOrigins: [],
          providers: [],
        },
      }
    );
  }
  async setPolicy(input: Parameters<OrganizationStore["setPolicy"]>[0]) {
    const before = await this.policy();
    if (before.revision !== input.expectedRevision) conflict();
    const history = await this.client.query(
      "SELECT count(*)::int AS count FROM tholi.organization_policy_versions WHERE workspace_id=$1",
      [this.scope.workspaceId],
    );
    if (history.rows[0].count >= ORGANIZATION_LIMITS.historyRows)
      throw new RepositoryError(
        "RATE_LIMITED",
        "The organization policy history limit was reached.",
      );
    const result = await this.client.query(
      `INSERT INTO tholi.organization_policies(workspace_id,revision,policy) VALUES ($1,1,$2)
      ON CONFLICT(workspace_id) DO UPDATE SET revision=organization_policies.revision+1,policy=EXCLUDED.policy,updated_at=clock_timestamp()
      RETURNING revision::text,policy`,
      [this.scope.workspaceId, input.policy],
    );
    await this.client.query(
      "INSERT INTO tholi.organization_policy_versions(workspace_id,revision,actor_id,policy) VALUES($1,$2,$3,$4)",
      [
        this.scope.workspaceId,
        result.rows[0].revision,
        this.scope.accountId,
        input.policy,
      ],
    );
    await this.audit("organization.policy.changed", this.scope.workspaceId);
    return result.rows[0];
  }
  private audit(
    kind:
      | "organization.policy.changed"
      | "organization.workflow.changed"
      | "organization.source.changed",
    subjectId: string,
  ) {
    return appendSecurityAudit(this.client, {
      kind,
      subjectId,
      ...this.scope,
      details: {},
    });
  }
  async workflows(publishedOnly: boolean): Promise<OrganizationWorkflow[]> {
    const result = await this.client.query(
      `SELECT ${publishedOnly ? "published" : "record"} AS record FROM tholi.organization_workflows
      WHERE workspace_id=$1 ${publishedOnly ? "AND published IS NOT NULL" : ""} ORDER BY id LIMIT $2`,
      [this.scope.workspaceId, ORGANIZATION_LIMITS.workflows],
    );
    const policy = await this.policy();
    return result.rows
      .map((r) => organizationWorkflowSchema.parse(r.record))
      .filter(
        (r) =>
          !publishedOnly || policy.policy.allowedOrigins.includes(r.origin),
      );
  }
  private async current(id: string) {
    return (
      await this.client.query(
        "SELECT record,published FROM tholi.organization_workflows WHERE workspace_id=$1 AND id=$2 FOR UPDATE",
        [this.scope.workspaceId, id],
      )
    ).rows[0] as
      | { record: OrganizationWorkflow; published: OrganizationWorkflow | null }
      | undefined;
  }
  private async privileged() {
    const result = await this.client.query(
      "SELECT tholi.current_member_role($1) AS role",
      [this.scope.workspaceId],
    );
    return ["owner", "admin"].includes(result.rows[0]?.role);
  }
  private async store(
    record: OrganizationWorkflow,
    published: OrganizationWorkflow | null,
    action: "draft" | OrganizationWorkflowAction["action"],
    creating = false,
  ) {
    const history = await this.client.query(
      "SELECT count(*)::int AS count FROM tholi.organization_workflow_versions WHERE workspace_id=$1",
      [this.scope.workspaceId],
    );
    if (history.rows[0].count >= ORGANIZATION_LIMITS.historyRows)
      throw new RepositoryError(
        "RATE_LIMITED",
        "The organization workflow history limit was reached.",
      );
    if (creating) {
      await this.client.query(
        "INSERT INTO tholi.organization_workflows(workspace_id,id,revision,record,published) VALUES ($1,$2,$3,$4,NULL)",
        [this.scope.workspaceId, record.id, record.revision, record],
      );
    } else {
      await this.client.query(
        "UPDATE tholi.organization_workflows SET revision=$3,record=$4,published=$5,updated_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2",
        [this.scope.workspaceId, record.id, record.revision, record, published],
      );
    }
    await this.client.query(
      "INSERT INTO tholi.organization_workflow_versions(workspace_id,id,revision,actor_id,action,record) VALUES($1,$2,$3,$4,$5,$6)",
      [
        this.scope.workspaceId,
        record.id,
        record.revision,
        this.scope.accountId,
        action,
        record,
      ],
    );
    await this.audit("organization.workflow.changed", record.id);
    return record;
  }
  async saveWorkflow(id: string, input: OrganizationWorkflowDraft) {
    const before = await this.current(id);
    if ((before?.record.revision || "0") !== input.expectedRevision) conflict();
    if (
      before &&
      before.record.authorId !== this.scope.accountId &&
      !(await this.privileged())
    )
      denied();
    if (!before) {
      const count = await this.client.query(
        "SELECT count(*)::int AS count FROM tholi.organization_workflows WHERE workspace_id=$1",
        [this.scope.workspaceId],
      );
      if (count.rows[0].count >= ORGANIZATION_LIMITS.workflows)
        throw new RepositoryError(
          "RATE_LIMITED",
          "The organization workflow limit was reached.",
        );
    }
    const record = organizationWorkflowSchema.parse({
      schemaVersion: 1,
      id,
      revision: (BigInt(input.expectedRevision) + 1n).toString(),
      authorId: this.scope.accountId,
      reviewerId: null,
      status: "draft",
      origin: input.origin,
      guide: input.guide,
      contentHash: organizationDigest([input.origin, input.guide]),
      createdAt: before?.record.createdAt || new Date().toISOString(),
    });
    return this.store(record, before?.published || null, "draft", !before);
  }
  async actWorkflow(id: string, input: OrganizationWorkflowAction) {
    const current = await this.current(id);
    if (
      !current ||
      current.record.revision !== input.expectedRevision ||
      current.record.contentHash !== input.contentHash
    )
      conflict();
    const before = current.record;
    let published = current.published;
    const record: OrganizationWorkflow = {
      ...before,
      revision: (BigInt(before.revision) + 1n).toString(),
    };
    if (input.action === "submit") {
      if (before.authorId !== this.scope.accountId || before.status !== "draft")
        denied();
      record.status = "review";
    } else {
      if (!(await this.privileged())) denied();
      switch (input.action) {
        case "approve":
          if (
            before.status !== "review" ||
            before.authorId === this.scope.accountId
          )
            denied();
          record.status = "approved";
          record.reviewerId = this.scope.accountId;
          break;
        case "publish": {
          if (
            before.status !== "approved" ||
            !before.reviewerId ||
            before.reviewerId === before.authorId
          )
            denied();
          if (
            !(await this.policy()).policy.allowedOrigins.includes(before.origin)
          )
            denied();
          record.status = "published";
          published = record;
          break;
        }
        case "retire":
          record.status = "retired";
          published = null;
          break;
        case "restore":
          // Rollback restores the last published content into a new draft. The
          // current policy and independent review still apply before republishing.
          if (!published) conflict();
          Object.assign(record, {
            guide: published.guide,
            origin: published.origin,
            contentHash: published.contentHash,
            authorId: this.scope.accountId,
            reviewerId: null,
            status: "draft",
          });
          break;
      }
    }
    return this.store(record, published, input.action);
  }
  async sources() {
    const result = await this.client.query(
      "SELECT metadata FROM tholi.organization_knowledge_sources WHERE workspace_id=$1 AND deleted_at IS NULL AND expires_at>clock_timestamp() ORDER BY id LIMIT $2",
      [this.scope.workspaceId, ORGANIZATION_LIMITS.sources],
    );
    return result.rows.map((r) => knowledgeSourceSchema.parse(r.metadata));
  }
  async saveSource(
    input: Parameters<OrganizationStore["saveSource"]>[0],
    chunks: string[],
  ) {
    const digest = organizationDigest(chunks);
    const previous = await this.client.query(
      "SELECT metadata FROM tholi.organization_knowledge_sources WHERE workspace_id=$1 AND metadata->>'origin'=$2 AND metadata->>'title'=$3 AND metadata->>'sha256'=$4 AND metadata->>'sourceUrl' IS NOT DISTINCT FROM $5 AND deleted_at IS NULL AND expires_at>clock_timestamp() LIMIT 1",
      [this.scope.workspaceId, input.origin, input.title, digest, input.sourceUrl ?? null],
    );
    if (previous.rows[0])
      return knowledgeSourceSchema.parse(previous.rows[0].metadata);
    const count = await this.client.query(
      "SELECT count(*)::int AS count,COALESCE(sum(pg_column_size(chunks)),0)::int AS bytes FROM tholi.organization_knowledge_sources WHERE workspace_id=$1 AND deleted_at IS NULL",
      [this.scope.workspaceId],
    );
    if (
      count.rows[0].count >= ORGANIZATION_LIMITS.sources ||
      count.rows[0].bytes + Buffer.byteLength(JSON.stringify(chunks)) >
        10 * 1024 * 1024
    )
      throw new RepositoryError(
        "RATE_LIMITED",
        "The organization source limit was reached.",
      );
    const metadata = knowledgeSourceSchema.parse({
      id: randomUUID(),
      revision: "1",
      title: input.title,
      origin: input.origin,
      ...(input.sourceUrl ? { sourceUrl: input.sourceUrl } : {}),
      sha256: digest,
      observedAt: new Date().toISOString(),
      chunks: chunks.length,
    });
    await this.client.query(
      "INSERT INTO tholi.organization_knowledge_sources(workspace_id,id,revision,metadata,chunks) VALUES ($1,$2,1,$3,$4)",
      [this.scope.workspaceId, metadata.id, metadata, JSON.stringify(chunks)],
    );
    await this.audit("organization.source.changed", metadata.id);
    return metadata;
  }
  async source(id: string) {
    const result = await this.client.query(
      "SELECT metadata,chunks FROM tholi.organization_knowledge_sources WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL AND expires_at>clock_timestamp()",
      [this.scope.workspaceId, id],
    );
    if (!result.rows[0]) conflict();
    return {
      schemaVersion: 1 as const,
      evidence: "documentation" as const,
      source: knowledgeSourceSchema.parse(result.rows[0].metadata),
      sections: result.rows[0].chunks as string[],
    };
  }
  async deleteSource(id: string, revision: string) {
    const result = await this.client.query(
      "UPDATE tholi.organization_knowledge_sources SET revision=revision+1,metadata=jsonb_set(metadata,'{revision}',to_jsonb((revision+1)::text)),chunks='[]'::jsonb,deleted_at=clock_timestamp() WHERE workspace_id=$1 AND id=$2 AND revision=$3 AND deleted_at IS NULL",
      [this.scope.workspaceId, id, revision],
    );
    if (!result.rowCount) conflict();
    await this.audit("organization.source.changed", id);
  }
  async chunks(origin: string): Promise<DocumentaryBundle[]> {
    const result = await this.client.query(
      `SELECT s.metadata,c.text,c.ordinality FROM tholi.organization_knowledge_sources s CROSS JOIN LATERAL jsonb_array_elements_text(s.chunks) WITH ORDINALITY c(text,ordinality)
      WHERE s.workspace_id=$1 AND s.metadata->>'origin'=$2 AND s.deleted_at IS NULL AND s.expires_at>clock_timestamp()
      ORDER BY s.id,c.ordinality LIMIT 500`,
      [this.scope.workspaceId, origin],
    );
    return result.rows.map(({ metadata, text, ordinality }) => ({
      sourceId: metadata.id,
      sourceRevision: metadata.revision,
      sourceHash: metadata.sha256,
      title: metadata.title,
      ...(typeof metadata.sourceUrl === "string"
        ? { sourceUrl: metadata.sourceUrl }
        : {}),
      locator: `Section ${ordinality}`,
      text,
      evidence: "documentation",
    }));
  }
}
