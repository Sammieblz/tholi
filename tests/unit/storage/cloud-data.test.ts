import { IDBFactory } from "fake-indexeddb";
import { beforeEach, afterEach, expect, test, vi } from "vitest";
import type { z } from "zod";
import {
  SavedDataClient,
  type SavedDataClientOptions,
  type SavedDataConnection,
} from "../../../packages/navigation-core/saved-data-client";
import { IndexedDBCloudDataStore } from "../../../packages/site-memory/cloud-data";
import { IndexedDBSiteMemory } from "../../../packages/site-memory";
import {
  beginJourney,
  saveTask,
} from "../../../packages/goal-planner/task-journey";
import { savedDataImportInputSchema } from "../../../packages/navigation-core/contracts-saved-data";
import { SERVICE_LIMITS } from "../../../packages/navigation-core/contracts-service";
import {
  savedDataArtifactFixture,
  savedDataRecordFixture,
} from "../../support/saved-data-fixture";

beforeEach(() => vi.stubGlobal("indexedDB", new IDBFactory()));
afterEach(() => vi.unstubAllGlobals());
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((accept) => {
    resolve = accept;
  });
  return { promise, resolve };
}
function fixture() {
  let scope: SavedDataConnection | undefined = {
    serviceOrigin: "https://api.example.test",
    accountId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  };
  let localRevision = "local-1";
  const store = new IndexedDBCloudDataStore();
  const calls: {
    path: string;
    method: string;
    body: unknown;
    signal: AbortSignal;
  }[] = [];
  let capabilities = [
    "saved-data",
    "saved-data-write",
    "saved-data-export",
    "account-binding",
  ];
  const reply =
    vi.fn<(path: string, method: string, body: unknown) => Promise<unknown>>();
  const connection = vi.fn(async () => scope);
  const options: SavedDataClientOptions = {
    connection,
    store,
    localRevision: async () => localRevision,
    async request<T>(
      path: `/api/v1/${string}`,
      schema: z.ZodType<T>,
      method: "GET" | "POST" | "PATCH" | "DELETE",
      body: unknown,
      signal: AbortSignal,
    ) {
      calls.push({ path, method, body: structuredClone(body), signal });
      if (path === "/api/v1/capabilities")
        return schema.parse({
          protocol: "tholi-service",
          version: 1,
          implementationVersion: "test",
          supportedVersions: [1],
          capabilities,
          availability: {
            authentication: true,
            accountData: true,
            decisions: false,
            billing: false,
          },
          limits: SERVICE_LIMITS,
        });
      return schema.parse(await reply(path, method, body));
    },
  };
  const client = new SavedDataClient(options);
  return {
    client,
    options,
    store,
    calls,
    reply,
    connection,
    get scope() {
      return scope!;
    },
    setScope(value: SavedDataConnection | undefined) {
      scope = value;
    },
    revise(value: string) {
      localRevision = value;
    },
    capabilities(value: string[]) {
      capabilities = value;
    },
  };
}

test("local import preview has no egress and changed source revisions require a new review", async () => {
  const f = fixture(),
    artifact = savedDataArtifactFixture();
  const preview = await f.client.previewImport([
    { localKey: "local-route-hash", localRevision: "local-1", artifact },
  ]);
  expect(f.calls).toEqual([]);
  expect(preview.items[0].artifact.id).not.toBe("local-route-hash");
  expect(preview.items[0].artifact.id).not.toBe(artifact.id);
  expect((await f.client.cached()).outbox).toEqual([]);
  f.revise("local-2");
  await expect(f.client.confirmImport(preview.hash)).rejects.toMatchObject({
    code: "PREVIEW_CHANGED",
  });
  expect(f.calls).toEqual([]);
  expect((await f.client.cached()).mappings).toEqual([]);
});

test("confirmed imports keep stable cloud IDs distinct from local IDs and consume each preview once", async () => {
  const f = fixture(),
    artifact = savedDataArtifactFixture();
  const preview = await f.client.previewImport([
    { localKey: "local-route-hash", localRevision: "local-1", artifact },
  ]);
  f.reply.mockImplementationOnce(async (_path, _method, body) => {
    const input = savedDataImportInputSchema.parse(body);
    return {
      items: input.items.map((item) => savedDataRecordFixture(item.artifact)),
      replayed: false,
    };
  });
  const confirmations = await Promise.allSettled([
    f.client.confirmImport(preview.hash),
    f.client.confirmImport(preview.hash),
  ]);
  expect(
    confirmations.filter((result) => result.status === "fulfilled"),
  ).toHaveLength(1);
  expect(
    confirmations.filter((result) => result.status === "rejected"),
  ).toHaveLength(1);
  const state = await f.client.cached();
  expect(state.outbox).toEqual([]);
  expect(state.mappings).toEqual([
    { localKey: "local-route-hash", id: preview.items[0].artifact.id },
  ]);
  await expect(f.client.confirmImport(preview.hash)).rejects.toMatchObject({
    code: "PREVIEW_CHANGED",
  });
  const next = await f.client.previewImport([
    { localKey: "local-route-hash", localRevision: "local-1", artifact },
  ]);
  expect(next.items[0]).toMatchObject({
    expectedRevision: "1",
    artifact: { id: preview.items[0].artifact.id },
  });
  expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(1);
});

test.each(["partial", "wrong-id"])(
  "an %s import acknowledgement retains its original pending operation for reconciliation",
  async (response) => {
    const f = fixture(),
      artifact = savedDataArtifactFixture();
    const preview = await f.client.previewImport([
      { localKey: "selected-route", localRevision: "local-1", artifact },
    ]);
    f.reply.mockResolvedValueOnce({
      items: response === "partial" ? [] : [savedDataRecordFixture(artifact)],
      replayed: false,
    });
    await expect(f.client.confirmImport(preview.hash)).rejects.toMatchObject({
      code: "INVALID_RESPONSE",
    });
    const pending = (await f.client.cached()).outbox;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      state: "uncertain",
      operation: {
        kind: "import",
        body: { previewHash: preview.hash, items: preview.items },
      },
    });
    expect((await f.client.cached()).records).toEqual([]);
  },
);

test("an uncertain save survives a client restart and reconciles only through its original operation key", async () => {
  const f = fixture(),
    artifact = savedDataArtifactFixture("preferences");
  f.reply.mockRejectedValueOnce(new Error("offline"));
  await expect(f.client.save(artifact, "0")).rejects.toThrow("offline");
  const pending = (await f.client.cached()).outbox[0];
  expect(pending.state).toBe("uncertain");
  const restarted = new SavedDataClient(f.options),
    before = f.calls.length;
  expect((await restarted.cached()).outbox).toEqual([pending]);
  expect(f.calls).toHaveLength(before);
  f.reply
    .mockResolvedValueOnce({ items: [], nextAfter: "0", hasMore: false })
    .mockResolvedValueOnce(savedDataRecordFixture(artifact));
  await restarted.reconcile();
  const attempts = f.calls.filter((call) => call.method === "POST");
  expect(attempts).toHaveLength(2);
  expect(attempts[0].body).toEqual(attempts[1].body);
  expect((await restarted.cached()).outbox).toEqual([]);
});

test.each(["stale-save", "live-delete"])(
  "a %s acknowledgement cannot release the original pending operation",
  async (response) => {
    const f = fixture(),
      artifact = savedDataArtifactFixture();
    f.reply.mockResolvedValueOnce(
      savedDataRecordFixture(artifact, {
        revision: response === "stale-save" ? "1" : "2",
      }),
    );
    const operation =
      response === "stale-save"
        ? f.client.save(artifact, "1")
        : f.client.remove(artifact.id, "1");
    await expect(operation).rejects.toMatchObject({ code: "INVALID_RESPONSE" });
    const pending = (await f.client.cached()).outbox;
    expect(pending).toHaveLength(1);
    expect(pending[0]).toMatchObject({
      state: "uncertain",
      operation: { body: { expectedRevision: "1" } },
    });
  },
);

test("a pulled tombstone blocks offline recreation and late stale reads cannot restore the record or handoff", async () => {
  const f = fixture(),
    artifact = savedDataArtifactFixture();
  f.reply.mockRejectedValueOnce(new Error("offline"));
  await expect(f.client.save(artifact, "0")).rejects.toThrow("offline");
  const operation = (await f.client.cached()).outbox[0];
  const tombstone = savedDataRecordFixture(artifact, {
    revision: "2",
    deleted: true,
  });
  f.reply.mockResolvedValueOnce({
    items: [tombstone],
    nextAfter: "2",
    hasMore: false,
  });
  await f.client.reconcile();
  expect((await f.client.cached()).outbox[0].state).toBe("conflict");
  expect(f.calls.filter((call) => call.method === "POST")).toHaveLength(1);
  f.reply.mockResolvedValueOnce(savedDataRecordFixture(artifact));
  expect((await f.client.read(artifact.id)).deletedAt).not.toBeNull();
  f.reply.mockResolvedValueOnce(savedDataRecordFixture(artifact));
  await expect(f.client.routeIntent(artifact.id)).rejects.toMatchObject({
    code: "INVALID_ROUTE",
  });
  await f.client.discardConflict(operation.operation.body.idempotencyKey);
  expect((await f.client.cached()).outbox).toEqual([]);
  expect((await f.client.cached()).records).toEqual([tombstone]);
});

test("logout aborts a late cloud read and clears only cloud state while locally owned routes remain", async () => {
  const f = fixture(),
    artifact = savedDataArtifactFixture(),
    delayed = deferred<unknown>();
  const local = new IndexedDBSiteMemory(),
    task = saveTask(beginJourney("Find Help", "https://example.test"));
  await local.saveTask(task);
  f.reply.mockReturnValueOnce(delayed.promise);
  const waiting = f.client.read(artifact.id);
  const rejected = expect(waiting).rejects.toMatchObject({
    code: "ACCOUNT_CHANGED",
  });
  await vi.waitFor(() => expect(f.calls).toHaveLength(1));
  const oldSignal = f.calls[0].signal;
  await f.client.reset();
  f.setScope({
    ...f.scope,
    accountId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  });
  delayed.resolve(savedDataRecordFixture(artifact));
  await rejected;
  expect(oldSignal.aborted).toBe(true);
  expect((await f.client.cached()).records).toEqual([]);
  expect((await local.tasks(task.origin)).map((entry) => entry.id)).toContain(
    task.id,
  );
});

test("late cleanup from account A preserves account B's independently approved offline operation", async () => {
  const f = fixture(),
    a = savedDataArtifactFixture("preferences");
  f.reply.mockRejectedValueOnce(new Error("offline"));
  await expect(f.client.save(a, "0")).rejects.toThrow("offline");
  const scopeB = {
    ...f.scope,
    accountId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  };
  const b = new SavedDataClient({
    ...f.options,
    store: new IndexedDBCloudDataStore(),
    connection: async () => scopeB,
  });
  f.reply.mockRejectedValueOnce(new Error("offline"));
  await expect(
    b.save(savedDataArtifactFixture("preferences"), "0"),
  ).rejects.toThrow("offline");
  const approved = (await b.cached()).outbox;
  expect(approved).toHaveLength(1);
  await f.client.reset();
  expect((await b.cached()).outbox).toEqual(approved);
});

test("an operation waiting for account connection cannot adopt a replacement account after reset", async () => {
  const f = fixture(),
    connected = deferred<SavedDataConnection | undefined>();
  f.connection.mockReturnValueOnce(connected.promise);
  const waiting = f.client.list();
  const rejected = expect(waiting).rejects.toMatchObject({
    code: "ACCOUNT_CHANGED",
  });
  await vi.waitFor(() => expect(f.connection).toHaveBeenCalledOnce());
  const previous = f.scope;
  await f.client.reset();
  f.setScope({
    ...previous,
    accountId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  });
  connected.resolve(previous);
  await rejected;
  expect(f.calls).toEqual([]);
  expect((await f.client.cached()).records).toEqual([]);
});

test("unavailable write capability refuses content transmission without silently retrying", async () => {
  const f = fixture(),
    artifact = savedDataArtifactFixture("preferences");
  f.capabilities(["saved-data"]);
  await expect(f.client.save(artifact, "0")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(f.calls.map((call) => call.path)).toEqual(["/api/v1/capabilities"]);
  expect(f.reply).not.toHaveBeenCalled();
  expect((await f.client.cached()).outbox).toHaveLength(1);
});

test("a current route read returns only explicit handoff intent and creates no journey or data write", async () => {
  const f = fixture(),
    artifact = savedDataArtifactFixture();
  f.reply.mockResolvedValueOnce(savedDataRecordFixture(artifact));
  expect(await f.client.routeIntent(artifact.id)).toEqual({
    origin: "https://example.test",
    goal: "Open Settings",
  });
  expect(f.calls.map((call) => call.method)).toEqual(["GET"]);
  expect((await f.client.cached()).outbox).toEqual([]);
  f.reply.mockResolvedValueOnce(
    savedDataRecordFixture(savedDataArtifactFixture()),
  );
  await expect(f.client.read(artifact.id)).rejects.toMatchObject({
    code: "INVALID_RESPONSE",
  });
});
