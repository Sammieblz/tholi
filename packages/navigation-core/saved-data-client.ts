import { z } from "zod";
import {
  savedDataArtifactSchema,
  savedDataChangesSchema,
  savedDataDeleteInputSchema,
  savedDataExportInputSchema,
  savedDataImportHash,
  savedDataImportItemSchema,
  savedDataImportInputSchema,
  savedDataImportResultSchema,
  savedDataListQuerySchema,
  savedDataMutationSchema,
  savedDataPageSchema,
  savedDataRecordSchema,
  savedDataScopeSchema,
  SAVED_DATA_LIMITS,
  savedDataArtifactV2Schema,
  savedDataRecordV2Schema,
  savedDataMutationV2Schema,
  savedDataImportInputV2Schema,
  savedDataImportResultV2Schema,
  savedDataPageV2Schema,
  savedDataChangesV2Schema,
  savedDataImportHashV2,
  type SavedDataView,
  type SavedDataArtifactV2 as SavedDataArtifact,
  type SavedDataImportInputV2 as SavedDataImportInput,
  type SavedDataRecordV2 as SavedDataRecord,
  type SavedDataScope,
} from "./contracts-saved-data";
import {
  navigationKnowledgeSiteSettingsSchema,
  navigationKnowledgeSiteSettingsInputSchema,
  navigationKnowledgeQuerySchema,
  retrievedNavigationKnowledgeSchema,
  type NavigationKnowledgeSiteSettingsInput,
  type NavigationKnowledgeQuery,
  navigationKnowledgeForgetSiteInputSchema,
  navigationKnowledgeForgetSiteResultSchema,
} from "./contracts-navigation-knowledge";
import { privateFileRequestSchema } from "./contracts-support";
import { serviceOrigin, ServiceClientError } from "./service-client";
import { awaitAbortableOperation } from "./abort";
import {
  AUTHORIZATION_CONSENT_POLICIES,
  policyCatalogSchema,
  consentPageSchema,
  consentSchema,
  consentUpdateSchema,
} from "./contracts-authorization";
import {
  serviceCapabilitiesSchema,
  serviceSyncRevisionSchema,
} from "./contracts-service";

export type SavedDataConnection = SavedDataScope & {
  serviceOrigin: string;
  schemaVersion?: 2;
};
export const savedDataConnectionSchema = savedDataScopeSchema
  .extend({
    serviceOrigin: z.string().transform(serviceOrigin),
    schemaVersion: z.literal(2).optional(),
  })
  .strict();
const localSelectionSchema = z
  .object({
    localKey: z.string().min(1).max(500),
    localRevision: z.string().min(1).max(128),
    artifact: savedDataArtifactV2Schema,
    siteSettingsRevision: z
      .string()
      .regex(/^[1-9][0-9]*$/)
      .optional(),
  })
  .strict();
export type SavedDataLocalSelection = z.infer<typeof localSelectionSchema>;

const operationV1Schema = z.discriminatedUnion("kind", [
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
    operation: operationV1Schema,
    state: z.enum(["pending", "uncertain", "conflict"]),
  })
  .strict();
const operationSchema = z.discriminatedUnion("kind", [
  z
    .object({ kind: z.literal("save"), body: savedDataMutationV2Schema })
    .strict(),
  operationV1Schema.options[1],
  z
    .object({ kind: z.literal("import"), body: savedDataImportInputV2Schema })
    .strict(),
]);
const pendingOperationV2Schema = pendingOperationSchema.extend({
  operation: operationSchema,
  schemaVersion: z.literal(2).optional(),
});
type PendingOperation = z.infer<typeof pendingOperationV2Schema>;

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
export const savedDataClientStateV2Schema = savedDataClientStateSchema.extend({
  version: z.literal(2),
  records: z.array(savedDataRecordV2Schema).max(200),
  outbox: z.array(pendingOperationV2Schema).max(20),
});
export const savedDataClientStateFileSchema = z.union([
  savedDataClientStateSchema,
  savedDataClientStateV2Schema,
]);
export type SavedDataClientState = z.infer<
  typeof savedDataClientStateFileSchema
>;
export const emptySavedDataClientState = (
  view: SavedDataView = 1,
): SavedDataClientState =>
  savedDataClientStateFileSchema.parse({
    version: view,
    records: [],
    outbox: [],
    mappings: [],
    after: "0",
  });
export function savedDataConnectionKey(scope: SavedDataConnection) {
  const parsed = savedDataConnectionSchema.parse(scope);
  return JSON.stringify([
    parsed.schemaVersion ?? 1,
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
    beforeSend?: () => Promise<void>,
  ): Promise<T>;
  store: SavedDataClientStore;
  localRevision?(key: string): Promise<string | undefined>;
}
export interface SavedDataExecution {
  signal?: AbortSignal;
  beforeSend?: () => Promise<void>;
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
  private boundGeneration = 0;
  private readCompatibility?: { generation: number; connection: string };
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
    this.readCompatibility = undefined;
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
          const sameAccount =
            this.bound.serviceOrigin === parsed.serviceOrigin &&
            this.bound.accountId === parsed.accountId &&
            this.bound.workspaceId === parsed.workspaceId;
          if (sameAccount && this.boundGeneration !== this.generation) {
            this.bound = parsed;
          } else if (sameAccount) {
            this.suspend();
            this.bound = parsed;
            this.boundGeneration = this.generation;
            throw this.changed();
          } else {
            await this.reset();
            throw this.changed();
          }
        }
        const expected = this.generation;
        const current = () => {
          if (expected !== this.generation || this.pending.signal.aborted)
            throw this.changed();
        };
        this.bound = parsed;
        this.boundGeneration = expected;
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
  private state(value: unknown) {
    return savedDataClientStateFileSchema.parse(value);
  }
  private view(lease: Lease): SavedDataView {
    return lease.scope.schemaVersion ?? 1;
  }
  private recordSchema(view: SavedDataView): z.ZodType<SavedDataRecord> {
    return view === 2 ? savedDataRecordV2Schema : savedDataRecordSchema;
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
    view: SavedDataView = this.view(lease),
    permissionReduction = false,
    execution?: SavedDataExecution,
  ) {
    const signal = execution?.signal
      ? AbortSignal.any([lease.signal, execution.signal])
      : lease.signal;
    const current = () => {
      lease.current();
      signal.throwIfAborted();
    };
    const beforeSend = execution?.beforeSend
      ? async () => {
          current();
          await execution.beforeSend!();
          current();
        }
      : undefined;
    const interrupted = () =>
      lease.signal.aborted
        ? this.changed()
        : new DOMException("The cloud operation was cancelled.", "AbortError");
    current();
    const revocation =
      permissionReduction ||
      (suffix === "artifacts/site-settings" &&
        method === "PATCH" &&
        !!body &&
        typeof body === "object" &&
        "collect" in body &&
        body.collect === false &&
        "use" in body &&
        body.use === false);
    const capability = revocation
      ? undefined
      : method === "PATCH" ||
          (method === "POST" && suffix !== "artifacts/export")
        ? "saved-data-write"
        : suffix === "artifacts/export"
          ? "saved-data-export"
          : undefined;
    const epoch = {
      generation: this.generation,
      connection: savedDataConnectionKey(lease.scope),
    };
    const compatibleRead = () =>
      this.readCompatibility?.generation === epoch.generation &&
      this.readCompatibility.connection === epoch.connection;
    if (capability || (view === 2 && (method !== "GET" || !compatibleRead()))) {
      let offered: z.infer<typeof serviceCapabilitiesSchema>;
      try {
        offered = await awaitAbortableOperation(
          () =>
            this.options.request(
              "/api/v1/capabilities",
              serviceCapabilitiesSchema,
              "GET",
              undefined,
              signal,
              ...(beforeSend ? ([beforeSend] as const) : ([] as const)),
            ),
          signal,
          interrupted,
        );
        current();
      } catch (error) {
        if (compatibleRead()) this.readCompatibility = undefined;
        throw error;
      }
      const namespaceCompatible =
        offered.capabilities.includes("saved-data-schema-2") &&
        offered.capabilities.includes("account-binding");
      if (!namespaceCompatible && compatibleRead())
        this.readCompatibility = undefined;
      if (
        (capability && !offered.capabilities.includes(capability)) ||
        (view === 2 && !namespaceCompatible) ||
        !offered.capabilities.includes("account-binding")
      )
        throw new ServiceClientError(
          "UNAVAILABLE",
          503,
          "This cloud data operation is unavailable on the connected service.",
        );
      // This is only public protocol compatibility, never cached authorization.
      // Every mutation discovers its current feature, and every actual request
      // retains the existing account, host, consent and final send checks.
      if (view === 2) this.readCompatibility = epoch;
    }
    let result: T;
    try {
      result = await awaitAbortableOperation(
        () =>
          this.options.request(
            this.path(
              lease,
              view === 2
                ? `${suffix}${suffix.includes("?") ? "&" : "?"}schemaVersion=2`
                : suffix,
            ),
            schema,
            method,
            body,
            signal,
            ...(beforeSend ? ([beforeSend] as const) : ([] as const)),
          ),
        signal,
        interrupted,
      );
    } catch (error) {
      if (
        view === 2 &&
        compatibleRead() &&
        error instanceof ServiceClientError &&
        ["INVALID_RESPONSE", "COMPATIBILITY_MISMATCH"].includes(error.code)
      )
        this.readCompatibility = undefined;
      throw error;
    }
    current();
    return result;
  }
  private merge(state: SavedDataClientState, records: SavedDataRecord[]) {
    const existing = new Map<string, SavedDataRecord>(
      state.records.map((record) => [record.id, record]),
    );
    for (const raw of records) {
      const record = (
          state.version === 2 ? savedDataRecordV2Schema : savedDataRecordSchema
        ).parse(raw),
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
    return this.state({ ...state, records: retained });
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
  async list(
    raw: unknown = {},
    search = false,
    execution?: SavedDataExecution,
  ) {
    const lease = await this.lease(),
      query = savedDataListQuerySchema.parse(raw);
    const parameters = new URLSearchParams();
    for (const [key, value] of Object.entries(query))
      if (value !== undefined) parameters.set(key, String(value));
    const page = await this.request(
      lease,
      `artifacts${search ? "/search" : ""}?${parameters}`,
      this.view(lease) === 2 ? savedDataPageV2Schema : savedDataPageSchema,
      "GET",
      undefined,
      this.view(lease),
      false,
      execution,
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
        this.recordSchema(this.view(lease)),
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
      const mappedRecord =
        mapped && state.records.find((record) => record.id === mapped.id);
      const id =
        mapped &&
        (!mappedRecord ||
          mappedRecord.schemaVersion === item.artifact.schemaVersion)
          ? mapped.id
          : crypto.randomUUID();
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
        artifact:
          this.view(lease) === 2
            ? { ...item.artifact, id }
            : savedDataArtifactSchema.parse({ ...item.artifact, id }),
        ...(item.siteSettingsRevision
          ? { siteSettingsRevision: item.siteSettingsRevision }
          : {}),
      };
    });
    const hash = await (this.view(lease) === 2
      ? savedDataImportHashV2(artifactScope(lease.scope), items)
      : savedDataImportHash(
          artifactScope(lease.scope),
          z.array(savedDataImportItemSchema).parse(items),
        ));
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
      (await (this.view(lease) === 2
        ? savedDataImportHashV2(artifactScope(lease.scope), preview.items)
        : savedDataImportHash(
            artifactScope(lease.scope),
            z.array(savedDataImportItemSchema).parse(preview.items),
          ))) !== hash
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
    const body = (
      this.view(lease) === 2
        ? savedDataImportInputV2Schema
        : savedDataImportInputSchema
    ).parse({
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
        return this.state({
          ...state,
          mappings: [...mappings].map(([localKey, id]) => ({ localKey, id })),
          outbox: [
            ...state.outbox,
            {
              operation: { kind: "import", body },
              state: "pending",
              ...(this.view(lease) === 2 ? { schemaVersion: 2 } : {}),
            },
          ],
        });
      },
      lease.current,
    );
    await this.send(lease, { kind: "import", body });
    return body.idempotencyKey;
  }
  async save(
    artifact: SavedDataArtifact,
    expectedRevision: string,
    siteSettingsRevision?: string,
    execution?: SavedDataExecution,
  ) {
    const lease = await this.lease(),
      body = (
        this.view(lease) === 2
          ? savedDataMutationV2Schema
          : savedDataMutationSchema
      ).parse({
        idempotencyKey: crypto.randomUUID(),
        expectedRevision,
        approved: true,
        artifact,
        ...(siteSettingsRevision ? { siteSettingsRevision } : {}),
      });
    await this.enqueue(lease, { kind: "save", body }, execution);
    await this.send(lease, { kind: "save", body }, this.view(lease), execution);
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
  private enqueue(
    lease: Lease,
    operation: PendingOperation["operation"],
    execution?: SavedDataExecution,
  ) {
    return this.options.store.update(
      lease.scope,
      (state) =>
        this.state({
          ...state,
          outbox: [
            ...state.outbox,
            {
              operation,
              state: "pending",
              ...(this.view(lease) === 2 ? { schemaVersion: 2 } : {}),
            },
          ],
        }),
      () => {
        lease.current();
        execution?.signal?.throwIfAborted();
      },
    );
  }
  private async send(
    lease: Lease,
    operation: PendingOperation["operation"],
    view: SavedDataView = this.view(lease),
    execution?: SavedDataExecution,
  ) {
    try {
      let records: SavedDataRecord[];
      if (operation.kind === "import")
        records = (
          await this.request(
            lease,
            "sync/import",
            view === 2
              ? savedDataImportResultV2Schema
              : savedDataImportResultSchema,
            "POST",
            operation.body,
            view,
            false,
            execution,
          )
        ).items;
      else if (operation.kind === "delete")
        records = [
          await this.request(
            lease,
            `artifacts/${operation.id}`,
            this.recordSchema(view),
            "DELETE",
            operation.body,
            view,
            false,
            execution,
          ),
        ];
      else
        records = [
          await this.request(
            lease,
            operation.body.expectedRevision === "0"
              ? "artifacts"
              : `artifacts/${operation.body.artifact.id}`,
            this.recordSchema(view),
            operation.body.expectedRevision === "0" ? "POST" : "PATCH",
            operation.body,
            view,
            false,
            execution,
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
            this.state({
              ...state,
              outbox: state.outbox.filter(
                (entry) =>
                  operationId(entry.operation) !== operationId(operation),
              ),
            }),
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
        (state) =>
          this.state({
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
  private async replay(
    lease: Lease,
    state: SavedDataClientState,
    entry: PendingOperation,
    execution?: SavedDataExecution,
  ) {
    if (entry.state === "conflict") return;
    const deleted = state.records.some(
      (record) =>
        record.deletedAt &&
        savedDataOperationIds(entry.operation).includes(record.id),
    );
    if (deleted) {
      await this.options.store.update(
        lease.scope,
        (latest) =>
          this.state({
            ...latest,
            outbox: latest.outbox.map((candidate) =>
              operationId(candidate.operation) === operationId(entry.operation)
                ? { ...candidate, state: "conflict" }
                : candidate,
            ),
          }),
        lease.current,
      );
      return;
    }
    await this.send(
      lease,
      entry.operation,
      "schemaVersion" in entry ? (entry.schemaVersion ?? 1) : 1,
      execution,
    );
  }
  async reconcile(
    selectedOperationId?: string,
    execution?: SavedDataExecution,
  ) {
    execution?.signal?.throwIfAborted();
    if (this.flushing) return this.flushing;
    const work = (async () => {
      const lease = await this.lease();
      if (selectedOperationId) {
        const state = await this.options.store.read(lease.scope, lease.current);
        const selected = state.outbox.find(
          (entry) => operationId(entry.operation) === selectedOperationId,
        );
        if (selected) await this.replay(lease, state, selected, execution);
        return;
      }
      for (let page = 0; page < 10; page++) {
        const state = await this.options.store.read(lease.scope, lease.current);
        const changes = await this.request(
          lease,
          `sync/changes?after=${state.after}&limit=100`,
          this.view(lease) === 2
            ? savedDataChangesV2Schema
            : savedDataChangesSchema,
          "GET",
          undefined,
          this.view(lease),
          false,
          execution,
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
        for (const entry of ready.outbox)
          await this.replay(lease, ready, entry, execution);
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
      (state) =>
        this.state({
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
  async siteSettings(origin: string, execution?: SavedDataExecution) {
    const lease = await this.lease();
    if (this.view(lease) !== 2)
      throw new ServiceClientError(
        "UNAVAILABLE",
        503,
        "Private memory requires saved-data schema version 2.",
      );
    return this.request(
      lease,
      `artifacts/site-settings?origin=${encodeURIComponent(origin)}`,
      navigationKnowledgeSiteSettingsSchema,
      "GET",
      undefined,
      2,
      false,
      execution,
    );
  }
  async updateSiteSettings(
    input: Omit<
      NavigationKnowledgeSiteSettingsInput,
      "idempotencyKey" | "approved"
    >,
  ) {
    const lease = await this.lease();
    if (this.view(lease) !== 2)
      throw new ServiceClientError(
        "UNAVAILABLE",
        503,
        "Private memory requires saved-data schema version 2.",
      );
    const current =
      input.collect || input.use
        ? await this.request(
            lease,
            `artifacts/site-settings?origin=${encodeURIComponent(input.origin)}`,
            navigationKnowledgeSiteSettingsSchema,
          )
        : undefined;
    if (current && current.revision !== input.expectedRevision)
      throw new ServiceClientError(
        "CONFLICT",
        409,
        "The site memory choice changed. Review it again.",
      );
    const enabling = !!(
      (input.collect && !current?.collect) ||
      (input.use && !current?.use)
    );
    if (enabling) {
      const policies = await this.request(
        lease,
        "policies",
        policyCatalogSchema,
        "GET",
        undefined,
        1,
      );
      const consents = await this.request(
        lease,
        "consents",
        consentPageSchema,
        "GET",
        undefined,
        1,
      );
      const supported = AUTHORIZATION_CONSENT_POLICIES.find(
        (policy) => policy.purpose === "cloud_saved_routes",
      )!;
      const policy = policies.consentPolicies.find(
        (policy) => policy.purpose === supported.purpose,
      );
      if (
        policies.workspaceId !== lease.scope.workspaceId ||
        !policy ||
        policy.policyVersion !== supported.policyVersion
      )
        throw new ServiceClientError(
          "UNAVAILABLE",
          503,
          "The saved-data policy is unavailable or needs a new review.",
        );
      const prior = consents.items.find(
        (consent) => consent.purpose === policy.purpose,
      );
      if (!prior?.granted || prior.policyVersion !== policy.policyVersion) {
        if (!policies.allowedActions.includes("consents.write"))
          throw new ServiceClientError(
            "FORBIDDEN",
            403,
            "This account cannot grant saved-data permission.",
          );
        await this.request(
          lease,
          "consents",
          consentSchema,
          "POST",
          consentUpdateSchema.parse({
            purpose: policy.purpose,
            policyVersion: policy.policyVersion,
            granted: true,
            expectedRevision: prior?.revision ?? "0",
          }),
          1,
        );
      }
    }
    return this.request(
      lease,
      "artifacts/site-settings",
      navigationKnowledgeSiteSettingsSchema,
      "PATCH",
      navigationKnowledgeSiteSettingsInputSchema.parse({
        ...input,
        idempotencyKey: crypto.randomUUID(),
        approved: true,
      }),
      2,
      !enabling,
    );
  }
  async forgetSite(
    origin: string,
    expectedRevision: string,
    idempotencyKey: string = crypto.randomUUID(),
  ) {
    const lease = await this.lease();
    if (this.view(lease) !== 2)
      throw new ServiceClientError(
        "UNAVAILABLE",
        503,
        "Private memory requires saved-data schema version 2.",
      );
    const result = await this.request(
      lease,
      "artifacts/site-settings",
      navigationKnowledgeForgetSiteResultSchema,
      "DELETE",
      navigationKnowledgeForgetSiteInputSchema.parse({
        origin,
        expectedRevision,
        idempotencyKey,
        approved: true,
      }),
    );
    const deleted = new Set(result.deletedIds);
    await this.options.store.update(
      lease.scope,
      (state) =>
        this.state({
          ...state,
          records: state.records.filter((record) => !deleted.has(record.id)),
          outbox: state.outbox.map((entry) =>
            savedDataOperationIds(entry.operation).some((id) => deleted.has(id))
              ? { ...entry, state: "conflict" }
              : entry,
          ),
        }),
      lease.current,
    );
    return result;
  }
  async retrieveKnowledge(
    query: NavigationKnowledgeQuery,
    execution?: SavedDataExecution,
  ) {
    const lease = await this.lease();
    if (this.view(lease) !== 2)
      throw new ServiceClientError(
        "UNAVAILABLE",
        503,
        "Private memory requires saved-data schema version 2.",
      );
    return this.request(
      lease,
      "artifacts/navigation-knowledge",
      retrievedNavigationKnowledgeSchema,
      "POST",
      navigationKnowledgeQuerySchema.parse(query),
      this.view(lease),
      false,
      execution,
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
