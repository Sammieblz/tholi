import assert from "node:assert/strict";
import { createHash, randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { AccountService } from "../../../apps/api/src/application/account";
import { PostgresAccount } from "../../../apps/api/src/database/account";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { PostgresIdentityRepository } from "../../../apps/api/src/database/identity";
import { PostgresSupport } from "../../../apps/api/src/database/support";
import { PostgresJobs } from "../../../apps/api/src/database/jobs";
import { withTransaction } from "../../../apps/api/src/database/postgres";
import { SavedDataService } from "../../../apps/api/src/application/saved-data";
import { SupportService } from "../../../apps/api/src/application/support";
import { createFileLinks } from "../../../apps/api/src/adapters/file-links";
import { createSupportJobHandlers } from "../../../apps/api/src/application/support-jobs";
import type {
  IdentitySession,
  ProviderIdentity,
} from "../../../apps/api/src/application/identity-contracts";
import type { JobLease } from "../../../apps/api/src/application/job-contracts";
import type {
  ObjectPort,
  MailPort,
} from "../../../apps/api/src/application/support-contracts";
import {
  accountExportManifestSchema,
  accountExportPartSchema,
  type AccountExportInput,
} from "../../../packages/navigation-core/contracts-account";
import {
  beginJourney,
  saveTask,
} from "../../../packages/goal-planner/task-journey";
import { savedDataArtifactFixture } from "../../support/saved-data-fixture";
import { inferenceFixture } from "./inference-fixture";

/** Actual SQL roles and existing ports, without another queue or provider harness. */
export async function runAccountChecks(
  runtime: Pool,
  migration: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
  worker?: Pool,
) {
  const repositories = new PostgresRepositories(runtime),
    identities = new PostgresIdentityRepository(runtime),
    support = new PostgresSupport(runtime),
    saved = new SavedDataService(repositories, support, "development");
  const store = new PostgresAccount(runtime, repositories),
    service = new AccountService(store, {
      exportsAvailable: true,
      deletionAvailable: true,
    });
  const context = () => ({
    requestId: randomUUID(),
    deadlineAt: Date.now() + 25000,
    signal: new AbortController().signal,
  });
  const digest = () => createHash("sha256").update(randomUUID()).digest("hex");
  const scope = (account: { accountId: string; workspaceId: string }) => ({
    accountId: account.accountId,
    workspaceId: account.workspaceId,
  });
  const fixture = async () => {
    const identity: ProviderIdentity = {
      issuer: "https://identity.example.test/realms/account-lifecycle",
      subject: randomUUID(),
      issuedAt: new Date(Date.now() - 1000),
      verifiedEmail: "account-owner@example.test",
    };
    const account = await identities.resolveIdentity(identity),
      now = new Date();
    const session: IdentitySession = {
      ...account,
      id: randomUUID(),
      clientId: "web",
      clientKind: "web",
      providerIssuer: identity.issuer,
      providerSubject: identity.subject,
      providerIssuedAt: identity.issuedAt,
      accessHash: digest(),
      refreshHash: digest(),
      csrfHash: digest(),
      accessExpiresAt: new Date(now.getTime() + 300000),
      expiresAt: new Date(now.getTime() + 3600000),
      createdAt: now,
      lastUsedAt: now,
    };
    await identities.createSession(session);
    await repositories.transaction(scope(account), async (owner) => {
      await owner.enrollFree();
      await owner.recordConsent({
        purpose: "cloud_saved_routes",
        policyVersion: "2",
        granted: true,
        expectedRevision: 0n,
      });
    });
    return { ...account, id: session.id, session, identity };
  };
  const create = (
    account: Awaited<ReturnType<typeof fixture>>,
    kind: Parameters<typeof savedDataArtifactFixture>[0] = "saved_route",
  ) =>
    saved.create(
      account,
      account.workspaceId,
      {
        idempotencyKey: randomUUID(),
        expectedRevision: "0",
        approved: true,
        artifact: savedDataArtifactFixture(kind),
      },
      context(),
    );

  await record(
    "full-account export resumes owned bounded generations and never stores payloads in request receipts",
    async () => {
      const account = await fixture(),
        foreign = await fixture();
      for (const kind of [
        "saved_route",
        "site_knowledge",
        "conversation_excerpt",
        "preferences",
      ] as const)
        await create(account, kind);
      const limitedStore = new PostgresAccount(runtime, repositories, {
        rows: 8,
        bytes: 4194304,
        parts: 64,
        pages: 256,
      });
      const limited = new AccountService(limitedStore, {
        exportsAvailable: true,
        deletionAvailable: true,
      });
      const input = { idempotencyKey: randomUUID() };
      let current = await limited.requestExport(account, input, context());
      assert.equal(current.preparation, "partial");
      assert.ok(current.continuation);
      assert.deepEqual(
        await limited.requestExport(account, input, context()),
        current,
      );
      const first = current;
      for (let pages = 0; current.continuation && pages < 4; pages++) {
        const nextInput: AccountExportInput = {
          idempotencyKey: randomUUID(),
          continuation: current.continuation,
        };
        current = await limited.requestExport(account, nextInput, context());
        assert.equal(current.generation, first.generation);
        assert.deepEqual(
          await limited.requestExport(account, nextInput, context()),
          current,
        );
      }
      assert.equal(current.preparation, "complete");
      assert.equal(current.continuation, null);
      assert.deepEqual(
        await limited.getExport(account, current.generation, context()),
        current,
      );
      const listed = await limited.listExports(
        account,
        { limit: 1 },
        context(),
      );
      assert.equal(listed.items[0].generation, current.generation);
      assert.deepEqual(
        (await limited.listExports(foreign, {}, context())).items,
        [],
      );
      await assert.rejects(
        () => limited.getExport(foreign, current.generation, context()),
        { code: "CONFLICT" },
      );
      await assert.rejects(
        () =>
          limited.requestExport(
            foreign,
            { idempotencyKey: randomUUID(), continuation: first.continuation },
            context(),
          ),
        { code: "CONFLICT" },
      );
      await assert.rejects(
        () =>
          limited.requestExport(
            account,
            { idempotencyKey: randomUUID(), continuation: first.continuation },
            context(),
          ),
        { code: "CONFLICT" },
      );
      const files = (
        await migration.query(
          "SELECT snapshot,bytes,purpose FROM tholi.private_files WHERE account_export_generation=$1",
          [current.generation],
        )
      ).rows;
      const sections = new Set<string>();
      for (const file of files) {
        assert.ok(file.bytes <= 131072);
        if (file.purpose === "account-export-part")
          sections.add(accountExportPartSchema.parse(file.snapshot).section);
        else accountExportManifestSchema.parse(file.snapshot);
        const encoded = JSON.stringify(file.snapshot);
        assert.equal(encoded.includes(account.session.accessHash), false);
        assert.equal(encoded.includes(account.session.refreshHash), false);
        assert.equal(encoded.includes(account.identity.subject), false);
      }
      for (const section of [
        "profile",
        "contacts",
        "sessions",
        "memberships",
        "consents",
        "saved_data",
        "plans",
        "credits",
        "credit_history",
      ])
        assert.ok(sections.has(section));
      const receipts = (
        await migration.query(
          "SELECT account_export_state,account_export_receipt FROM tholi.requests WHERE account_id=$1",
          [account.accountId],
        )
      ).rows;
      assert.equal(
        JSON.stringify(receipts).includes("websiteAppearance"),
        false,
      );
      assert.equal(JSON.stringify(receipts).includes("messages"), false);
      const state = (
        await migration.query(
          "SELECT account_export_state AS state FROM tholi.requests WHERE id=$1",
          [current.generation],
        )
      ).rows[0].state;
      await assert.rejects(
        () =>
          withTransaction(
            runtime,
            (client) =>
              client.query(
                "UPDATE tholi.requests SET account_export_state=$2::jsonb WHERE id=$1",
                [
                  current.generation,
                  JSON.stringify({
                    ...state,
                    omissions: ["PRIVATE_RAW_PAYLOAD"],
                  }),
                ],
              ),
            scope(account),
          ),
        { code: "23514" },
      );
      await assert.rejects(
        () =>
          withTransaction(
            runtime,
            async (client) => {
              const request = (
                await client.query(
                  "SELECT id FROM tholi.requests WHERE id=$1",
                  [current.generation],
                )
              ).rows[0];
              await client.query(
                'UPDATE tholi.requests SET account_export_receipt=account_export_receipt||\'{"raw":"PRIVATE_RAW_PAYLOAD"}\'::jsonb WHERE id=$1',
                [request.id],
              );
            },
            scope(account),
          ),
        { code: "42501" },
      );
      await repositories.transaction(scope(account), (tx) =>
        tx.saveArtifact({
          expectedRevision: 0n,
          userApproved: true,
          content: saveTask(
            beginJourney("Open PRIVATE_LEGACY_ROUTE", "https://example.test"),
          ),
        }),
      );
      const legacy = await service.requestExport(
        account,
        { idempotencyKey: randomUUID() },
        context(),
      );
      assert.equal(legacy.preparation, "partial");
      assert.equal(legacy.continuation, null);
      const manifests = (
        await migration.query(
          "SELECT snapshot FROM tholi.private_files WHERE account_export_generation=$1 AND purpose='account-export-manifest'",
          [legacy.generation],
        )
      ).rows;
      assert.ok(
        accountExportManifestSchema
          .parse(manifests[0].snapshot)
          .omissions.some(
            (item) =>
              item.section === "saved_data" && item.reason === "not-exportable",
          ),
      );
      assert.equal(
        JSON.stringify(
          (
            await migration.query(
              "SELECT snapshot FROM tholi.private_files WHERE account_export_generation=$1",
              [legacy.generation],
            )
          ).rows,
        ).includes("PRIVATE_LEGACY_ROUTE"),
        false,
      );
      const pageOne = await service.listExports(
        account,
        { limit: 1 },
        context(),
      );
      assert.ok(pageOne.nextCursor);
      const pageTwo = await service.listExports(
        account,
        { limit: 1, cursor: pageOne.nextCursor },
        context(),
      );
      assert.notEqual(pageOne.items[0].generation, pageTwo.items[0].generation);
      await assert.rejects(
        () =>
          service.listExports(
            foreign,
            { cursor: pageOne.nextCursor },
            context(),
          ),
        { code: "CONFLICT" },
      );
    },
  );

  if (!worker) return;
  const jobs = new PostgresJobs(worker),
    effects = new PostgresSupport(worker),
    workerAccount = new PostgresAccount(
      worker,
      new PostgresRepositories(worker),
    );
  const claim = async (accountId: string, kinds: string[]) => {
    await migration.query(
      "UPDATE tholi.jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind=ANY($1::text[]) AND status='queued' AND account_id<>$2",
      [kinds, accountId],
    );
    await migration.query(
      "UPDATE tholi.jobs SET available_at=clock_timestamp()-interval '1 second' WHERE kind=ANY($1::text[]) AND status='queued' AND account_id=$2",
      [kinds, accountId],
    );
    return jobs.claim({
      workerId: "account-lifecycle-pg",
      kinds: kinds.map((kind) => ({ kind, version: 1, replaySafe: true })),
      leaseMs: 30000,
      limit: 10,
    });
  };
  const bytes = new Map<string, Uint8Array>();
  const objects: ObjectPort = {
    put: async (file, body) => {
      bytes.set(file.id, Uint8Array.from(body));
    },
    read: async (file) => {
      const value = bytes.get(file.id);
      assert.ok(value);
      return value;
    },
    delete: async (file) => {
      bytes.delete(file.id);
    },
    close: async () => {},
  };
  const mail: MailPort = {
    send: async () => {
      throw new Error("No mail is part of account export.");
    },
    close: async () => {},
  };
  const handlers = createSupportJobHandlers(effects, mail, objects);

  await record(
    "account export uses current source membership at PUT, delivery and signed download boundaries",
    async () => {
      const owner = await fixture(),
        member = await fixture(),
        item = await create(member, "conversation_excerpt"),
        org = randomUUID();
      await migration.query(
        "INSERT INTO tholi.workspaces(id,kind,owner_account_id) VALUES($1,'organization',$2)",
        [org, owner.accountId],
      );
      await migration.query(
        "INSERT INTO tholi.memberships(workspace_id,account_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
        [org, owner.accountId, member.accountId],
      );
      await repositories.transaction(
        { accountId: member.accountId, workspaceId: org },
        (tx) =>
          tx.recordConsent({
            purpose: "cloud_saved_routes",
            policyVersion: "2",
            granted: true,
            expectedRevision: 0n,
          }),
      );
      await withTransaction(
        migration,
        (client) =>
          client.query(
            `WITH stamp AS (UPDATE tholi.workspaces SET sync_revision=sync_revision+1 WHERE id=$1 RETURNING sync_revision)
      UPDATE tholi.saved_artifacts SET workspace_id=$1,sync_revision=(SELECT sync_revision FROM stamp) WHERE workspace_id=$2 AND id=$3`,
            [org, member.workspaceId, item.id],
          ),
        { accountId: member.accountId, workspaceId: org },
      );
      const prepared = await service.requestExport(
        member,
        { idempotencyKey: randomUUID() },
        context(),
      );
      await service.requestExport(
        member,
        { idempotencyKey: randomUUID() },
        context(),
      );
      const pending: { lease: JobLease; attemptId: string; fileId: string }[] =
        [];
      let readable: string | undefined;
      for (let round = 0; round < 4; round++) {
        const leases = await claim(member.accountId, [
          "file.account-export-part",
          "file.account-export-manifest",
        ]);
        if (!leases.length) break;
        for (const lease of leases) {
          const command = await effects.prepareExternal(lease);
          if (!command || command.command.type !== "put") continue;
          const snapshot = JSON.parse(
            new TextDecoder().decode(command.command.body),
          );
          if (
            snapshot.kind === "account-export-part" &&
            snapshot.workspaceId === org &&
            snapshot.section === "saved_data"
          ) {
            pending.push({
              lease,
              attemptId: command.attemptId,
              fileId: command.command.file.id,
            });
            assert.equal(
              await effects.authorizeExternal(lease, command.attemptId),
              true,
            );
            continue;
          }
          assert.equal(
            await effects.authorizeExternal(lease, command.attemptId),
            true,
          );
          await objects.put(
            command.command.file,
            command.command.body,
            new AbortController().signal,
          );
          assert.equal(
            await effects.finishExternal(lease, command.attemptId, {
              status: "committed",
              backoffMs: 0,
            }),
            true,
          );
          if (
            snapshot.kind === "account-export-part" &&
            snapshot.workspaceId === org
          )
            readable = command.command.file.id;
        }
      }
      assert.equal(pending.length, 2);
      const [held, stale] = pending;
      assert.ok(readable);
      const downloads = new SupportService(
        support,
        objects,
        createFileLinks(randomBytes(32).toString("base64url")),
        {
          publicOrigin: "https://api.example.test",
          linkLifetimeMs: 60000,
        },
      );
      const file = await support.getFile(scope(member), readable);
      assert.ok(file);
      const link = new URL(
        (
          await downloads.fileLink(
            member,
            readable,
            { expectedRevision: file.revision.toString() },
            context(),
          )
        ).url,
      );
      assert.equal(
        (
          await downloads.download(
            member,
            readable,
            link.searchParams.get("token")!,
            context(),
          )
        ).filename,
        "tholi-account-part.json",
      );
      await repositories.transaction(
        { accountId: owner.accountId, workspaceId: org },
        (tx) =>
          tx.setMembership({
            accountId: member.accountId,
            role: "member",
            status: "revoked",
            expectedRevision: 1n,
          }),
      );
      assert.equal(
        await effects.authorizeExternal(held.lease, held.attemptId),
        false,
      );
      assert.equal(
        await effects.finishExternal(held.lease, held.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        true,
      );
      assert.equal(
        (
          await migration.query(
            "SELECT status FROM tholi.private_files WHERE id=$1",
            [held.fileId],
          )
        ).rows[0].status,
        "deleting",
      );
      assert.equal(await support.getFile(scope(member), held.fileId), null);
      await migration.query(
        "UPDATE tholi.jobs SET lease_expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
        [stale.lease.id],
      );
      assert.equal(
        await effects.finishExternal(stale.lease, stale.attemptId, {
          status: "committed",
          backoffMs: 0,
        }),
        false,
      );
      assert.equal(
        (
          await migration.query(
            "SELECT status FROM tholi.private_files WHERE id=$1",
            [stale.fileId],
          )
        ).rows[0].status,
        "deleting",
      );
      assert.equal(await support.getFile(scope(member), stale.fileId), null);
      await assert.rejects(
        () =>
          downloads.download(
            member,
            readable!,
            link.searchParams.get("token")!,
            context(),
          ),
        { code: "NOT_FOUND" },
      );
      assert.notEqual(
        (await service.getExport(member, prepared.generation, context()))
          .delivery,
        "ready",
      );
    },
  );

  await record(
    "account deletion revokes proof, runs exact bounded cleanup and preserves financial uncertainty and identity claims",
    async () => {
      const account = await fixture();
      await create(account);
      await repositories.transaction(scope(account), (tx) =>
        tx.recordConsent({
          purpose: "cloud_inference",
          policyVersion: "1",
          granted: true,
          expectedRevision: 0n,
        }),
      );
      const priorControl = (
        await migration.query(
          "SELECT enabled FROM tholi.inference_control WHERE singleton",
        )
      ).rows[0].enabled;
      await migration.query(
        "UPDATE tholi.inference_control SET enabled=true WHERE singleton",
      );
      let held: Awaited<
        ReturnType<ReturnType<typeof inferenceFixture>["reserveDecision"]>
      >;
      try {
        const inference = inferenceFixture(repositories);
        held = await inference.reserveDecision(
          scope(account),
          "fake-development-v1",
        );
        await inference.dispatch(scope(account), held);
        await inference.finish(held, {
          resolution: "unknown",
          outcome: "uncertain",
        });
      } finally {
        await migration.query(
          "UPDATE tholi.inference_control SET enabled=$1 WHERE singleton",
          [priorControl],
        );
      }
      const exported = await service.requestExport(
        account,
        { idempotencyKey: randomUUID() },
        context(),
      );
      const revision = (
        await repositories.transaction(scope(account), (tx) => tx.getAccount())
      ).revision.toString();
      const deleted = await service.deleteAccount(
        account,
        {
          operationId: randomUUID(),
          expectedRevision: revision,
          confirmation: "DELETE",
        },
        context(),
      );
      assert.equal(deleted.status, "deletion_pending");
      assert.equal(
        await identities.authenticateSession(
          account.session.accessHash,
          new Date(),
        ),
        null,
      );
      await assert.rejects(() =>
        identities.resolveIdentity({
          ...account.identity,
          issuedAt: new Date(),
        }),
      );
      await assert.rejects(
        () =>
          repositories.transaction(scope(account), (tx) =>
            tx.listSavedArtifacts({ limit: 1 }),
          ),
        { code: "FORBIDDEN" },
      );
      assert.equal(
        await support
          .getFile(scope(account), exported.fileId)
          .catch(() => null),
        null,
      );
      for (let turn = 0; turn < 20; turn++) {
        const status = (
          await migration.query(
            "SELECT status FROM tholi.accounts WHERE id=$1",
            [account.accountId],
          )
        ).rows[0].status;
        if (status === "deleted") break;
        const leases = await claim(account.accountId, [
          "account.delete",
          "file.expire",
        ]);
        assert.ok(leases.length);
        for (const lease of leases) {
          if (lease.kind === "account.delete")
            await workerAccount.cleanupDeletion(
              lease,
              new AbortController().signal,
            );
          else
            await handlers
              .find((handler) => handler.kind === "file.expire")!
              .execute(lease, new AbortController().signal, 1000);
        }
      }
      assert.equal(
        (
          await migration.query(
            "SELECT status FROM tholi.accounts WHERE id=$1",
            [account.accountId],
          )
        ).rows[0].status,
        "deleted",
      );
      assert.equal(
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM tholi.saved_artifacts WHERE owner_account_id=$1 AND content IS NOT NULL",
            [account.accountId],
          )
        ).rows[0].count,
        0,
      );
      assert.equal(
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM tholi.sessions WHERE account_id=$1",
            [account.accountId],
          )
        ).rows[0].count,
        0,
      );
      assert.equal(
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM tholi.identity_links WHERE account_id=$1",
            [account.accountId],
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await migration.query(
            "SELECT count(*)::integer AS count FROM tholi.free_program_enrollments WHERE account_id=$1",
            [account.accountId],
          )
        ).rows[0].count,
        1,
      );
      assert.equal(
        (
          await migration.query(
            "SELECT resolution FROM tholi.inference_reservations WHERE id=$1",
            [held!.id],
          )
        ).rows[0].resolution,
        "unknown",
      );
      const settled = await repositories.finishInference({
        id: held!.id,
        claimToken: held!.claimToken,
        resolution: "reported",
        outcome: "completed",
        inputUnits: 0n,
        outputUnits: 0n,
        providerUsdMicros: 0n,
        chargedCredits: 1n,
      });
      assert.equal(settled.chargedCredits, 1n);
    },
  );

  await record(
    "account deletion cannot strand organization members or act on a revoked session",
    async () => {
      const owner = await fixture(),
        member = await fixture(),
        org = randomUUID();
      await migration.query(
        "INSERT INTO tholi.workspaces(id,kind,owner_account_id) VALUES($1,'organization',$2)",
        [org, owner.accountId],
      );
      await migration.query(
        "INSERT INTO tholi.memberships(workspace_id,account_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
        [org, owner.accountId, member.accountId],
      );
      await assert.rejects(
        () =>
          service.deleteAccount(
            owner,
            {
              operationId: randomUUID(),
              expectedRevision: "1",
              confirmation: "DELETE",
            },
            context(),
          ),
        { code: "CONFLICT" },
      );
      assert.equal(
        (await repositories.transaction(scope(owner), (tx) => tx.getAccount()))
          .status,
        "active",
      );
      await identities.revokeSession(member.accountId, member.id, new Date());
      await assert.rejects(
        () =>
          service.deleteAccount(
            member,
            {
              operationId: randomUUID(),
              expectedRevision: "1",
              confirmation: "DELETE",
            },
            context(),
          ),
        { code: "FORBIDDEN" },
      );
      assert.equal(
        (await repositories.transaction(scope(member), (tx) => tx.getAccount()))
          .status,
        "active",
      );
    },
  );
}
