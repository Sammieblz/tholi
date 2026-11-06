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
import { AUTHORIZATION_CONSENT_POLICIES } from "../../../packages/navigation-core/contracts-authorization";
import { navigationKnowledgeQuerySchema } from "../../../packages/navigation-core/contracts-navigation-knowledge";
import { ServiceClientError } from "../../../packages/navigation-core/service-client";
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

const graphCapabilities = [
  "saved-data",
  "saved-data-write",
  "saved-data-export",
  "saved-data-schema-2",
  "account-binding",
];
function graphFixture() {
  const f = fixture();
  f.setScope({ ...f.scope, schemaVersion: 2 });
  f.capabilities([...graphCapabilities]);
  return f;
}

test("schema-2 read compatibility is discovered once within the current bound epoch", async () => {
  const f = graphFixture(),
    record = savedDataRecordFixture(savedDataArtifactFixture());
  f.reply
    .mockResolvedValueOnce({ items: [record] })
    .mockResolvedValueOnce(record)
    .mockResolvedValueOnce({
      origin: "https://example.test",
      revision: "0",
      collect: false,
      use: false,
      updatedAt: null,
    })
    .mockResolvedValueOnce({ items: [record] });
  await f.client.list();
  await f.client.read(record.id);
  await f.client.siteSettings("https://example.test");
  await f.client.list();
  expect(
    f.calls.filter((call) => call.path === "/api/v1/capabilities"),
  ).toHaveLength(1);
  expect(f.reply).toHaveBeenCalledTimes(4);
  expect(
    f.calls
      .filter((call) => call.path !== "/api/v1/capabilities")
      .every((call) => call.path.includes("schemaVersion=2")),
  ).toBe(true);
});

test.each([
  "suspend",
  "reset",
  "service",
  "account",
  "workspace",
  "view",
] as const)(
  "%s invalidates the prior schema-2 compatibility proof without transferring it to another epoch",
  async (change) => {
    const f = graphFixture();
    f.reply.mockResolvedValue({ items: [] });
    await f.client.list();
    if (change === "suspend") f.client.suspend();
    else if (change === "reset") await f.client.reset();
    else if (change === "view") {
      f.client.suspend();
      f.setScope({ ...f.scope, schemaVersion: undefined });
      await f.client.list();
      expect(
        f.calls.filter((call) => call.path === "/api/v1/capabilities"),
      ).toHaveLength(1);
      f.client.suspend();
      f.setScope({ ...f.scope, schemaVersion: 2 });
    } else {
      const before = f.calls.length;
      f.setScope({
        ...f.scope,
        ...(change === "service"
          ? { serviceOrigin: "https://other.example.test" }
          : change === "account"
            ? { accountId: crypto.randomUUID() }
            : { workspaceId: crypto.randomUUID() }),
      });
      await expect(f.client.list()).rejects.toMatchObject({
        code: "ACCOUNT_CHANGED",
      });
      expect(f.calls).toHaveLength(before);
    }
    await f.client.list();
    await f.client.list();
    expect(
      f.calls.filter((call) => call.path === "/api/v1/capabilities"),
    ).toHaveLength(2);
  },
);

test("a read compatibility proof cannot authorize writes or exports and failed compatibility is not retained", async () => {
  const f = graphFixture(),
    artifact = savedDataArtifactFixture("preferences");
  f.reply.mockResolvedValue({ items: [] });
  await f.client.list();
  f.capabilities(["saved-data", "saved-data-schema-2", "account-binding"]);
  await expect(f.client.save(artifact, "0")).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  await expect(f.client.export([artifact.id])).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  expect(
    f.calls.filter((call) => call.path === "/api/v1/capabilities"),
  ).toHaveLength(3);
  expect(f.reply).toHaveBeenCalledOnce();
  f.capabilities(["saved-data", "account-binding"]);
  await expect(f.client.export([artifact.id])).rejects.toMatchObject({
    code: "UNAVAILABLE",
  });
  await expect(f.client.list()).rejects.toMatchObject({ code: "UNAVAILABLE" });
  expect(
    f.calls.filter((call) => call.path === "/api/v1/capabilities"),
  ).toHaveLength(5);
  expect(f.reply).toHaveBeenCalledOnce();
  f.capabilities([...graphCapabilities]);
  await f.client.list();
  await f.client.list();
  expect(
    f.calls.filter((call) => call.path === "/api/v1/capabilities"),
  ).toHaveLength(6);
});

test("an invalid versioned response clears compatibility without retry while an ordinary missing item does not", async () => {
  const f = graphFixture();
  f.reply.mockResolvedValue({ items: [] });
  await f.client.list();
  const invalid = new ServiceClientError(
    "INVALID_RESPONSE",
    200,
    "The namespace response is invalid.",
  );
  f.reply.mockRejectedValueOnce(invalid);
  await expect(f.client.list()).rejects.toBe(invalid);
  expect(
    f.calls.filter((call) => call.path === "/api/v1/capabilities"),
  ).toHaveLength(1);
  expect(f.reply).toHaveBeenCalledTimes(2);
  await f.client.list();
  expect(
    f.calls.filter((call) => call.path === "/api/v1/capabilities"),
  ).toHaveLength(2);
  const missing = new ServiceClientError(
    "NOT_FOUND",
    404,
    "The item is unavailable.",
  );
  f.reply.mockRejectedValueOnce(missing);
  await expect(f.client.read(crypto.randomUUID())).rejects.toBe(missing);
  await f.client.list();
  expect(
    f.calls.filter((call) => call.path === "/api/v1/capabilities"),
  ).toHaveLength(2);
});

test("a late capability response cannot replace the current account epoch's successful proof", async () => {
  const f = graphFixture(),
    discovery = deferred<void>(),
    started = deferred<void>(),
    settled = deferred<void>();
  let discoveries = 0;
  const client = new SavedDataClient({
    ...f.options,
    async request<T>(
      path: `/api/v1/${string}`,
      schema: z.ZodType<T>,
      method: "GET" | "POST" | "PATCH" | "DELETE",
      body: unknown,
      signal: AbortSignal,
      beforeSend?: () => Promise<void>,
    ): Promise<T> {
      if (path === "/api/v1/capabilities" && ++discoveries === 1) {
        started.resolve();
        await discovery.promise;
        try {
          return await f.options.request(
            path,
            schema,
            method,
            body,
            signal,
            beforeSend,
          );
        } finally {
          settled.resolve();
        }
      }
      return f.options.request(path, schema, method, body, signal, beforeSend);
    },
  });
  f.reply.mockResolvedValue({ items: [] });
  const previous = client.list();
  const rejected = expect(previous).rejects.toMatchObject({
    code: "ACCOUNT_CHANGED",
  });
  await started.promise;
  await client.reset();
  f.setScope({
    ...f.scope,
    accountId: crypto.randomUUID(),
    workspaceId: crypto.randomUUID(),
  });
  await rejected;
  await client.list();
  discovery.resolve();
  await settled.promise;
  await client.list();
  expect(discoveries).toBe(2);
  expect(f.reply).toHaveBeenCalledTimes(2);
});

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

test("the graph cache epoch preserves pending v1 operation keys and replays them through the v1 wire", async () => {
  const f = fixture(),
    artifact = savedDataArtifactFixture("preferences");
  f.reply.mockRejectedValueOnce(new Error("offline"));
  await expect(f.client.save(artifact, "0")).rejects.toThrow("offline");
  const pending = (await f.client.cached()).outbox[0];
  f.setScope({ ...f.scope, schemaVersion: 2 });
  f.capabilities([
    "saved-data",
    "saved-data-write",
    "saved-data-schema-2",
    "account-binding",
  ]);
  await expect(f.client.cached()).rejects.toMatchObject({
    code: "ACCOUNT_CHANGED",
  });
  const upgraded = await f.client.cached();
  expect(upgraded.version).toBe(2);
  expect(upgraded.after).toBe("0");
  expect(upgraded.outbox[0].operation.body.idempotencyKey).toBe(
    pending.operation.body.idempotencyKey,
  );
  f.reply
    .mockResolvedValueOnce({ items: [], nextAfter: "0", hasMore: false })
    .mockResolvedValueOnce(savedDataRecordFixture(artifact));
  await f.client.reconcile();
  const attempts = f.calls.filter((call) => call.method === "POST");
  expect(attempts.at(-1)?.path).not.toContain("schemaVersion=2");
  expect(attempts.at(-1)?.body).toEqual(attempts[0].body);
  expect((await f.client.cached()).outbox).toEqual([]);
  expect(
    (await f.store.read({ ...f.scope, schemaVersion: undefined }, () => {}))
      .outbox,
  ).toEqual([pending]);
});

test("an explicitly suspended protocol promotion binds the new cache epoch without a redundant account-change error", async () => {
  const f = fixture();
  await f.client.cached();
  f.client.suspend();
  f.setScope({ ...f.scope, schemaVersion: 2 });
  expect((await f.client.cached()).version).toBe(2);
  expect(f.calls).toEqual([]);
});

test("selective reconciliation sends only the named operation and leaves unrelated approvals pending", async () => {
  const f = fixture(),
    first = savedDataArtifactFixture(),
    second = savedDataArtifactFixture("preferences");
  f.reply
    .mockRejectedValueOnce(new Error("offline"))
    .mockRejectedValueOnce(new Error("offline"));
  await expect(f.client.save(first, "0")).rejects.toThrow("offline");
  await expect(f.client.save(second, "0")).rejects.toThrow("offline");
  const before = await f.client.cached(),
    selected = before.outbox[1].operation.body.idempotencyKey;
  const calls = f.calls.length;
  f.reply.mockResolvedValueOnce(savedDataRecordFixture(second));
  await f.client.reconcile(selected);
  expect(
    f.calls.slice(calls).filter((call) => call.path.includes("sync/changes")),
  ).toEqual([]);
  const writes = f.calls.slice(calls).filter((call) => call.method === "POST");
  expect(writes).toHaveLength(1);
  expect(writes[0].body).toMatchObject({ idempotencyKey: selected });
  expect((await f.client.cached()).outbox).toEqual([before.outbox[0]]);
});

test("explicit site enabling grants the reviewed workspace policy once while reductions never renew consent", async () => {
  const f = fixture();
  f.setScope({ ...f.scope, schemaVersion: 2 });
  f.capabilities([
    "saved-data",
    "saved-data-write",
    "saved-data-schema-2",
    "account-binding",
  ]);
  const origin = "https://example.test",
    id = crypto.randomUUID();
  const enabled = {
    origin,
    revision: "1",
    collect: true,
    use: true,
    updatedAt: new Date().toISOString(),
  };
  f.reply
    .mockResolvedValueOnce({
      origin,
      revision: "0",
      collect: false,
      use: false,
      updatedAt: null,
    })
    .mockResolvedValueOnce({
      workspaceId: f.scope.workspaceId,
      role: "owner",
      allowedActions: ["consents.write"],
      consentPolicies: AUTHORIZATION_CONSENT_POLICIES,
    })
    .mockResolvedValueOnce({
      items: [
        {
          id,
          purpose: "cloud_saved_routes",
          policyVersion: "1",
          granted: false,
          revision: "7",
        },
      ],
    })
    .mockResolvedValueOnce({
      id,
      purpose: "cloud_saved_routes",
      policyVersion: "2",
      granted: true,
      revision: "8",
    })
    .mockResolvedValueOnce(enabled);
  await f.client.updateSiteSettings({
    origin,
    expectedRevision: "0",
    collect: true,
    use: true,
  });
  expect(
    f.calls.find(
      (call) => call.path.endsWith("/consents") && call.method === "POST",
    )?.body,
  ).toEqual({
    purpose: "cloud_saved_routes",
    policyVersion: "2",
    granted: true,
    expectedRevision: "7",
  });
  const before = f.calls.length;
  f.capabilities(["saved-data", "saved-data-schema-2", "account-binding"]);
  f.reply
    .mockResolvedValueOnce(enabled)
    .mockResolvedValueOnce({ ...enabled, revision: "2", collect: false });
  await f.client.updateSiteSettings({
    origin,
    expectedRevision: "1",
    collect: false,
    use: true,
  });
  expect(
    f.calls.slice(before).some((call) => /policies|consents/.test(call.path)),
  ).toBe(false);
  expect(
    f.calls.slice(before).filter((call) => call.method === "PATCH"),
  ).toHaveLength(1);
});

test.each([
  ["abort", "query"],
  ["native-guard", "query"],
  ["abort", "cached-read"],
  ["native-guard", "cached-read"],
] as const)(
  "%s during authentication stops %s transmission at the final send boundary",
  async (mode, route) => {
    const f = fixture();
    f.setScope({ ...f.scope, schemaVersion: 2 });
    f.capabilities([
      "saved-data",
      "saved-data-write",
      "saved-data-schema-2",
      "account-binding",
    ]);
    const authentication = deferred<void>(),
      started = deferred<void>(),
      sent = vi.fn();
    const controller = new AbortController();
    let authorized = true;
    const client = new SavedDataClient({
      ...f.options,
      async request<T>(
        path: `/api/v1/${string}`,
        schema: z.ZodType<T>,
        method: "GET" | "POST" | "PATCH" | "DELETE",
        body: unknown,
        signal: AbortSignal,
        beforeSend?: () => Promise<void>,
      ): Promise<T> {
        if (path === "/api/v1/capabilities" || path.includes("/artifacts?"))
          return f.options.request(path, schema, method, body, signal);
        started.resolve();
        await authentication.promise;
        await beforeSend?.();
        signal.throwIfAborted();
        sent();
        return schema.parse(
          route === "cached-read"
            ? {
                origin: "https://example.test",
                revision: "0",
                collect: false,
                use: false,
                updatedAt: null,
              }
            : {
                context: null,
                sources: [],
                siteSettings: null,
                contextDigest: null,
                snapshotDigest: "a".repeat(64),
                diagnostics: {
                  candidates: 0,
                  selected: 0,
                  omitted: 0,
                  reason: "disabled",
                },
              },
        );
      },
    });
    if (route === "cached-read") {
      f.reply.mockResolvedValueOnce({ items: [] });
      await client.list();
    }
    const execution = {
      signal: controller.signal,
      beforeSend: async () => {
        if (!authorized) throw new Error("The native grant changed.");
      },
    };
    const operation =
      route === "cached-read"
        ? client.siteSettings("https://example.test", execution)
        : client.retrieveKnowledge(
            navigationKnowledgeQuerySchema.parse({
              origin: "https://example.test",
              query: "Find Help",
              controls: [],
            }),
            execution,
          );
    await started.promise;
    if (mode === "abort") {
      controller.abort();
      await expect(operation).rejects.toMatchObject({ name: "AbortError" });
      authentication.resolve();
    } else {
      authorized = false;
      authentication.resolve();
      await expect(operation).rejects.toThrow("native grant changed");
    }
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).not.toHaveBeenCalled();
    expect(
      f.calls.filter((call) => call.path === "/api/v1/capabilities"),
    ).toHaveLength(1);
  },
);

test.each(["save", "reconcile"])(
  "a cancelled learning span fences %s through its final write authentication",
  async (mode) => {
    const f = fixture(),
      artifact = savedDataArtifactFixture();
    let selected: string | undefined;
    if (mode === "reconcile") {
      f.reply.mockRejectedValueOnce(new Error("Unknown server outcome."));
      await expect(f.client.save(artifact, "0")).rejects.toThrow();
      selected = (await f.client.cached()).outbox[0].operation.body
        .idempotencyKey;
    }
    const authentication = deferred<void>(),
      started = deferred<void>(),
      sent = vi.fn();
    const controller = new AbortController();
    const client = new SavedDataClient({
      ...f.options,
      async request<T>(
        path: `/api/v1/${string}`,
        schema: z.ZodType<T>,
        method: "GET" | "POST" | "PATCH" | "DELETE",
        body: unknown,
        signal: AbortSignal,
        beforeSend?: () => Promise<void>,
      ): Promise<T> {
        if (path === "/api/v1/capabilities")
          return f.options.request(path, schema, method, body, signal);
        started.resolve();
        await authentication.promise;
        await beforeSend?.();
        signal.throwIfAborted();
        sent();
        return schema.parse(savedDataRecordFixture(artifact));
      },
    });
    const execution = {
      signal: controller.signal,
      beforeSend: vi.fn(async () => {}),
    };
    const operation =
      mode === "save"
        ? client.save(artifact, "0", undefined, execution)
        : client.reconcile(selected, execution);
    const rejected = expect(operation).rejects.toMatchObject({
      name: "AbortError",
    });
    await started.promise;
    controller.abort();
    await rejected;
    authentication.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(sent).not.toHaveBeenCalled();
    expect((await client.cached()).outbox).toMatchObject([
      { state: "uncertain" },
    ]);
  },
);

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
