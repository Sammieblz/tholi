import assert from "node:assert/strict";
import { randomBytes, randomUUID } from "node:crypto";
import type { Pool } from "pg";
import { SavedDataService } from "../../../apps/api/src/application/saved-data";
import { SupportService } from "../../../apps/api/src/application/support";
import { createFileLinks } from "../../../apps/api/src/adapters/file-links";
import type { ObjectPort } from "../../../apps/api/src/application/support-contracts";
import { PostgresRepositories } from "../../../apps/api/src/database/repositories";
import { PostgresSupport } from "../../../apps/api/src/database/support";
import { PostgresJobs } from "../../../apps/api/src/database/jobs";
import { withTransaction } from "../../../apps/api/src/database/postgres";
import type { JobLease } from "../../../apps/api/src/application/job-contracts";
import type { RepositoryScope } from "../../../apps/api/src/database/contracts";
import {
  savedDataImportHash,
  savedDataExportSnapshotSchema,
  type SavedDataArtifact,
  type SavedDataExportResult,
  type SavedDataImportInput,
  type SavedDataRecord,
} from "../../../packages/navigation-core/contracts-saved-data";
import {
  beginJourney,
  saveTask,
} from "../../../packages/goal-planner/task-journey";
import { savedDataArtifactFixture } from "../../support/saved-data-fixture";
import { planFixture } from "./plan-fixture";

/** The same isolated PostgreSQL runner exercises public DTOs and existing private exports. */
export async function runSavedDataChecks(
  runtime: Pool,
  migration: Pool,
  record: (name: string, work: () => Promise<void>) => Promise<void>,
  worker?: Pool,
) {
  const repositories = new PostgresRepositories(runtime);
  const exports = new PostgresSupport(runtime);
  const service = new SavedDataService(repositories, exports, "development");
  const plans = await planFixture(runtime, migration);
  const context = () => ({
    requestId: randomUUID(),
    deadlineAt: Date.now() + 25000,
    signal: new AbortController().signal,
  });
  const consent = (
    scope: RepositoryScope,
    granted = true,
    policyVersion = "2",
  ) =>
    repositories.transaction(scope, async (tx) => {
      const existing = (await tx.listConsents()).find(
        (item) => item.purpose === "cloud_saved_routes",
      );
      return tx.recordConsent({
        purpose: "cloud_saved_routes",
        policyVersion,
        granted,
        expectedRevision: existing?.revision ?? 0n,
      });
    });
  const fixture = async (enrolled = true) => {
    const scope = await repositories.provisionAccount();
    if (enrolled)
      await repositories.transaction(scope, (tx) => tx.enrollFree());
    await consent(scope);
    return scope;
  };
  const mutation = (
    artifact = savedDataArtifactFixture(),
    expectedRevision = "0",
  ) => ({
    idempotencyKey: randomUUID(),
    expectedRevision,
    approved: true as const,
    artifact,
  });
  const create = (
    scope: RepositoryScope,
    artifact = savedDataArtifactFixture(),
  ) => service.create(scope, scope.workspaceId, mutation(artifact), context());
  const get = (scope: RepositoryScope, id: string) =>
    service.get(scope, scope.workspaceId, id, context());
  const list = (scope: RepositoryScope, query: unknown = {}) =>
    service.list(scope, scope.workspaceId, query, context());
  const update = (
    scope: RepositoryScope,
    previous: SavedDataRecord,
    artifact: SavedDataArtifact,
  ) =>
    service.update(
      scope,
      scope.workspaceId,
      previous.id,
      mutation(artifact, previous.revision),
      context(),
    );
  const remove = (scope: RepositoryScope, previous: SavedDataRecord) =>
    service.delete(
      scope,
      scope.workspaceId,
      previous.id,
      {
        idempotencyKey: randomUUID(),
        expectedRevision: previous.revision,
        approved: true,
      },
      context(),
    );
  const importInput = async (
    scope: RepositoryScope,
    items: SavedDataImportInput["items"],
  ): Promise<SavedDataImportInput> => ({
    idempotencyKey: randomUUID(),
    approved: true,
    items,
    previewHash: await savedDataImportHash(scope, items),
  });
  const importItems = (scope: RepositoryScope, input: SavedDataImportInput) =>
    service.import(scope, scope.workspaceId, input, context());
  const bytes = async (scope: RepositoryScope, id: string) =>
    Number(
      (
        await migration.query(
          `SELECT (octet_length(content::text)+CASE WHEN format_version=2 THEN COALESCE(octet_length(metadata::text),0) ELSE 0 END)::text AS bytes
             FROM tholi.saved_artifacts WHERE workspace_id=$1 AND id=$2 AND deleted_at IS NULL`,
          [scope.workspaceId, id],
        )
      ).rows[0].bytes,
    );

  try {
    await record(
      "approved four-kind saved data uses one revision owner and keeps legacy routes private until explicit conversion",
      async () => {
        await plans.selectFree({ maxSavedArtifacts: 20 });
        const scope = await fixture();
        const kinds = [
          "saved_route",
          "site_knowledge",
          "conversation_excerpt",
          "preferences",
        ] as const;
        const saved = [];
        for (const kind of kinds)
          saved.push(await create(scope, savedDataArtifactFixture(kind)));
        assert.deepEqual(
          (await list(scope)).items.map((item) => item.kind),
          kinds,
        );
        assert.equal(
          (await list(scope, { kind: "preferences" })).items.length,
          1,
        );
        const route = saved[0];
        const organizedArtifact = savedDataArtifactFixture("saved_route", {
          id: route.id,
          metadata: {
            label: "My help route",
            folder: "Work",
            tags: ["help", "daily"],
          },
        });
        const organized = await update(scope, route, organizedArtifact);
        assert.equal(organized.revision, "2");
        assert.deepEqual(
          (
            await list(scope, { query: "help", folder: "Work", tag: "daily" })
          ).items.map((item) => item.id),
          [route.id],
        );
        assert.equal(
          (await list(scope, { query: "not present" })).items.length,
          0,
        );
        assert.throws(() =>
          service.create(
            scope,
            scope.workspaceId,
            {
              ...mutation(),
              artifact: {
                ...organizedArtifact,
                id: randomUUID(),
                rawScreenshot: "PRIVATE_IMAGE_SENTINEL",
              },
            },
            context(),
          ),
        );
        assert.throws(() =>
          service.create(
            scope,
            scope.workspaceId,
            {
              ...mutation(),
              artifact: {
                ...organizedArtifact,
                id: randomUUID(),
                data: {
                  ...organizedArtifact.data,
                  selector: "PRIVATE_SELECTOR_SENTINEL",
                },
              },
            },
            context(),
          ),
        );
        assert.equal((await list(scope)).items.length, 4);

        // SQL constraints must reject JSON null even when the wire parser is
        // bypassed by a buggy trusted caller. PostgreSQL CHECK accepts SQL NULL.
        const malformed = [
          { row: saved[3], data: { websiteAppearance: null } },
          {
            row: saved[0],
            data: {
              ...saved[0].data,
              steps: [{ kind: null, label: "Settings" }],
            },
          },
          {
            row: saved[1],
            data: {
              ...saved[1].data,
              controls: [{ kind: null, role: "button", label: "Settings" }],
            },
          },
          {
            row: saved[2],
            data: { messages: [{ role: null, text: "Find settings" }] },
          },
        ];
        for (const { row, data } of malformed)
          await assert.rejects(
            () =>
              withTransaction(
                runtime,
                (client) =>
                  client.query(
                    "UPDATE tholi.saved_artifacts SET content=$3::jsonb WHERE workspace_id=$1 AND id=$2",
                    [scope.workspaceId, row.id, JSON.stringify(data)],
                  ),
                scope,
              ),
            { code: "23514" },
          );
        await assert.rejects(
          () =>
            withTransaction(
              runtime,
              (client) =>
                client.query(
                  `WITH stamp AS (UPDATE tholi.workspaces SET sync_revision=sync_revision+1 WHERE id=$1 RETURNING sync_revision)
           INSERT INTO tholi.saved_artifacts(workspace_id,id,owner_account_id,kind,content,metadata,format_version,sync_revision,deleted_at)
           VALUES($1,$2,$3,'preferences',NULL,NULL,2,(SELECT sync_revision FROM stamp),clock_timestamp())`,
                  [scope.workspaceId, randomUUID(), scope.accountId],
                ),
              scope,
            ),
          { code: "23514" },
        );
        const snapshot = savedDataExportSnapshotSchema.parse({
          schemaVersion: 1,
          kind: "saved-data-export",
          createdAt: new Date().toISOString(),
          items: saved,
        });
        const validExport = async (value: unknown) =>
          (
            await runtime.query(
              "SELECT tholi.valid_saved_export($1::jsonb) AS valid",
              [JSON.stringify(value)],
            )
          ).rows[0].valid;
        assert.equal(await validExport(snapshot), true);
        for (const invalid of [
          { ...snapshot, kind: null },
          { ...snapshot, items: [{ ...saved[0], id: null }] },
          { ...snapshot, items: [{ ...saved[0], revision: null }] },
          { ...snapshot, items: [{ ...saved[0], revision: 1 }] },
        ])
          assert.equal(await validExport(invalid), false);
        assert.equal((await list(scope)).items.length, 4);

        const legacy = await repositories.transaction(scope, (tx) =>
          tx.saveArtifact({
            expectedRevision: 0n,
            userApproved: true,
            content: saveTask(
              beginJourney("Open Help", "https://example.test"),
            ),
          }),
        );
        const storage = await service.storage(
          scope,
          scope.workspaceId,
          context(),
        );
        const actualStorage = (
          await migration.query(
            `SELECT count(*)::text AS artifacts,COALESCE(sum(octet_length(content::text)+CASE WHEN format_version=2 THEN COALESCE(octet_length(metadata::text),0) ELSE 0 END),0)::text AS bytes
           FROM tholi.saved_artifacts WHERE owner_account_id=$1 AND deleted_at IS NULL`,
            [scope.accountId],
          )
        ).rows[0];
        assert.deepEqual(storage, { scope: "account", ...actualStorage });
        assert.equal(storage.artifacts, "5");
        await assert.rejects(() => get(scope, legacy.id), {
          code: "NOT_FOUND",
        });
        assert.equal((await list(scope)).items.length, 4);
        const conversion = savedDataArtifactFixture("saved_route", {
          id: legacy.id,
        });
        await assert.rejects(() => create(scope, conversion), {
          code: "CONFLICT",
        });
        const converted = await service.update(
          scope,
          scope.workspaceId,
          legacy.id,
          mutation(conversion, legacy.revision.toString()),
          context(),
        );
        assert.equal(converted.id, legacy.id);
        assert.equal(converted.revision, (legacy.revision + 1n).toString());
        assert.equal(
          await repositories.transaction(scope, (tx) =>
            tx.getArtifact(legacy.id),
          ),
          undefined,
        );
        const stored = (
          await migration.query(
            "SELECT format_version,content,metadata FROM tholi.saved_artifacts WHERE workspace_id=$1 AND id=$2",
            [scope.workspaceId, converted.id],
          )
        ).rows[0];
        assert.equal(stored.format_version, 2);
        assert.equal(JSON.stringify(stored).includes("PRIVATE_"), false);
      },
    );

    await record(
      "saved data search cursors and mutations cannot cross an account or workspace boundary",
      async () => {
        const owner = await fixture(),
          other = await fixture();
        const first = await create(owner),
          second = await create(owner);
        const page = await list(owner, { limit: 1 });
        assert.ok(page.nextCursor);
        assert.deepEqual(
          (await list(owner, { limit: 1, cursor: page.nextCursor })).items.map(
            (item) => item.id,
          ),
          [second.id],
        );
        await assert.rejects(
          () =>
            list(owner, {
              limit: 1,
              cursor: page.nextCursor,
              query: "changed",
            }),
          { code: "INVALID_REQUEST" },
        );
        await assert.rejects(
          () => list(other, { limit: 1, cursor: page.nextCursor }),
          { code: "INVALID_REQUEST" },
        );
        await assert.rejects(() => get(other, first.id), { code: "NOT_FOUND" });
        await assert.rejects(
          () => service.get(owner, other.workspaceId, first.id, context()),
          { code: "FORBIDDEN" },
        );
        await assert.rejects(
          () =>
            update(
              other,
              first,
              savedDataArtifactFixture("saved_route", { id: first.id }),
            ),
          { code: "CONFLICT" },
        );
        await assert.rejects(() => remove(other, first), { code: "CONFLICT" });
        assert.deepEqual((await list(other)).items, []);
        assert.equal((await get(owner, first.id)).revision, first.revision);
      },
    );

    await record(
      "saved-data purpose version and both withdrawal orderings fence actual SQL writes without deadlocks",
      async () => {
        const scope = await fixture();
        const saved = await create(scope);
        await consent(scope, true, "1");
        await assert.rejects(() => create(scope), { code: "FORBIDDEN" });
        await consent(scope);

        let release!: () => void, entered!: () => void;
        const hold = new Promise<void>((resolve) => {
          release = resolve;
        });
        const ready = new Promise<void>((resolve) => {
          entered = resolve;
        });
        const admitted = repositories.transaction(scope, async (tx) => {
          await tx.saveSavedArtifact(mutation());
          entered();
          await hold;
        });
        await ready;
        const withdrawing = consent(scope, false);
        release();
        await Promise.all([admitted, withdrawing]);
        await assert.rejects(() => create(scope), { code: "FORBIDDEN" });
        assert.equal((await get(scope, saved.id)).id, saved.id);

        await consent(scope);
        let finishWithdrawal!: () => void,
          withdrew!: () => void,
          attempted!: () => void;
        const withdrawalHold = new Promise<void>((resolve) => {
          finishWithdrawal = resolve;
        });
        const withdrawalReady = new Promise<void>((resolve) => {
          withdrew = resolve;
        });
        const attemptReady = new Promise<void>((resolve) => {
          attempted = resolve;
        });
        const withdrawal = repositories.transaction(scope, async (tx) => {
          const current = (await tx.listConsents()).find(
            (item) => item.purpose === "cloud_saved_routes",
          )!;
          await tx.recordConsent({
            purpose: current.purpose,
            policyVersion: "2",
            granted: false,
            expectedRevision: current.revision,
          });
          withdrew();
          await withdrawalHold;
        });
        await withdrawalReady;
        const late = repositories.transaction(scope, async (tx) => {
          attempted();
          return tx.saveSavedArtifact(mutation());
        });
        const denied = assert.rejects(() => late, { code: "FORBIDDEN" });
        await attemptReady;
        finishWithdrawal();
        await Promise.all([withdrawal, denied]);
        assert.equal((await list(scope)).items.length, 2);
        const deleted = await remove(scope, saved);
        assert.equal(deleted.data, null);
        const remaining = (await list(scope)).items[0];
        assert.ok(
          await service.export(
            scope,
            scope.workspaceId,
            { idempotencyKey: randomUUID(), ids: [remaining.id] },
            context(),
          ),
        );
      },
    );

    await record(
      "approved imports bind exact scope and revisions and replay IDs without resurrecting deleted records",
      async () => {
        const scope = await fixture(),
          other = await fixture();
        const original = await create(scope),
          another = await create(scope);
        const changed = savedDataArtifactFixture("saved_route", {
          id: original.id,
          metadata: { label: "Changed", folder: "Work", tags: [] },
        });
        const badBatch = await importInput(scope, [
          { expectedRevision: original.revision, artifact: changed },
          {
            expectedRevision: "99",
            artifact: savedDataArtifactFixture("saved_route", {
              id: another.id,
            }),
          },
        ]);
        await assert.rejects(() => importItems(scope, badBatch), {
          code: "CONFLICT",
        });
        assert.equal(
          (await get(scope, original.id)).revision,
          original.revision,
        );
        const fresh = savedDataArtifactFixture("conversation_excerpt");
        const input = await importInput(scope, [
          { expectedRevision: original.revision, artifact: changed },
          { expectedRevision: "0", artifact: fresh },
        ]);
        await assert.rejects(() => importItems(other, input), {
          code: "CONFLICT",
        });
        await assert.rejects(() =>
          importItems(scope, {
            ...input,
            approved: false,
          } as unknown as SavedDataImportInput),
        );
        const imported = await importItems(scope, input);
        assert.equal(imported.replayed, false);
        assert.deepEqual(
          imported.items.map((item) => item.id),
          [original.id, fresh.id],
        );
        const replay = await importItems(scope, input);
        assert.equal(replay.replayed, true);
        assert.deepEqual(replay.items, imported.items);
        const deleted = await remove(scope, imported.items[1]);
        const afterDelete = await importItems(scope, input);
        assert.equal(afterDelete.replayed, true);
        assert.deepEqual(afterDelete.items[1], deleted);
        await assert.rejects(() => create(scope, fresh), { code: "CONFLICT" });
        const changedReplay = await importInput(scope, [
          { expectedRevision: "0", artifact: savedDataArtifactFixture() },
        ]);
        await assert.rejects(
          () =>
            importItems(scope, {
              ...changedReplay,
              idempotencyKey: input.idempotencyKey,
            }),
          { code: "IDEMPOTENCY_CONFLICT" },
        );
        const receipt = (
          await migration.query(
            "SELECT saved_data_receipt FROM tholi.requests WHERE workspace_id=$1 AND idempotency_key=$2",
            [scope.workspaceId, input.idempotencyKey],
          )
        ).rows[0].saved_data_receipt;
        assert.deepEqual(receipt, {
          schemaVersion: 1,
          ids: [original.id, fresh.id],
        });
        assert.equal(JSON.stringify(receipt).includes("Changed"), false);
      },
    );

    await record(
      "saved-data revision feeds retain content-free tombstones and reject stale offline updates",
      async () => {
        const scope = await fixture();
        const firstInput = mutation();
        const first = await service.create(
          scope,
          scope.workspaceId,
          firstInput,
          context(),
        );
        const second = await create(
          scope,
          savedDataArtifactFixture("preferences"),
        );
        const firstReplay = await service.create(
          scope,
          scope.workspaceId,
          firstInput,
          context(),
        );
        assert.deepEqual(firstReplay, first);
        const deletionInput = {
          idempotencyKey: randomUUID(),
          approved: true as const,
          expectedRevision: first.revision,
        };
        const deleted = await service.delete(
          scope,
          scope.workspaceId,
          first.id,
          deletionInput,
          context(),
        );
        assert.deepEqual(
          await service.delete(
            scope,
            scope.workspaceId,
            first.id,
            deletionInput,
            context(),
          ),
          deleted,
        );
        assert.deepEqual(
          await service.create(scope, scope.workspaceId, firstInput, context()),
          deleted,
        );
        await assert.rejects(() => update(scope, first, firstInput.artifact), {
          code: "CONFLICT",
        });
        await assert.rejects(() => remove(scope, first), { code: "CONFLICT" });
        const one = await service.changes(
          scope,
          scope.workspaceId,
          { limit: 1 },
          context(),
        );
        assert.equal(one.hasMore, true);
        assert.equal(one.items[0].id, second.id);
        const two = await service.changes(
          scope,
          scope.workspaceId,
          { after: one.nextAfter, limit: 1 },
          context(),
        );
        assert.equal(two.hasMore, false);
        assert.deepEqual(two.items, [deleted]);
        assert.deepEqual(deleted.metadata, {
          label: "Deleted item",
          folder: null,
          tags: [],
        });
        assert.equal(deleted.data, null);
        assert.deepEqual(
          (await list(scope)).items.map((item) => item.id),
          [second.id],
        );
        const exhausted = await service.changes(
          scope,
          scope.workspaceId,
          { after: two.nextAfter },
          context(),
        );
        assert.deepEqual(exhausted, {
          items: [],
          nextAfter: two.nextAfter,
          hasMore: false,
        });
      },
    );

    await record(
      "format-two storage counts actual metadata bytes and serializes quotas while preserving ended-plan shrink and deletion",
      async () => {
        const unenrolled = await fixture(false);
        await assert.rejects(() => create(unenrolled), {
          code: "QUOTA_EXCEEDED",
        });
        await plans.selectFree({ maxSavedArtifacts: 1 });
        const countScope = await fixture();
        const race = await Promise.allSettled([
          create(countScope),
          create(countScope),
        ]);
        assert.equal(
          race.filter((item) => item.status === "fulfilled").length,
          1,
        );
        assert.equal(
          race.filter(
            (item) =>
              item.status === "rejected" &&
              item.reason.code === "QUOTA_EXCEEDED",
          ).length,
          1,
        );
        await remove(countScope, (await list(countScope)).items[0]);
        await create(countScope);

        await plans.selectFree({ maxSavedArtifacts: 20 });
        const scope = await fixture();
        const artifact = savedDataArtifactFixture("preferences", {
          metadata: {
            label: "A useful appearance preference",
            folder: "Work",
            tags: ["daily"],
          },
        });
        const probe = await create(scope, artifact);
        const actualBytes = await bytes(scope, probe.id);
        const contentBytes = Number(
          (
            await migration.query(
              "SELECT octet_length(content::text) AS bytes FROM tholi.saved_artifacts WHERE workspace_id=$1 AND id=$2",
              [scope.workspaceId, probe.id],
            )
          ).rows[0].bytes,
        );
        assert.ok(actualBytes > contentBytes);
        await remove(scope, probe);
        await plans.selectFree({
          maxSavedArtifacts: 20,
          maxSavedArtifactBytes: String(actualBytes + 10),
          maxStoredBytes: String(actualBytes + 1),
        });
        const limited = await fixture();
        const byteRace = await Promise.allSettled([
          create(
            limited,
            savedDataArtifactFixture("preferences", {
              metadata: artifact.metadata,
            }),
          ),
          create(
            limited,
            savedDataArtifactFixture("preferences", {
              metadata: artifact.metadata,
            }),
          ),
        ]);
        assert.equal(
          byteRace.filter((item) => item.status === "fulfilled").length,
          1,
        );
        assert.equal(
          byteRace.filter(
            (item) =>
              item.status === "rejected" &&
              item.reason.code === "QUOTA_EXCEEDED",
          ).length,
          1,
        );
        const stored = (await list(limited)).items[0];
        assert.equal(await bytes(limited, stored.id), actualBytes);
        assert.deepEqual(
          await service.storage(limited, limited.workspaceId, context()),
          { scope: "account", artifacts: "1", bytes: String(actualBytes) },
        );
        await migration.query(
          "UPDATE tholi.entitlements SET status='ended',revision=revision+1 WHERE workspace_id=$1",
          [limited.workspaceId],
        );
        assert.equal((await get(limited, stored.id)).id, stored.id);
        assert.equal(
          (await service.storage(limited, limited.workspaceId, context()))
            .bytes,
          String(actualBytes),
        );
        const grow = savedDataArtifactFixture("preferences", {
          id: stored.id,
          metadata: {
            ...artifact.metadata,
            label:
              "A much longer appearance preference that now exceeds the previous length",
          },
        });
        await assert.rejects(() => update(limited, stored, grow), {
          code: "QUOTA_EXCEEDED",
        });
        const shrunk = await update(
          limited,
          stored,
          savedDataArtifactFixture("preferences", {
            id: stored.id,
            metadata: { label: "Theme", folder: null, tags: [] },
          }),
        );
        assert.ok((await bytes(limited, stored.id)) < actualBytes);
        assert.ok(
          await service.export(
            limited,
            limited.workspaceId,
            { idempotencyKey: randomUUID(), ids: [stored.id] },
            context(),
          ),
        );
        assert.equal((await remove(limited, shrunk)).data, null);
        assert.deepEqual(
          await service.storage(limited, limited.workspaceId, context()),
          { scope: "account", artifacts: "0", bytes: "0" },
        );
        await assert.rejects(() => create(limited), { code: "QUOTA_EXCEEDED" });
      },
    );

    if (worker)
      await record(
        "selected saved exports reuse private jobs and retain per-member ownership across personal sessions and organization revocation",
        async () => {
          await plans.selectFree({ maxSavedArtifacts: 20 });
          const owner = await fixture(),
            member = await fixture(),
            stranger = await fixture();
          const a = await create(owner),
            b = await create(
              member,
              savedDataArtifactFixture("conversation_excerpt"),
            );
          const workspaceId = randomUUID();
          await migration.query(
            "INSERT INTO tholi.workspaces(id,kind,owner_account_id) VALUES($1,'organization',$2)",
            [workspaceId, owner.accountId],
          );
          await migration.query(
            "INSERT INTO tholi.memberships(workspace_id,account_id,role) VALUES($1,$2,'owner'),($1,$3,'member')",
            [workspaceId, owner.accountId, member.accountId],
          );
          const ownerOrg = { ...owner, workspaceId },
            memberOrg = { ...member, workspaceId };
          await consent(ownerOrg);
          await consent(memberOrg);
          // Retained historical organization records, provisioned by the migrator.
          // This grants no public organization Free enrollment or storage growth.
          for (const [scope, item] of [
            [owner, a],
            [member, b],
          ] as const)
            await withTransaction(
              migration,
              (client) =>
                client.query(
                  `WITH stamp AS (UPDATE tholi.workspaces SET sync_revision=sync_revision+1 WHERE id=$1 RETURNING sync_revision)
               UPDATE tholi.saved_artifacts SET workspace_id=$1,sync_revision=(SELECT sync_revision FROM stamp)
               WHERE workspace_id=$2 AND owner_account_id=$3 AND id=$4`,
                  [workspaceId, scope.workspaceId, scope.accountId, item.id],
                ),
              { accountId: scope.accountId, workspaceId },
            );
          assert.deepEqual(
            (await list(ownerOrg)).items.map((item) => item.id),
            [a.id],
          );
          assert.deepEqual(
            (await list(memberOrg)).items.map((item) => item.id),
            [b.id],
          );
          assert.deepEqual((await list(owner)).items, []);
          assert.deepEqual(
            await service.storage(owner, owner.workspaceId, context()),
            {
              scope: "account",
              artifacts: "1",
              bytes: String(await bytes(ownerOrg, a.id)),
            },
          );
          assert.deepEqual(
            await service.storage(ownerOrg, workspaceId, context()),
            await service.storage(owner, owner.workspaceId, context()),
          );
          assert.deepEqual(
            await service.storage(stranger, stranger.workspaceId, context()),
            { scope: "account", artifacts: "0", bytes: "0" },
          );
          await assert.rejects(
            () => service.storage(stranger, workspaceId, context()),
            { code: "FORBIDDEN" },
          );
          await assert.rejects(() => get(ownerOrg, b.id), {
            code: "NOT_FOUND",
          });
          const jobs = new PostgresJobs(worker),
            effects = new PostgresSupport(worker);
          const bodies = new Map<string, Uint8Array>();
          let objectReads = 0;
          const objects: ObjectPort = {
            async put(file, body) {
              bodies.set(file.key, Uint8Array.from(body));
            },
            async read(file) {
              objectReads++;
              const body = bodies.get(file.key);
              assert.ok(body);
              return Uint8Array.from(body);
            },
            async delete(file) {
              bodies.delete(file.key);
            },
            async close() {
              bodies.clear();
            },
          };
          const links = createFileLinks(randomBytes(32).toString("base64url"));
          const support = new SupportService(exports, objects, links, {
            publicOrigin: "https://api.example.test",
            linkLifetimeMs: 60000,
          });
          const queued: {
            saved: SavedDataExportResult;
            token: string;
            revision: string;
          }[] = [];
          let pendingBeforeRevoke:
            { lease: JobLease; attemptId: string; fileId: string } | undefined;
          for (const [scope, item] of [
            [ownerOrg, a],
            [memberOrg, b],
            [memberOrg, b],
          ] as const) {
            const input = { idempotencyKey: randomUUID(), ids: [item.id] };
            const saved = await service.export(
              scope,
              workspaceId,
              input,
              context(),
            );
            assert.deepEqual(
              await service.export(scope, workspaceId, input, context()),
              saved,
            );
            await migration.query(
              "UPDATE tholi.jobs SET available_at=clock_timestamp()+interval '1 day' WHERE kind='file.saved-data-export' AND status='queued' AND id<>$1",
              [saved.jobId],
            );
            await migration.query(
              "UPDATE tholi.jobs SET available_at=clock_timestamp()-interval '1 second' WHERE id=$1",
              [saved.jobId],
            );
            const lease = (
              await jobs.claim({
                workerId: "saved-data-pg",
                kinds: [
                  {
                    kind: "file.saved-data-export",
                    version: 1,
                    replaySafe: true,
                  },
                ],
                leaseMs: 30000,
                limit: 10,
              })
            ).find((job) => job.id === saved.jobId);
            assert.ok(lease);
            const prepared = await effects.prepareExternal(lease);
            assert.ok(prepared && prepared.command.type === "put");
            assert.equal(
              await effects.authorizeExternal(lease, prepared.attemptId),
              true,
            );
            const snapshot = savedDataExportSnapshotSchema.parse(
              JSON.parse(new TextDecoder().decode(prepared.command.body)),
            );
            assert.deepEqual(
              snapshot.items.map((entry) => entry.id),
              [item.id],
            );
            const jobRows = (
              await migration.query(
                "SELECT record_references FROM tholi.jobs WHERE id=$1",
                [saved.jobId],
              )
            ).rows;
            assert.deepEqual(jobRows[0].record_references, {
              requestId: saved.requestId,
            });
            assert.equal(JSON.stringify(jobRows).includes("messages"), false);
            if (queued.length === 2) {
              pendingBeforeRevoke = {
                lease,
                attemptId: prepared.attemptId,
                fileId: saved.fileId,
              };
              break;
            }
            await objects.put(
              prepared.command.file,
              prepared.command.body,
              context().signal,
            );
            assert.equal(
              await effects.finishExternal(lease, prepared.attemptId, {
                status: "committed",
                backoffMs: 0,
              }),
              true,
            );
            const file = await exports.getFile(
              scope.accountId === owner.accountId ? owner : member,
              saved.fileId,
            );
            assert.equal(file?.workspaceId, workspaceId);
            assert.equal(file?.purpose, "saved-data-export");
            assert.equal(file?.status, "ready");
            const principal =
              scope.accountId === owner.accountId ? owner : member;
            const publicFile = await support.getFile(
              principal,
              saved.fileId,
              context(),
            );
            assert.equal("key" in publicFile, false);
            const downloadLink = await support.fileLink(
              principal,
              saved.fileId,
              { expectedRevision: publicFile.revision },
              context(),
            );
            const token = new URL(downloadLink.url).searchParams.get("token")!;
            const proof = await links.verify(token);
            assert.equal(proof.accountId, principal.accountId);
            assert.equal(proof.workspaceId, workspaceId);
            assert.notEqual(proof.workspaceId, principal.workspaceId);
            const download = await support.download(
              principal,
              saved.fileId,
              token,
              context(),
            );
            assert.equal(download.filename, "tholi-saved-data.json");
            assert.deepEqual(
              Buffer.from(download.body),
              Buffer.from(prepared.command.body),
            );
            assert.deepEqual(
              savedDataExportSnapshotSchema
                .parse(JSON.parse(new TextDecoder().decode(download.body)))
                .items.map((entry) => entry.id),
              [item.id],
            );
            queued.push({ saved, token, revision: publicFile.revision });
          }
          assert.equal(objectReads, 2);
          await assert.rejects(
            () =>
              support.download(
                member,
                queued[0].saved.fileId,
                queued[0].token,
                context(),
              ),
            { code: "NOT_FOUND" },
          );
          await assert.rejects(
            () =>
              support.download(
                stranger,
                queued[0].saved.fileId,
                queued[0].token,
                context(),
              ),
            { code: "NOT_FOUND" },
          );
          assert.equal(objectReads, 2);
          assert.equal(
            await exports.getFile(member, queued[0].saved.fileId),
            null,
          );
          assert.equal(
            await exports.getFile(owner, queued[1].saved.fileId),
            null,
          );
          assert.equal(
            await exports.getFile(stranger, queued[0].saved.fileId),
            null,
          );
          await assert.rejects(
            () =>
              service.export(
                ownerOrg,
                workspaceId,
                { idempotencyKey: randomUUID(), ids: [b.id] },
                context(),
              ),
            { code: "FORBIDDEN" },
          );
          await migration.query(
            "UPDATE tholi.memberships SET status='revoked',revision=revision+1 WHERE workspace_id=$1 AND account_id=$2",
            [workspaceId, member.accountId],
          );
          assert.ok(pendingBeforeRevoke);
          assert.equal(
            await effects.authorizeExternal(
              pendingBeforeRevoke.lease,
              pendingBeforeRevoke.attemptId,
            ),
            false,
          );
          // A late transport receipt after revocation remains private and queues
          // the established cleanup owner; time alone never certifies no send.
          assert.equal(
            await effects.finishExternal(
              pendingBeforeRevoke.lease,
              pendingBeforeRevoke.attemptId,
              { status: "committed", backoffMs: 0 },
            ),
            true,
          );
          assert.equal(
            (
              await migration.query(
                "SELECT status FROM tholi.private_files WHERE id=$1",
                [pendingBeforeRevoke.fileId],
              )
            ).rows[0].status,
            "deleting",
          );
          assert.equal(
            await exports.getFile(member, queued[1].saved.fileId),
            null,
          );
          await assert.rejects(
            () => support.getFile(member, queued[1].saved.fileId, context()),
            { code: "NOT_FOUND" },
          );
          await assert.rejects(
            () =>
              support.fileLink(
                member,
                queued[1].saved.fileId,
                { expectedRevision: queued[1].revision },
                context(),
              ),
            { code: "NOT_FOUND" },
          );
          await assert.rejects(
            () =>
              support.download(
                member,
                queued[1].saved.fileId,
                queued[1].token,
                context(),
              ),
            { code: "NOT_FOUND" },
          );
          assert.equal(objectReads, 2);
          await assert.rejects(() => get(memberOrg, b.id), {
            code: "FORBIDDEN",
          });
          await assert.rejects(
            () => service.storage(memberOrg, workspaceId, context()),
            { code: "FORBIDDEN" },
          );
          assert.equal(
            (await exports.getFile(owner, queued[0].saved.fileId))?.status,
            "ready",
          );
          await migration.query(
            "UPDATE tholi.private_files SET expires_at=clock_timestamp()-interval '1 second' WHERE id=$1",
            [queued[0].saved.fileId],
          );
          assert.equal(
            await exports.getFile(owner, queued[0].saved.fileId),
            null,
          );
          await assert.rejects(
            () =>
              support.download(
                owner,
                queued[0].saved.fileId,
                queued[0].token,
                context(),
              ),
            { code: "NOT_FOUND" },
          );
          assert.equal(objectReads, 2);
          await objects.close();
        },
      );
  } finally {
    await plans.restore();
  }
}
