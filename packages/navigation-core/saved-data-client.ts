import { z } from "zod";
import {
  savedDataArtifactSchema,
  savedDataChangesSchema,
  savedDataDeleteInputSchema,
  savedDataExportInputSchema,
  savedDataImportHash,
  savedDataImportInputSchema,
  savedDataImportResultSchema,
  savedDataListQuerySchema,
  savedDataMutationSchema,
  savedDataPageSchema,
  savedDataRecordSchema,
  savedDataScopeSchema,
  SAVED_DATA_LIMITS,
  type SavedDataArtifact,
  type SavedDataImportInput,
  type SavedDataRecord,
  type SavedDataScope,
} from "./contracts-saved-data";
import { privateFileRequestSchema } from "./contracts-support";
import { serviceOrigin, ServiceClientError } from "./service-client";
import {
  serviceCapabilitiesSchema,
  serviceSyncRevisionSchema,
} from "./contracts-service";

export type SavedDataConnection = SavedDataScope & { serviceOrigin: string };
export const savedDataConnectionSchema = savedDataScopeSchema
  .extend({ serviceOrigin: z.string().transform(serviceOrigin) })
  .strict();
const localSelectionSchema = z
  .object({
    localKey: z.string().min(1).max(500),
    localRevision: z.string().min(1).max(128),
    artifact: savedDataArtifactSchema,
  })
  .strict();
export type SavedDataLocalSelection = z.infer<typeof localSelectionSchema>;

const operationSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("save"), body: savedDataMutationSchema }).strict(),
  z
    .object({
      kind: z.literal("delete"),
      id: z.string().uuid(),
      body: savedDataDeleteInputSchema,
    })
    .strict(),
  z
    .object({ kind: z.literal("import"), body: savedDataImportInputSchema })
    .strict(),
]);
const pendingOperationSchema = z
  .object({
    operation: operationSchema,
    state: z.enum(["pending", "uncertain", "conflict"]),
  })
  .strict();
type PendingOperation = z.infer<typeof pendingOperationSchema>;

/** Private client state contains only approved DTOs, never credentials or raw local source. */
export const savedDataClientStateSchema = z
  .object({
    version: z.literal(1),
    records: z.array(savedDataRecordSchema).max(200),
    outbox: z.array(pendingOperationSchema).max(20),
    mappings: z
      .array(
        z
          .object({ localKey: z.string().max(500), id: z.string().uuid() })
          .strict(),
      )
      .max(200),
    after: serviceSyncRevisionSchema,
  })
  .strict();
export type SavedDataClientState = z.infer<typeof savedDataClientStateSchema>;
export const emptySavedDataClientState = (): SavedDataClientState => ({
  version: 1,
  records: [],
  outbox: [],
  mappings: [],
  after: "0",
});
export function savedDataConnectionKey(scope: SavedDataConnection) {
  const parsed = savedDataConnectionSchema.parse(scope);
  return JSON.stringify([
    1,
    parsed.serviceOrigin,
    parsed.accountId,
    parsed.workspaceId,
  ]);
}

export interface SavedDataClientStore {
  read(
    scope: SavedDataConnection,
    current: () => void,
  ): Promise<SavedDataClientState>;
  update(
    scope: SavedDataConnection,
    change: (state: SavedDataClientState) => SavedDataClientState,
    current: () => void,
  ): Promise<SavedDataClientState>;
  clear(scope: SavedDataConnection): Promise<void>;
}
export interface SavedDataClientOptions {
  connection(): Promise<SavedDataConnection | undefined>;
  request<T>(
    path: `/api/v1/${string}`,
    schema: z.ZodType<T>,
    method: "GET" | "POST" | "PATCH" | "DELETE",
    body: unknown,
    signal: AbortSignal,
  ): Promise<T>;
  store: SavedDataClientStore;
  localRevision?(key: string): Promise<string | undefined>;
}
export const savedDataClientErrorCodeSchema = z.enum([
  "ACCOUNT_CHANGED",
  "SIGN_IN_REQUIRED",
  "PREVIEW_CHANGED",
  "CONFLICT",
  "CACHE_LIMIT",
  "INVALID_ROUTE",
]);
export class SavedDataClientError extends Error {
  constructor(
    readonly code: z.infer<typeof savedDataClientErrorCodeSchema>,
    message: string,
  ) {
    super(message);
    this.name = "SavedDataClientError";
  }
}
interface Lease {
  scope: SavedDataConnection;
  signal: AbortSignal;
  current(): void;
}
interface ImportPreview {
  hash: string;
  scope: SavedDataConnection;
  expiresAt: number;
  items: SavedDataImportInput["items"];
  sources: { localKey: string; localRevision: string; id: string }[];
  localRevision?: SavedDataClientOptions["localRevision"];
}
const operationId = (operation: PendingOperation["operation"]) =>
  operation.body.idempotencyKey;
const artifactScope = (connection: SavedDataConnection): SavedDataScope => ({
  accountId: connection.accountId,
  workspaceId: connection.workspaceId,
});
export const savedDataOperationIds = (
  operation: PendingOperation["operation"],
) =>
  operation.kind === "import"
    ? operation.body.items.map((item) => item.artifact.id)
    : [operation.kind === "save" ? operation.body.artifact.id : operation.id];

/** One opt-in data client. It has no browser session, journey or inference capability. */
export class SavedDataClient {
  private generation = 0;
  private pending = new AbortController();
  private bound?: SavedDataConnection;
  private preview?: ImportPreview;
  private clearing = Promise.resolve();
  private binding = Promise.resolve();
  private flushing?: Promise<void>;
  constructor(private readonly options: SavedDataClientOptions) {}

  suspend() {
    this.generation++;
    this.pending.abort();
    this.pending = new AbortController();
    this.preview = undefined;
    this.flushing = undefined;
    this.binding = Promise.resolve();
  }
  reset(
    previous?: SavedDataConnection | Promise<SavedDataConnection | undefined>,
  ) {
    const scope = Promise.resolve(previous ?? this.bound);
    this.suspend();
    this.bound = undefined;
    void scope.catch(() => {});
    this.clearing = this.clearing
      .catch(() => {})
      .then(async () => {
        const known = await scope;
        if (known) await this.options.store.clear(known);
      });
    void this.clearing.catch(() => {});
    return this.clearing;
  }

  private async lease(): Promise<Lease> {
    const requestedGeneration = this.generation;
    let lease!: Lease;
    const setup = this.binding
      .catch(() => {})
      .then(async () => {
        await this.clearing;
        if (requestedGeneration !== this.generation) throw this.changed();
        const scope = await this.options.connection();
        if (requestedGeneration !== this.generation) throw this.changed();
        if (!scope)
          throw new SavedDataClientError(
            "SIGN_IN_REQUIRED",
            "Sign in to view cloud-saved data.",
          );
        const parsed = savedDataConnectionSchema.parse(scope);
        if (
          this.bound &&
          savedDataConnectionKey(this.bound) !== savedDataConnectionKey(parsed)
        ) {
          await this.reset();
          throw this.changed();
        }
        const expected = this.generation;
        const current = () => {
          if (expected !== this.generation || this.pending.signal.aborted)
            throw this.changed();
        };
        this.bound = parsed;
        current();
        lease = { scope: parsed, signal: this.pending.signal, current };
      });
    this.binding = setup;
    await setup;
    return lease;
  }
  private changed() {
    return new SavedDataClientError(
      "ACCOUNT_CHANGED",
      "The account changed. Open cloud-saved data again.",
    );
  }
  private path(lease: Lease, suffix: string): `/api/v1/${string}` {
    return `/api/v1/workspaces/${lease.scope.workspaceId}/${suffix}`;
  }
  private async request<T>(
    lease: Lease,
    suffix: string,
    schema: z.ZodType<T>,
    method: "GET" | "POST" | "PATCH" | "DELETE" = "GET",
    body?: unknown,
  ) {
    lease.current();
    const capability =
      method === "PATCH" || (method === "POST" && suffix !== "artifacts/export")
        ? "saved-data-write"
        : suffix === "artifacts/export"
          ? "saved-data-export"
          : undefined;
    if (capability) {
      const offered = await this.options.request(
        "/api/v1/capabilities",
        serviceCapabilitiesSchema,
        "GET",
        undefined,
        lease.signal,
      );
      lease.current();
      if (
        !offered.capabilities.includes(capability) ||
        !offered.capabilities.includes("account-binding")
      )
        throw new ServiceClientError(
          "UNAVAILABLE",
          503,
          "This cloud data operation is unavailable on the connected service.",
        );
    }
    const result = await this.options.request(
      this.path(lease, suffix),
      schema,
      method,
      body,
      lease.signal,
    );
    lease.current();
    return result;
  }
  private merge(state: SavedDataClientState, records: SavedDataRecord[]) {
    const existing = new Map(
      state.records.map((record) => [record.id, record]),
    );
    for (const raw of records) {
      const record = savedDataRecordSchema.parse(raw),
        previous = existing.get(record.id);
      if (previous && BigInt(previous.revision) > BigInt(record.revision))
        continue;
      if (previous?.deletedAt && !record.deletedAt) continue;
      existing.set(record.id, record);
    }
    const ordered = [...existing.values()].sort((a, b) =>
      BigInt(a.syncRevision) < BigInt(b.syncRevision) ? 1 : -1,
    );
    const protectedIds = new Set(
      state.outbox.flatMap((entry) => savedDataOperationIds(entry.operation)),
    );
    const retained = ordered.filter(
      (record, index) => index < 200 || protectedIds.has(record.id),
    );
    if (retained.length > 200)
      throw new SavedDataClientError(
        "CACHE_LIMIT",
        "Reconcile pending cloud changes before loading more records.",
      );
    return savedDataClientStateSchema.parse({ ...state, records: retained });
  }
  private async cache(lease: Lease, records: SavedDataRecord[]) {
    return this.options.store.update(
      lease.scope,
      (state) => this.merge(state, records),
      lease.current,
    );
  }
  async cached() {
    const lease = await this.lease();
    return this.options.store.read(lease.scope, lease.current);
  }
  async list(raw: unknown = {}, search = false) {
    const lease = await this.lease(),
      query = savedDataListQuerySchema.parse(raw);
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) parameters.set(key, String(value));
    const page = await this.request(
      lease,
      `artifacts${search ? "/search" : ""}?${parameters}`,
      savedDataPageSchema,
    );
    const cached = await this.cache(lease, page.items);
    return {
      ...page,
      items: page.items
        .map(
          (record) =>
            cached.records.find((entry) => entry.id === record.id) ?? record,
        )
        .filter((record) => !record.deletedAt),
    };
  }
  async read(id: string) {
    const lease = await this.lease(),
      record = await this.request(
        lease,
        `artifacts/${z.string().uuid().parse(id)}`,
        savedDataRecordSchema,
      );
    if (record.id !== id)
      throw new ServiceClientError(
        "INVALID_RESPONSE",
        0,
        "The cloud record does not match the requested item.",
      );
    const cached = await this.cache(lease, [record]);
    return cached.records.find((entry) => entry.id === record.id) ?? record;
  }
  async previewImport(
    raw: SavedDataLocalSelection[],
    localRevision = this.options.localRevision,
  ) {
    const lease = await this.lease(),
      selected = z
        .array(localSelectionSchema)
        .min(1)
        .max(SAVED_DATA_LIMITS.importItems)
        .parse(raw);
    if (new Set(selected.map((item) => item.localKey)).size !== selected.length)
      throw new SavedDataClientError(
        "PREVIEW_CHANGED",
        "Select each local item once.",
      );
    const state = await this.options.store.read(lease.scope, lease.current);
    const sources: ImportPreview["sources"] = [];
    const items = selected.map((item) => {
      const mapped = state.mappings.find(
        (entry) => entry.localKey === item.localKey,
      );
      const id = mapped?.id ?? crypto.randomUUID();
      const current = state.records.find((record) => record.id === id);
      if (current?.deletedAt)
        throw new SavedDataClientError(
          "CONFLICT",
          "This cloud item was deleted. Choose an explicit new copy to save it again.",
        );
      sources.push({
        localKey: item.localKey,
        localRevision: item.localRevision,
        id,
      });
      return {
        expectedRevision: current?.revision ?? "0",
        artifact: { ...item.artifact, id },
      };
    });
    const hash = await savedDataImportHash(artifactScope(lease.scope), items);
    lease.current();
    this.preview = {
      hash,
      scope: lease.scope,
      expiresAt: Date.now() + 300000,
      items,
      sources,
      localRevision,
    };
    return structuredClone({ hash, expiresAt: this.preview.expiresAt, items });
  }
  async confirmImport(hash: string) {
    const lease = await this.lease(),
      preview = this.preview;
    if (
      !preview ||
      hash !== preview.hash ||
      Date.now() >= preview.expiresAt ||
      savedDataConnectionKey(preview.scope) !==
        savedDataConnectionKey(lease.scope)
    )
      throw new SavedDataClientError(
        "PREVIEW_CHANGED",
        "Preview the selected local data again before importing.",
      );
    if (!preview.localRevision)
      throw new SavedDataClientError(
        "PREVIEW_CHANGED",
        "The local source cannot be verified. Preview it again.",
      );
    for (const source of preview.sources) {
      const revision = await preview.localRevision(source.localKey);
      lease.current();
      if (revision !== source.localRevision)
        throw new SavedDataClientError(
          "PREVIEW_CHANGED",
          "Local data changed. Review a fresh import preview.",
        );
    }
    if (
      (await savedDataImportHash(artifactScope(lease.scope), preview.items)) !==
      hash
    )
      throw new SavedDataClientError(
        "PREVIEW_CHANGED",
        "The import preview changed.",
      );
    lease.current();
    if (this.preview !== preview)
      throw new SavedDataClientError(
        "PREVIEW_CHANGED",
        "This preview was already used. Review the pending import instead.",
      );
    this.preview = undefined;
    const body = savedDataImportInputSchema.parse({
      idempotencyKey: crypto.randomUUID(),
      approved: true,
      previewHash: hash,
      items: preview.items,
    });
    await this.options.store.update(
      lease.scope,
      (state) => {
        const mappings = new Map(
          state.mappings.map((entry) => [entry.localKey, entry.id]),
        );
        for (const source of preview.sources)
          mappings.set(source.localKey, source.id);
        return savedDataClientStateSchema.parse({
          ...state,
          mappings: [...mappings].map(([localKey, id]) => ({ localKey, id })),
          outbox: [
            ...state.outbox,
            { operation: { kind: "import", body }, state: "pending" },
          ],
        });
      },
      lease.current,
    );
    await this.send(lease, { kind: "import", body });
    return body.idempotencyKey;
  }
  async save(artifact: SavedDataArtifact, expectedRevision: string) {
    const lease = await this.lease(),
      body = savedDataMutationSchema.parse({
        idempotencyKey: crypto.randomUUID(),
        expectedRevision,
        approved: true,
        artifact,
      });
    await this.enqueue(lease, { kind: "save", body });
    await this.send(lease, { kind: "save", body });
    return body.idempotencyKey;
  }
  async remove(id: string, expectedRevision: string) {
    const lease = await this.lease(),
      body = savedDataDeleteInputSchema.parse({
        idempotencyKey: crypto.randomUUID(),
        expectedRevision,
        approved: true,
      });
    const operation = operationSchema.parse({ kind: "delete", id, body });
    await this.enqueue(lease, operation);
    await this.send(lease, operation);
    return body.idempotencyKey;
  }
  private enqueue(lease: Lease, operation: PendingOperation["operation"]) {
    return this.options.store.update(
      lease.scope,
      (state) =>
        savedDataClientStateSchema.parse({
          ...state,
          outbox: [...state.outbox, { operation, state: "pending" }],
        }),
      lease.current,
    );
  }
  private async send(lease: Lease, operation: PendingOperation["operation"]) {
    try {
      let records: SavedDataRecord[];
      if (operation.kind === "import")
        records = (
          await this.request(
            lease,
            "sync/import",
            savedDataImportResultSchema,
            "POST",
            operation.body,
          )
        ).items;
      else if (operation.kind === "delete")
        records = [
          await this.request(
            lease,
            `artifacts/${operation.id}`,
            savedDataRecordSchema,
            "DELETE",
            operation.body,
          ),
        ];
      else
        records = [
          await this.request(
            lease,
            operation.body.expectedRevision === "0"
              ? "artifacts"
              : `artifacts/${operation.body.artifact.id}`,
            savedDataRecordSchema,
            operation.body.expectedRevision === "0" ? "POST" : "PATCH",
            operation.body,
          ),
        ];
      const expected = savedDataOperationIds(operation);
      const bases = new Map<string, string>(
        operation.kind === "import"
          ? operation.body.items.map((item) => [
              item.artifact.id,
              item.expectedRevision,
            ])
          : [
              [
                operation.kind === "save"
                  ? operation.body.artifact.id
                  : operation.id,
                operation.body.expectedRevision,
              ],
            ],
      );
      if (
        records.length !== expected.length ||
        new Set(records.map((record) => record.id)).size !== expected.length ||
        records.some(
          (record) =>
            !expected.includes(record.id) ||
            BigInt(record.revision) <= BigInt(bases.get(record.id)!) ||
            (operation.kind === "delete" && !record.deletedAt),
        )
      )
        throw new ServiceClientError(
          "INVALID_RESPONSE",
          0,
          "The cloud response did not acknowledge every selected item.",
        );
      await this.options.store.update(
        lease.scope,
        (state) =>
          this.merge(
            {
              ...state,
              outbox: state.outbox.filter(
                (entry) =>
                  operationId(entry.operation) !== operationId(operation),
              ),
            },
            records,
          ),
        lease.current,
      );
    } catch (error) {
      lease.current();
      const conflict =
        error instanceof ServiceClientError &&
        [404, 409].includes(error.status);
      await this.options.store.update(
        lease.scope,
        (state) => ({
          ...state,
          outbox: state.outbox.map((entry) =>
            operationId(entry.operation) === operationId(operation)
              ? { ...entry, state: conflict ? "conflict" : "uncertain" }
              : entry,
          ),
        }),
        lease.current,
      );
      throw error;
    }
  }
  async reconcile() {
    if (this.flushing) return this.flushing;
    const work = (async () => {
      const lease = await this.lease();
      for (let page = 0; page < 10; page++) {
        const state = await this.options.store.read(lease.scope, lease.current);
        const changes = await this.request(
          lease,
          `sync/changes?after=${state.after}&limit=100`,
          savedDataChangesSchema,
        );
        if (
          BigInt(changes.nextAfter) < BigInt(state.after) ||
          (changes.hasMore && changes.nextAfter === state.after) ||
          changes.items.some(
            (record) => BigInt(record.syncRevision) > BigInt(changes.nextAfter),
          )
        )
          throw new ServiceClientError(
            "INVALID_RESPONSE",
            0,
            "The cloud change cursor is inconsistent.",
          );
        await this.options.store.update(
          lease.scope,
          (latest) => ({
            ...this.merge(latest, changes.items),
            after: changes.nextAfter,
          }),
          lease.current,
        );
        if (changes.hasMore) {
          if (page === 9) return;
          continue;
        }
        const ready = await this.options.store.read(lease.scope, lease.current);
        for (const entry of ready.outbox) {
          if (entry.state === "conflict") continue;
          const deleted = ready.records.some(
            (record) =>
              record.deletedAt &&
              savedDataOperationIds(entry.operation).includes(record.id),
          );
          if (deleted) {
            await this.options.store.update(
              lease.scope,
              (latest) => ({
                ...latest,
                outbox: latest.outbox.map((candidate) =>
                  operationId(candidate.operation) ===
                  operationId(entry.operation)
                    ? { ...candidate, state: "conflict" }
                    : candidate,
                ),
              }),
              lease.current,
            );
            continue;
          }
          await this.send(lease, entry.operation);
        }
        return;
      }
    })();
    this.flushing = work;
    try {
      await work;
    } finally {
      if (this.flushing === work) this.flushing = undefined;
    }
  }
  async discardConflict(id: string) {
    const lease = await this.lease();
    await this.options.store.update(
      lease.scope,
      (state) => ({
        ...state,
        outbox: state.outbox.filter(
          (entry) =>
            operationId(entry.operation) !== id || entry.state !== "conflict",
        ),
      }),
      lease.current,
    );
  }
  async export(ids: string[]) {
    const lease = await this.lease();
    return this.request(
      lease,
      "artifacts/export",
      privateFileRequestSchema,
      "POST",
      savedDataExportInputSchema.parse({
        idempotencyKey: crypto.randomUUID(),
        ids,
      }),
    );
  }
  async routeIntent(id: string) {
    const record = await this.read(id);
    if (record.deletedAt || record.kind !== "saved_route" || !record.data)
      throw new SavedDataClientError(
        "INVALID_ROUTE",
        "Choose an available saved route.",
      );
    const artifact = savedDataArtifactSchema.parse({
      id: record.id,
      schemaVersion: record.schemaVersion,
      kind: record.kind,
      data: record.data,
      metadata: record.metadata,
    });
    if (artifact.kind !== "saved_route")
      throw new SavedDataClientError("INVALID_ROUTE", "Choose a saved route.");
    return { origin: artifact.data.origin, goal: artifact.data.goal };
  }
}
