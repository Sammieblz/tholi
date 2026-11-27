import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { OrganizationService } from "../../../apps/api/src/application/organization";
import { workflowGuides } from "../../../packages/navigation-core/guides";
import { DEFAULT_ORGANIZATION_POLICY } from "../../../packages/navigation-core/contracts-organization";
import type { ServiceRequestContext } from "../../../apps/api/src/capabilities";

export async function runOrganizationChecks(
  runtime: Pool,
  migration: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
) {
  const repositories = new PostgresRepositories(runtime),
    service = new OrganizationService(repositories, "development");
  const owner = await repositories.provisionAccount(),
    author = await repositories.provisionAccount(),
    outsider = await repositories.provisionAccount();
  const workspaceId = randomUUID(),
    id = randomUUID();
  await migration.query(
    "INSERT INTO tholi.workspaces(id,kind,owner_account_id) VALUES($1,'organization',$2)",
    [workspaceId, owner.accountId],
  );
  await migration.query(
    "INSERT INTO tholi.memberships(workspace_id,account_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
    [workspaceId, owner.accountId, author.accountId],
  );
  const context = {
    signal: new AbortController().signal,
    deadlineAt: Date.now() + 60000,
  } as ServiceRequestContext;
  let workflow: Awaited<ReturnType<typeof service.saveWorkflow>>;
  await record(
    "organization drafts require independent approval and keep published revisions stable",
    async () => {
      assert.equal(
        (await service.policy(owner, workspaceId, context)).revision,
        "0",
      );
      await service.setPolicy(
        owner,
        workspaceId,
        {
          expectedRevision: "0",
          policy: {
            ...DEFAULT_ORGANIZATION_POLICY,
            allowedOrigins: ["https://github.com"],
          },
        },
        context,
      );
      await assert.rejects(() =>
        service.policy(outsider, workspaceId, context),
      );
      await assert.rejects(() =>
        service.setPolicy(
          author,
          workspaceId,
          { expectedRevision: "1", policy: DEFAULT_ORGANIZATION_POLICY },
          context,
        ),
      );
      workflow = await service.saveWorkflow(
        author,
        workspaceId,
        id,
        {
          expectedRevision: "0",
          origin: "https://github.com",
          guide: workflowGuides.find(
            (g) => g.id === "github.repository.create",
          ),
        },
        context,
      );
      const action = async (
        actor: typeof owner,
        kind: "submit" | "approve" | "publish" | "retire",
      ) =>
        (workflow = await service.actWorkflow(
          actor,
          workspaceId,
          id,
          {
            expectedRevision: workflow.revision,
            contentHash: workflow.contentHash,
            action: kind,
          },
          context,
        ));
      await action(author, "submit");
      await assert.rejects(() => action(author, "approve"));
      await action(owner, "approve");
      await action(owner, "publish");
      const published = (
        await service.workflows(author, workspaceId, true, context)
      ).items[0];
      assert.equal(published.revision, workflow.revision);
      const selection = { id, revision: published.revision, index: 0 };
      const lookup = { origin: published.origin, selection };
      assert.deepEqual(
        await service.publishedGuide(author, workspaceId, lookup, context),
        {
          count: published.guide.milestones.length,
          milestone: published.guide.milestones[0],
        },
      );
      await assert.rejects(() =>
        service.publishedGuide(outsider, workspaceId, lookup, context),
      );
      await assert.rejects(() =>
        service.publishedGuide(
          author,
          workspaceId,
          { ...lookup, origin: "https://other.example" },
          context,
        ),
      );
      const outcomes = await Promise.allSettled(
        [0, 1].map(() =>
          service.saveWorkflow(
            author,
            workspaceId,
            id,
            {
              expectedRevision: workflow.revision,
              origin: workflow.origin,
              guide: workflow.guide,
            },
            context,
          ),
        ),
      );
      assert.equal(outcomes.filter((r) => r.status === "fulfilled").length, 1);
      workflow = (await service.workflows(author, workspaceId, false, context))
        .items[0];
      assert.equal(
        (await service.workflows(author, workspaceId, true, context)).items[0]
          .revision,
        published.revision,
      );
      const audit = await migration.query(
        "SELECT count(*)::int AS count FROM tholi.organization_workflow_versions WHERE workspace_id=$1 AND id=$2",
        [workspaceId, id],
      );
      assert.equal(audit.rows[0].count, 5);
      const history = await service.history(owner, workspaceId, id, context);
      assert.deepEqual(
        history.revisions.map((entry) => entry.revision),
        [published.revision],
      );
      await action(owner, "retire");
      await assert.rejects(() =>
        service.publishedGuide(author, workspaceId, lookup, context),
      );
      workflow = await service.actWorkflow(
        owner,
        workspaceId,
        id,
        {
          action: "restore",
          expectedRevision: workflow.revision,
          contentHash: workflow.contentHash,
          publishedRevision: published.revision,
        },
        context,
      );
      assert.equal(workflow.status, "draft");
      assert.equal(workflow.contentHash, published.contentHash);
      assert.equal(workflow.reviewerId, null);
      await assert.rejects(() =>
        service.publishedGuide(author, workspaceId, lookup, context),
      );
      await assert.rejects(() =>
        runtime.query(
          "UPDATE tholi.organization_workflow_versions SET action='publish'",
        ),
      );
    },
  );
  await record(
    "organization retrieval is scoped, cited, bounded and invalidated by deletion or revocation",
    async () => {
      const source = await service.saveSource(
        owner,
        workspaceId,
        {
          schemaVersion: 1,
          title: "Repository help",
          origin: "https://github.com",
          format: "markdown",
          text: "# Repository creation\n\nChoose New repository and review visibility.",
        },
        context,
      );
      const query = {
        origin: "https://github.com",
        query: "repository visibility",
      };
      const before = await service.retrieve(
        author,
        workspaceId,
        query,
        context,
      );
      assert.equal(before.bundles.length, 1);
      assert.equal(before.bundles[0].evidence, "documentation");
      assert.ok(Buffer.byteLength(JSON.stringify(before)) <= 6144);
      await assert.rejects(() =>
        service.retrieve(outsider, workspaceId, query, context),
      );
      await service.deleteSource(
        owner,
        workspaceId,
        source.id,
        source.revision,
        context,
      );
      const after = await service.retrieve(author, workspaceId, query, context);
      assert.equal(after.bundles.length, 0);
      assert.notEqual(before.snapshot, after.snapshot);
      await migration.query(
        "UPDATE tholi.memberships SET status='revoked',revision=revision+1 WHERE workspace_id=$1 AND account_id=$2",
        [workspaceId, author.accountId],
      );
      await assert.rejects(() =>
        service.workflows(author, workspaceId, true, context),
      );
      assert.equal(
        (
          await runtime.query(
            "SELECT count(*)::int AS count FROM tholi.organization_workflows",
          )
        ).rows[0].count,
        0,
      );
    },
  );
}
