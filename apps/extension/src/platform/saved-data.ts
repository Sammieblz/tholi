import { z } from "zod";
import {
  savedDataArtifactSchema,
  savedDataImportHash,
  savedDataListQuerySchema,
  savedDataMetadataSchema,
  savedDataScopeSchema,
  SAVED_DATA_LIMITS,
} from "../../../../packages/navigation-core/contracts-saved-data";
import {
  serviceExpectedRevisionSchema,
  servicePayloadHashSchema,
  serviceRevisionSchema,
} from "../../../../packages/navigation-core/contracts-service";
import {
  SavedDataClient,
  type SavedDataLocalSelection,
} from "../../../../packages/navigation-core/saved-data-client";
import {
  projectSavedDataArtifact,
  type SavedDataSource,
} from "../../../../packages/navigation-core/saved-data-privacy";
import { IndexedDBCloudDataStore } from "../../../../packages/site-memory/cloud-data";
import { IndexedDBSiteMemory } from "../../../../packages/site-memory";
import { api } from "./api";
import {
  onServiceAccountChange,
  serviceAccountConnection,
  serviceAuthorizedRequest,
} from "./service-auth";
import { hasBackendAccess } from "./site-access";
import { ServiceClientError } from "../../../../packages/navigation-core/service-client";

const websiteOrigin = z
  .string()
  .url()
  .max(300)
  .refine((value) => {
    const url = new URL(value);
    return ["http:", "https:"].includes(url.protocol) && url.origin === value;
  });
const selectionSchema = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("saved_route"),
      origin: websiteOrigin,
      id: z.string().min(1).max(100),
      metadata: savedDataMetadataSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("site_knowledge"),
      origin: websiteOrigin,
      metadata: savedDataMetadataSchema,
    })
    .strict(),
  z
    .object({
      kind: z.literal("conversation_excerpt"),
      ids: z
        .array(z.string().min(1).max(1200))
        .min(1)
        .max(SAVED_DATA_LIMITS.conversationMessages),
      metadata: savedDataMetadataSchema,
    })
    .strict(),
]);
type LocalSelection = z.infer<typeof selectionSchema>;
const scoped = <S extends z.ZodRawShape>(shape: S) =>
  z.object({ scope: savedDataScopeSchema, ...shape }).strict();
const commandSchema = z.discriminatedUnion("type", [
  scoped({
    type: z.literal("SAVED_DATA_LIST"),
    query: savedDataListQuerySchema.optional(),
    search: z.boolean().optional(),
  }),
  scoped({ type: z.literal("SAVED_DATA_READ"), id: z.string().uuid() }),
  scoped({ type: z.literal("SAVED_DATA_CACHED") }),
  scoped({
    type: z.literal("SAVED_DATA_PREVIEW_IMPORT"),
    selection: z
      .array(selectionSchema)
      .min(1)
      .max(SAVED_DATA_LIMITS.importItems),
  }),
  scoped({
    type: z.literal("SAVED_DATA_CONFIRM_IMPORT"),
    hash: servicePayloadHashSchema,
    approved: z.literal(true),
  }),
  scoped({
    type: z.literal("SAVED_DATA_SAVE"),
    artifact: savedDataArtifactSchema,
    expectedRevision: serviceExpectedRevisionSchema,
    approved: z.literal(true),
  }),
  scoped({
    type: z.literal("SAVED_DATA_DELETE"),
    id: z.string().uuid(),
    expectedRevision: serviceRevisionSchema,
    approved: z.literal(true),
  }),
  scoped({
    type: z.literal("SAVED_DATA_RECONCILE"),
    approved: z.literal(true),
  }),
  scoped({
    type: z.literal("SAVED_DATA_DISCARD_CONFLICT"),
    id: z.string().uuid(),
    approved: z.literal(true),
  }),
  scoped({
    type: z.literal("SAVED_DATA_EXPORT"),
    ids: z.array(z.string().uuid()).min(1).max(SAVED_DATA_LIMITS.importItems),
    approved: z.literal(true),
  }),
  scoped({
    type: z.literal("SAVED_DATA_ROUTE_INTENT"),
    id: z.string().uuid(),
    approved: z.literal(true),
  }),
]);
const memory = new IndexedDBSiteMemory();
const sources = new Map<string, { selection: LocalSelection; id: string }>();
let sourceGeneration = 0;

async function selectedLocalData(
  selection: LocalSelection,
  id: string,
  current: () => void,
): Promise<SavedDataLocalSelection> {
  const connection = await serviceAccountConnection();
  current();
  if (!connection) throw new Error("Sign in before previewing a cloud import.");
  let source: SavedDataSource;
  let revision = "";
  if (selection.kind === "saved_route") {
    const task = (await memory.tasks(selection.origin)).find(
      (entry) => entry.id === selection.id,
    );
    current();
    if (!task) throw new Error("The selected local route is unavailable.");
    source = { kind: selection.kind, value: task };
    revision = String(task.updatedAt);
  } else if (selection.kind === "site_knowledge") {
    const site = await memory.get(selection.origin);
    current();
    if (!site)
      throw new Error("The selected local website knowledge is unavailable.");
    source = { kind: selection.kind, value: site };
    revision = String(site.version);
  } else {
    const stored = await api.storage.session.get("tholiConversation");
    current();
    const messages = z
      .array(
        z
          .object({
            id: z.string(),
            role: z.enum(["user", "guide"]),
            text: z.string().max(1500),
            at: z.number().finite(),
          })
          .strict(),
      )
      .max(80)
      .parse(stored.tholiConversation ?? []);
    const selected = selection.ids.map((key) => {
      const message = messages.find((entry) => entry.id === key);
      if (!message)
        throw new Error("The selected conversation excerpt changed.");
      return {
        role: message.role === "guide" ? "assistant" : "user",
        text: message.text,
      };
    });
    source = { kind: selection.kind, value: selected };
  }
  const artifact = projectSavedDataArtifact(id, source, selection.metadata);
  const localKey = JSON.stringify(
    selection.kind === "conversation_excerpt"
      ? [selection.kind, selection.ids]
      : [
          selection.kind,
          selection.origin,
          selection.kind === "saved_route" ? selection.id : null,
        ],
  );
  const scope = savedDataScopeSchema.parse({
    accountId: connection.account.id,
    workspaceId: connection.account.workspaceId,
  });
  const hash = await savedDataImportHash(scope, [
    { expectedRevision: "0", artifact },
  ]);
  current();
  return {
    localKey,
    localRevision: revision ? `${revision}:${hash}` : hash,
    artifact,
  };
}

const client = new SavedDataClient({
  store: new IndexedDBCloudDataStore(),
  async connection() {
    const connected = await serviceAccountConnection();
    return connected
      ? {
          serviceOrigin: connected.origin,
          accountId: connected.account.id,
          workspaceId: connected.account.workspaceId,
        }
      : undefined;
  },
  request: (path, schema, method, body, signal) =>
    serviceAuthorizedRequest(path, schema, method, body, {
      signal,
      requireAccountBinding: path !== "/api/v1/capabilities",
      beforeSend: async (connection) => {
        // Reading, deleting and requesting an export never uploads local content.
        const uploads =
          (method === "POST" && !path.endsWith("/export")) ||
          method === "PATCH";
        if (uploads && !(await hasBackendAccess(connection.origin)))
          throw new ServiceClientError(
            "FORBIDDEN",
            403,
            "Grant website data transmission access from the Tholi sidebar before saving cloud data.",
          );
      },
    }),
  async localRevision(key) {
    const source = sources.get(key);
    const expected = sourceGeneration;
    return source
      ? (
          await selectedLocalData(source.selection, source.id, () => {
            if (expected !== sourceGeneration)
              throw new Error("The import account changed.");
          })
        ).localRevision
      : undefined;
  },
});
onServiceAccountChange(async (previous) => {
  sourceGeneration++;
  sources.clear();
  await client.reset(previous);
});

/** The message router admits only the exact privileged panel sender. */
export async function savedDataCommand(raw: unknown) {
  const expected = sourceGeneration;
  const command = commandSchema.parse(raw);
  const connection = await serviceAccountConnection();
  const current = () => {
    if (sourceGeneration !== expected)
      throw new Error("The cloud data account changed.");
  };
  current();
  if (
    !connection ||
    connection.account.id !== command.scope.accountId ||
    connection.account.workspaceId !== command.scope.workspaceId
  )
    throw new Error("The displayed cloud data account changed. Open it again.");
  const result = await (async () => {
    switch (command.type) {
      case "SAVED_DATA_LIST":
        return client.list(command.query, command.search);
      case "SAVED_DATA_READ":
        return client.read(command.id);
      case "SAVED_DATA_CACHED":
        return client.cached();
      case "SAVED_DATA_PREVIEW_IMPORT": {
        sources.clear();
        const selected: SavedDataLocalSelection[] = [];
        for (const selection of command.selection) {
          const id = crypto.randomUUID(),
            entry = await selectedLocalData(selection, id, current);
          sources.set(entry.localKey, { selection, id });
          selected.push(entry);
        }
        current();
        return client.previewImport(selected);
      }
      case "SAVED_DATA_CONFIRM_IMPORT":
        return { operationId: await client.confirmImport(command.hash) };
      case "SAVED_DATA_SAVE":
        return {
          operationId: await client.save(
            command.artifact,
            command.expectedRevision,
          ),
        };
      case "SAVED_DATA_DELETE":
        return {
          operationId: await client.remove(
            command.id,
            command.expectedRevision,
          ),
        };
      case "SAVED_DATA_RECONCILE":
        await client.reconcile();
        return client.cached();
      case "SAVED_DATA_DISCARD_CONFLICT":
        await client.discardConflict(command.id);
        return client.cached();
      case "SAVED_DATA_EXPORT":
        return client.export(command.ids);
      case "SAVED_DATA_ROUTE_INTENT":
        return client.routeIntent(command.id);
    }
  })();
  current();
  return result;
}
