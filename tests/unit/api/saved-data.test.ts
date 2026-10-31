import { randomUUID } from "node:crypto";
import { expect, test, vi } from "vitest";
import {
  SavedDataService,
  type SavedDataExports,
  type SavedDataRepositories,
  type SavedDataTransaction,
} from "../../../apps/api/src/application/saved-data";
import type { RepositoryScope } from "../../../apps/api/src/database/contracts";
import { savedDataImportHash } from "../../../packages/navigation-core/contracts-saved-data";
import { AUTHORIZATION_CONSENT_POLICIES } from "../../../packages/navigation-core/contracts-authorization";
import {
  savedDataArtifactFixture,
  savedDataRecordFixture,
} from "../../support/saved-data-fixture";

function fixture() {
  const scope = { accountId: randomUUID(), workspaceId: randomUUID() };
  const controller = new AbortController();
  const context = {
    requestId: randomUUID(),
    deadlineAt: Date.now() + 25000,
    signal: controller.signal,
  };
  const artifact = savedDataArtifactFixture("saved_route", {
    data: {
      origin: "https://example.test",
      goal: "Open Help",
      steps: [],
      historyCompleted: true,
    },
    metadata: { label: "Help route", folder: "Guides", tags: ["work"] },
  });
  const record = savedDataRecordFixture(artifact);
  const tombstone = savedDataRecordFixture(artifact, {
    revision: "2",
    deleted: true,
  });
  const policy = AUTHORIZATION_CONSENT_POLICIES.find(
    (item) => item.purpose === "cloud_saved_routes",
  )!;
  const consent = { ...policy, granted: true };
  const tx = {
    getAccount: vi.fn(async () => ({
      id: scope.accountId,
      status: "active" as const,
    })),
    getWorkspace: vi.fn(async () => ({
      id: scope.workspaceId,
      kind: "personal" as const,
      ownerAccountId: scope.accountId,
    })),
    getMembership: vi.fn(async () => ({
      accountId: scope.accountId,
      role: "owner" as const,
      status: "active" as const,
    })),
    listConsents: vi.fn(async () => [consent]),
    readSavedDataStorage: vi.fn(async () => ({
      scope: "account" as const,
      artifacts: "1",
      bytes: "100",
    })),
    getSavedArtifact: vi.fn<SavedDataTransaction["getSavedArtifact"]>(
      async () => record,
    ),
    listSavedArtifacts: vi.fn<SavedDataTransaction["listSavedArtifacts"]>(
      async () => ({ items: [record] }),
    ),
    savedArtifactChanges: vi.fn<SavedDataTransaction["savedArtifactChanges"]>(
      async () => ({ items: [tombstone], nextAfter: "2", hasMore: false }),
    ),
    saveSavedArtifact: vi.fn<SavedDataTransaction["saveSavedArtifact"]>(
      async () => record,
    ),
    deleteSavedArtifact: vi.fn<SavedDataTransaction["deleteSavedArtifact"]>(
      async () => tombstone,
    ),
    importSavedArtifacts: vi.fn<SavedDataTransaction["importSavedArtifacts"]>(
      async () => ({ items: [record], replayed: false }),
    ),
  } satisfies SavedDataTransaction;
  const repositories = {
    async transaction<T>(
      _scope: RepositoryScope,
      work: (repository: SavedDataTransaction) => Promise<T>,
    ) {
      return work(tx);
    },
  } satisfies SavedDataRepositories;
  const transactions = vi.spyOn(repositories, "transaction");
  const queued = {
    requestId: randomUUID(),
    jobId: randomUUID(),
    fileId: randomUUID(),
  };
  const exports = {
    requestSavedExport: vi.fn<SavedDataExports["requestSavedExport"]>(
      async () => queued,
    ),
  } satisfies SavedDataExports;
  const mutation = {
    idempotencyKey: randomUUID(),
    expectedRevision: "0",
    approved: true as const,
    artifact,
  };
  const deletion = {
    idempotencyKey: randomUUID(),
    expectedRevision: "1",
    approved: true as const,
  };
  const importInput = async () => {
    const items = [{ expectedRevision: "0", artifact }];
    return {
      idempotencyKey: randomUUID(),
      approved: true as const,
      previewHash: await savedDataImportHash(scope, items),
      items,
    };
  };
  return {
    scope,
    controller,
    context,
    artifact,
    record,
    tombstone,
    consent,
    tx,
    repositories,
    transactions,
    exports,
    queued,
    mutation,
    deletion,
    importInput,
    service: new SavedDataService(repositories, exports, "development"),
  };
}

test("current saved-data consent permits explicit writes while earlier consent and withdrawal cannot authorize broader uploads", async () => {
  const f = fixture();
  await expect(
    f.service.create(f.scope, f.scope.workspaceId, f.mutation, f.context),
  ).resolves.toEqual(f.record);
  expect(f.tx.listConsents).toHaveBeenCalledOnce();
  expect(f.tx.saveSavedArtifact).toHaveBeenCalledWith(f.mutation);
  f.consent.policyVersion = "1";
  await expect(
    f.service.create(f.scope, f.scope.workspaceId, f.mutation, f.context),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  f.consent.granted = false;
  await expect(
    f.service.import(
      f.scope,
      f.scope.workspaceId,
      await f.importInput(),
      f.context,
    ),
  ).rejects.toMatchObject({ code: "FORBIDDEN" });
  expect(f.tx.saveSavedArtifact).toHaveBeenCalledOnce();
  expect(f.tx.importSavedArtifacts).not.toHaveBeenCalled();
  await expect(
    f.service.list(f.scope, f.scope.workspaceId, {}, f.context),
  ).resolves.toEqual({ items: [f.record] });
  await expect(
    f.service.storage(f.scope, f.scope.workspaceId, f.context),
  ).resolves.toEqual({ scope: "account", artifacts: "1", bytes: "100" });
  await expect(
    f.service.delete(
      f.scope,
      f.scope.workspaceId,
      f.artifact.id,
      f.deletion,
      f.context,
    ),
  ).resolves.toEqual(f.tombstone);
  await expect(
    f.service.export(
      f.scope,
      f.scope.workspaceId,
      { idempotencyKey: randomUUID(), ids: [f.artifact.id] },
      f.context,
    ),
  ).resolves.toEqual(f.queued);
});

test("production writes fail before transactions without preventing authorized reads deletion or export", async () => {
  const f = fixture();
  const production = new SavedDataService(f.repositories, f.exports);
  expect(() =>
    production.create(f.scope, f.scope.workspaceId, f.mutation, f.context),
  ).toThrow(expect.objectContaining({ code: "UNAVAILABLE", statusCode: 503 }));
  expect(() =>
    production.update(
      f.scope,
      f.scope.workspaceId,
      f.artifact.id,
      { ...f.mutation, expectedRevision: "1" },
      f.context,
    ),
  ).toThrow(expect.objectContaining({ code: "UNAVAILABLE" }));
  await expect(
    production.import(
      f.scope,
      f.scope.workspaceId,
      await f.importInput(),
      f.context,
    ),
  ).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(f.transactions).not.toHaveBeenCalled();
  expect(f.tx.saveSavedArtifact).not.toHaveBeenCalled();
  await expect(
    production.get(f.scope, f.scope.workspaceId, f.artifact.id, f.context),
  ).resolves.toEqual(f.record);
  await expect(
    production.delete(
      f.scope,
      f.scope.workspaceId,
      f.artifact.id,
      f.deletion,
      f.context,
    ),
  ).resolves.toEqual(f.tombstone);
  await expect(
    production.export(
      f.scope,
      f.scope.workspaceId,
      { idempotencyKey: randomUUID(), ids: [f.artifact.id] },
      f.context,
    ),
  ).resolves.toEqual(f.queued);
});

test("approval schema scope and exact import revisions are checked before any repository mutation", async () => {
  const f = fixture();
  for (const raw of [
    { ...f.mutation, approved: false },
    { ...f.mutation, expectedRevision: "1" },
    { ...f.mutation, accountId: randomUUID() },
    {
      ...f.mutation,
      artifact: {
        ...f.artifact,
        data: { ...f.artifact.data, screenshot: "PRIVATE_IMAGE" },
      },
    },
  ])
    expect(() =>
      f.service.create(f.scope, f.scope.workspaceId, raw, f.context),
    ).toThrow();
  expect(() =>
    f.service.update(
      f.scope,
      f.scope.workspaceId,
      randomUUID(),
      { ...f.mutation, expectedRevision: "1" },
      f.context,
    ),
  ).toThrow(expect.objectContaining({ code: "INVALID_REQUEST" }));
  const input = await f.importInput();
  for (const changed of [
    { ...input, items: [{ ...input.items[0], expectedRevision: "1" }] },
    {
      ...input,
      items: [
        {
          ...input.items[0],
          artifact: {
            ...f.artifact,
            metadata: { ...f.artifact.metadata, label: "Changed" },
          },
        },
      ],
    },
  ])
    await expect(
      f.service.import(f.scope, f.scope.workspaceId, changed, f.context),
    ).rejects.toMatchObject({ code: "CONFLICT" });
  await expect(
    f.service.import(
      { accountId: randomUUID() },
      f.scope.workspaceId,
      input,
      f.context,
    ),
  ).rejects.toMatchObject({ code: "CONFLICT" });
  expect(f.transactions).not.toHaveBeenCalled();
  await expect(
    f.service.import(f.scope, f.scope.workspaceId, input, f.context),
  ).resolves.toEqual({ items: [f.record], replayed: false });
  expect(f.tx.importSavedArtifacts).toHaveBeenCalledWith(input);
});

test("canonical queries and owned export selection are delegated without browser authority or private storage details", async () => {
  const f = fixture();
  await f.service.list(
    f.scope,
    f.scope.workspaceId,
    { limit: "2", query: "Help", folder: "Guides", tag: "work" },
    f.context,
  );
  expect(f.tx.listSavedArtifacts).toHaveBeenCalledWith({
    limit: 2,
    query: "Help",
    folder: "Guides",
    tag: "work",
  });
  await f.service.changes(
    f.scope,
    f.scope.workspaceId,
    { after: "1", limit: "2" },
    f.context,
  );
  expect(f.tx.savedArtifactChanges).toHaveBeenCalledWith({
    after: "1",
    limit: 2,
  });
  const selection = { idempotencyKey: randomUUID(), ids: [f.artifact.id] };
  const result = await f.service.export(
    f.scope,
    f.scope.workspaceId,
    selection,
    f.context,
  );
  expect(result).toEqual(f.queued);
  expect(f.exports.requestSavedExport).toHaveBeenCalledWith(
    f.scope,
    { ...selection, payloadHash: expect.stringMatching(/^[a-f0-9]{64}$/) },
    f.context.signal,
  );
  expect(result).not.toHaveProperty("key");
  f.tx.getSavedArtifact.mockResolvedValueOnce(undefined);
  await expect(
    f.service.get(f.scope, f.scope.workspaceId, randomUUID(), f.context),
  ).rejects.toMatchObject({ statusCode: 404, code: "NOT_FOUND" });
  f.controller.abort();
  await expect(
    f.service.list(f.scope, f.scope.workspaceId, {}, f.context),
  ).rejects.toBeDefined();
});
