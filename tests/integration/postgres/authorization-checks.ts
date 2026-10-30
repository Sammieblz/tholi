import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { PostgresIdentityRepository } from "../../../apps/api/src/database/identity";
import { withTransaction } from "../../../apps/api/src/database/postgres";
import type { RepositoryScope } from "../../../apps/api/src/database/contracts";
import {
  beginJourney,
  saveTask,
} from "../../../packages/goal-planner/task-journey";

/** Real runtime-role checks, sharing the existing disposable database harness. */
export async function runAuthorizationChecks(
  runtime: Pool,
  migration: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
) {
  const repositories = new PostgresRepositories(runtime);
  const owner = await repositories.provisionAccount();
  const admin = await repositories.provisionAccount();
  const member = await repositories.provisionAccount();
  const stranger = await repositories.provisionAccount();
  const organization = async (accountId: string): Promise<RepositoryScope> => {
    const workspaceId = randomUUID();
    await migration.query(
      "INSERT INTO tholi.workspaces (id,kind,owner_account_id) VALUES ($1,'organization',$2)",
      [workspaceId, accountId],
    );
    await migration.query(
      "INSERT INTO tholi.memberships (workspace_id,account_id,role) VALUES ($1,$2,'owner')",
      [workspaceId, accountId],
    );
    return { accountId, workspaceId };
  };
  const first = await organization(owner.accountId);
  const second = await organization(stranger.accountId);
  const asAdmin = { ...first, accountId: admin.accountId };
  const asMember = { ...first, accountId: member.accountId };
  for (const [accountId, role] of [
    [admin.accountId, "admin"],
    [member.accountId, "member"],
  ] as const)
    await repositories.transaction(first, (scoped) =>
      scoped.setMembership({
        accountId,
        role,
        status: "active",
        expectedRevision: 0n,
      }),
    );

  await record(
    "tenant RLS fails closed without scope and protects ownership columns",
    async () => {
      const tables = [
        "accounts",
        "workspaces",
        "memberships",
        "consents",
        "requests",
        "saved_artifacts",
        "entitlements",
        "credit_grants",
        "credit_reservations",
        "credit_settlements",
        "usage_records",
        "jobs",
        "outbox",
      ];
      for (const table of tables) {
        assert.equal(
          (
            await runtime.query(
              `SELECT count(*)::integer AS count FROM tholi.${table}`,
            )
          ).rows[0].count,
          0,
          table,
        );
        const policy = (
          await migration.query(
            "SELECT relrowsecurity,relforcerowsecurity FROM pg_class WHERE oid = $1::regclass",
            [`tholi.${table}`],
          )
        ).rows[0];
        assert.equal(policy.relrowsecurity, true, table);
        assert.equal(
          policy.relforcerowsecurity,
          false,
          "Trusted owner helpers and backup retain their documented boundary.",
        );
      }
      assert.equal(
        (
          await runtime.query(
            "UPDATE tholi.memberships SET role = 'admin' RETURNING account_id",
          )
        ).rowCount,
        0,
      );
      await assert.rejects(
        () =>
          runtime.query(
            "INSERT INTO tholi.requests (workspace_id,id,account_id,operation,idempotency_key,payload_hash) VALUES ($1,$2,$3,'probe','unscoped',decode($4,'hex'))",
            [first.workspaceId, randomUUID(), owner.accountId, "a".repeat(64)],
          ),
        { code: "42501" },
      );
      await assert.rejects(
        () =>
          withTransaction(
            runtime,
            (client) =>
              client.query(
                "UPDATE tholi.accounts SET status = 'suspended' WHERE id = $1",
                [owner.accountId],
              ),
            first,
          ),
        { code: "42501" },
      );
      await assert.rejects(
        () =>
          withTransaction(
            runtime,
            (client) =>
              client.query(
                "UPDATE tholi.workspaces SET owner_account_id = $2 WHERE id = $1",
                [first.workspaceId, member.accountId],
              ),
            first,
          ),
        { code: "42501" },
      );
      const publicExecute = (
        await migration.query(`SELECT count(*)::integer AS count FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace,
      LATERAL aclexplode(p.proacl) a WHERE n.nspname='tholi' AND a.grantee=0 AND a.privilege_type='EXECUTE'`)
      ).rows[0].count;
      assert.equal(publicExecute, 0);
      await assert.rejects(
        () =>
          runtime.query("SELECT tholi.workspace_credit_totals($1)", [
            first.workspaceId,
          ]),
        { code: "42501" },
      );
    },
  );

  await record(
    "workspace discovery and membership metadata honor current roles and bounded paging",
    async () => {
      const owned = await repositories.listWorkspaces(owner.accountId);
      assert.deepEqual(
        new Set(owned.map((workspace) => workspace.id)),
        new Set([owner.workspaceId, first.workspaceId]),
      );
      const page = await repositories.listWorkspaces(owner.accountId, {
        limit: 1,
      });
      const rest = await repositories.listWorkspaces(owner.accountId, {
        limit: 1,
        after: page[0].id,
      });
      assert.equal(page.length, 1);
      assert.equal(rest.length, 1);
      assert.notEqual(page[0].id, rest[0].id);
      assert.ok(
        !(await repositories.listWorkspaces(member.accountId)).some(
          (workspace) => workspace.id === second.workspaceId,
        ),
      );
      await assert.rejects(
        () => repositories.listWorkspaces(owner.accountId, { limit: 101 }),
        { code: "INVALID_INPUT" },
      );
      const roster = await repositories.transaction(first, (scoped) =>
        scoped.listMemberships(),
      );
      assert.equal(roster.length, 3);
      assert.deepEqual(
        await repositories.transaction(asAdmin, (scoped) =>
          scoped.listMemberships(),
        ),
        roster,
      );
      assert.deepEqual(
        (
          await repositories.transaction(asMember, (scoped) =>
            scoped.listMemberships(),
          )
        ).map((row) => row.accountId),
        [member.accountId],
      );
      const membershipPage = await repositories.transaction(first, (scoped) =>
        scoped.listMemberships({ limit: 1 }),
      );
      const membershipRest = await repositories.transaction(first, (scoped) =>
        scoped.listMemberships({ after: membershipPage[0].accountId }),
      );
      assert.equal(membershipRest.length, 2);
      await assert.rejects(
        () =>
          repositories.transaction(
            { ...second, accountId: member.accountId },
            async () => {},
          ),
        { code: "FORBIDDEN" },
      );
    },
  );

  await record(
    "organization membership changes preserve the sole canonical owner and reject replay",
    async () => {
      const current = (await repositories.transaction(first, (scoped) =>
        scoped.getMembership(member.accountId),
      ))!;
      for (const unauthorized of [asAdmin, asMember])
        await assert.rejects(
          () =>
            repositories.transaction(unauthorized, (scoped) =>
              scoped.setMembership({
                accountId: member.accountId,
                role: "admin",
                status: "active",
                expectedRevision: current.revision,
              }),
            ),
          { code: "FORBIDDEN" },
        );
      const updated = await repositories.transaction(first, (scoped) =>
        scoped.setMembership({
          accountId: member.accountId,
          role: "member",
          status: "active",
          expectedRevision: current.revision,
        }),
      );
      await assert.rejects(
        () =>
          repositories.transaction(first, (scoped) =>
            scoped.setMembership({
              accountId: member.accountId,
              role: "admin",
              status: "active",
              expectedRevision: current.revision,
            }),
          ),
        { code: "CONFLICT" },
      );
      assert.equal(updated.revision, current.revision + 1n);
      for (const command of [
        {
          accountId: owner.accountId,
          role: "owner" as const,
          status: "revoked" as const,
          expectedRevision: 1n,
        },
        {
          accountId: owner.accountId,
          role: "member" as const,
          status: "active" as const,
          expectedRevision: 1n,
        },
        {
          accountId: member.accountId,
          role: "owner" as const,
          status: "active" as const,
          expectedRevision: updated.revision,
        },
      ])
        await assert.rejects(
          () =>
            repositories.transaction(first, (scoped) =>
              scoped.setMembership(command),
            ),
          { code: "INVALID_INPUT" },
        );
      await assert.rejects(
        () =>
          repositories.transaction(owner, (scoped) =>
            scoped.setMembership({
              accountId: member.accountId,
              role: "member",
              status: "active",
              expectedRevision: 0n,
            }),
          ),
        { code: "INVALID_INPUT" },
      );
      await assert.rejects(
        () =>
          migration.query(
            "INSERT INTO tholi.memberships (workspace_id,account_id,role) VALUES ($1,$2,'owner')",
            [first.workspaceId, stranger.accountId],
          ),
        { code: "23514" },
      );
      await assert.rejects(
        () =>
          migration.query(
            "INSERT INTO tholi.memberships (workspace_id,account_id,role) VALUES ($1,$2,'member')",
            [owner.workspaceId, stranger.accountId],
          ),
        { code: "23514" },
      );
    },
  );

  await record(
    "same-organization private artifacts requests usage and jobs do not leak across members",
    async () => {
      const route = saveTask(
        beginJourney("Open Languages", "https://example.test"),
      );
      const privateRecords = await repositories.transaction(
        asMember,
        async (scoped) => {
          const artifact = await scoped.saveArtifact({
            content: route,
            expectedRevision: 0n,
            userApproved: true,
          });
          const request = (
            await scoped.beginRequest({
              operation: "navigation",
              idempotencyKey: "member-private",
              payloadHash: "a".repeat(64),
            })
          ).request;
          await scoped.recordUsage({
            requestId: request.id,
            provider: "fake",
            model: "deterministic",
            inputUnits: 1n,
            outputUnits: 2n,
          });
          const job = await scoped.enqueueJob({
            kind: "fixture",
            version: 1,
            idempotencyKey: "member-job",
            requestId: request.id,
            recordReferences: { artifactId: artifact.id },
          });
          await scoped.appendOutbox({
            jobId: job.id,
            eventKind: "fixture",
            idempotencyKey: "member-event",
          });
          return { artifact, request, job };
        },
      );
      for (const scope of [first, asAdmin, second])
        await repositories.transaction(scope, async (scoped) => {
          assert.equal(
            await scoped.getArtifact(privateRecords.artifact.id),
            undefined,
          );
          assert.equal(
            await scoped.getRequest(privateRecords.request.id),
            undefined,
          );
          assert.equal(await scoped.getJob(privateRecords.job.id), undefined);
        });
      for (const table of [
        "saved_artifacts",
        "requests",
        "usage_records",
        "jobs",
        "outbox",
      ]) {
        const count = await withTransaction(
          runtime,
          async (client) =>
            (
              await client.query(
                `SELECT count(*)::integer AS count FROM tholi.${table} WHERE workspace_id=$1`,
                [first.workspaceId],
              )
            ).rows[0].count,
          first,
        );
        assert.equal(count, 0, table);
      }
      await assert.rejects(
        () =>
          withTransaction(
            runtime,
            (client) =>
              client.query(
                "UPDATE tholi.saved_artifacts SET owner_account_id=$2 WHERE workspace_id=$1",
                [first.workspaceId, owner.accountId],
              ),
            asMember,
          ),
        { code: "42501" },
      );
      await assert.rejects(
        () =>
          withTransaction(
            runtime,
            (client) =>
              client.query(
                "INSERT INTO tholi.requests (workspace_id,id,account_id,operation,idempotency_key,payload_hash) VALUES ($1,$2,$3,'probe','forged',decode($4,'hex'))",
                [
                  second.workspaceId,
                  randomUUID(),
                  member.accountId,
                  "a".repeat(64),
                ],
              ),
            asMember,
          ),
        { code: "42501" },
      );
    },
  );

  await record(
    "workspace credit totals include other members without exposing private reservations",
    async () => {
      await repositories.transaction(first, (scoped) =>
        scoped.grantCredits({ idempotencyKey: "shared-budget", amount: 100n }),
      );
      const request = await repositories.transaction(asMember, (scoped) =>
        scoped.beginRequest({
          operation: "navigation",
          idempotencyKey: "member-hold",
          payloadHash: "b".repeat(64),
        }),
      );
      const held = await repositories.transaction(asMember, (scoped) =>
        scoped.reserveCredits({
          requestId: request.request.id,
          amount: 70n,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      );
      const ownRequest = await repositories.transaction(first, (scoped) =>
        scoped.beginRequest({
          operation: "navigation",
          idempotencyKey: "owner-hold",
          payloadHash: "c".repeat(64),
        }),
      );
      await assert.rejects(
        () =>
          repositories.transaction(first, (scoped) =>
            scoped.reserveCredits({
              requestId: ownRequest.request.id,
              amount: 31n,
              expiresAt: new Date(Date.now() + 60_000),
            }),
          ),
        { code: "INSUFFICIENT_CREDITS" },
      );
      await repositories.transaction(first, (scoped) =>
        scoped.reserveCredits({
          requestId: ownRequest.request.id,
          amount: 30n,
          expiresAt: new Date(Date.now() + 60_000),
        }),
      );
      await repositories.transaction(asMember, (scoped) =>
        scoped.settleCredits({ reservationId: held.id, amount: 25n }),
      );
      for (const scope of [first, asAdmin, asMember])
        assert.deepEqual(
          await repositories.transaction(scope, (scoped) =>
            scoped.creditBalance(),
          ),
          { granted: 100n, spent: 25n, reserved: 30n, available: 45n },
        );
      const raw = await withTransaction(
        runtime,
        async (client) =>
          (
            await client.query(
              "SELECT id FROM tholi.credit_settlements WHERE workspace_id=$1",
              [first.workspaceId],
            )
          ).rows,
        first,
      );
      assert.deepEqual(
        raw,
        [],
        "Workspace totals do not reveal another actor's settlement identifiers.",
      );
    },
  );

  await record(
    "consent revisions and revocation remain purpose version and actor scoped",
    async () => {
      const granted = await repositories.transaction(asMember, (scoped) =>
        scoped.recordConsent({
          purpose: "cloud_saved_routes",
          policyVersion: "1",
          granted: true,
          expectedRevision: 0n,
        }),
      );
      assert.deepEqual(
        await repositories.transaction(first, (scoped) =>
          scoped.listConsents(),
        ),
        [],
      );
      const revoked = await repositories.transaction(asMember, (scoped) =>
        scoped.recordConsent({
          purpose: granted.purpose,
          policyVersion: "untrusted-replacement",
          granted: false,
          expectedRevision: granted.revision,
        }),
      );
      assert.equal(revoked.policyVersion, "1");
      assert.equal(revoked.granted, false);
      await assert.rejects(
        () =>
          repositories.transaction(asMember, (scoped) =>
            scoped.recordConsent({
              purpose: granted.purpose,
              policyVersion: "1",
              granted: true,
              expectedRevision: granted.revision,
            }),
          ),
        { code: "CONFLICT" },
      );
      assert.deepEqual(
        await repositories.transaction(asMember, (scoped) =>
          scoped.listConsents(),
        ),
        [revoked],
      );
      assert.equal(
        (
          await repositories.transaction(asMember, (scoped) =>
            scoped.getAccount(),
          )
        ).id,
        member.accountId,
      );
    },
  );

  await record(
    "membership removal revokes an existing transaction scope without ending unrelated personal sessions",
    async () => {
      const identityStore = new PostgresIdentityRepository(runtime);
      const provider = {
        issuer: "https://identity.example.test",
        subject: randomUUID(),
        issuedAt: new Date(Date.now() - 1000),
      };
      const account = await identityStore.resolveIdentity(provider);
      await repositories.transaction(first, (scoped) =>
        scoped.setMembership({
          accountId: account.accountId,
          role: "member",
          status: "active",
          expectedRevision: 0n,
        }),
      );
      const scope = {
        accountId: account.accountId,
        workspaceId: first.workspaceId,
      };
      const digest = () =>
        createHash("sha256").update(randomUUID()).digest("hex");
      const now = new Date();
      const accessHash = digest();
      await identityStore.createSession({
        ...account,
        id: randomUUID(),
        clientId: "web",
        clientKind: "web",
        providerIssuer: provider.issuer,
        providerSubject: provider.subject,
        providerIssuedAt: provider.issuedAt,
        accessHash,
        refreshHash: digest(),
        csrfHash: digest(),
        accessExpiresAt: new Date(now.getTime() + 60_000),
        expiresAt: new Date(now.getTime() + 120_000),
        createdAt: now,
        lastUsedAt: now,
      });
      await repositories.transaction(scope, async (scoped) => {
        assert.equal((await scoped.getWorkspace()).id, first.workspaceId);
        const membership = (await repositories.transaction(first, (ownerRepo) =>
          ownerRepo.getMembership(account.accountId),
        ))!;
        await repositories.transaction(first, (ownerRepo) =>
          ownerRepo.setMembership({
            accountId: account.accountId,
            role: "member",
            status: "revoked",
            expectedRevision: membership.revision,
          }),
        );
        assert.deepEqual(await scoped.listConsents(), []);
        await assert.rejects(() => scoped.getWorkspace(), {
          code: "FORBIDDEN",
        });
      });
      await assert.rejects(
        () => repositories.transaction(scope, async () => {}),
        { code: "FORBIDDEN" },
      );
      assert.ok(
        await identityStore.authenticateSession(accessHash, new Date()),
      );
      assert.ok(
        !(await repositories.listWorkspaces(account.accountId)).some(
          (workspace) => workspace.id === first.workspaceId,
        ),
      );
    },
  );
}
