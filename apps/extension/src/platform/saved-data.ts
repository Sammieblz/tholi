import { z } from "zod";
import {
  savedDataArtifactSchema,
  savedDataImportHash,
  savedDataListQuerySchema,
  savedDataMetadataSchema,
  savedDataScopeSchema,
  SAVED_DATA_LIMITS,
  savedDataArtifactV2Schema,
} from "../../../../packages/navigation-core/contracts-saved-data";
import {
  serviceExpectedRevisionSchema,
  servicePayloadHashSchema,
  serviceRevisionSchema,
  serviceCapabilitiesSchema,
} from "../../../../packages/navigation-core/contracts-service";
import {
  SavedDataClient,
  savedDataOperationIds,
  type SavedDataLocalSelection,
  type SavedDataExecution,
} from "../../../../packages/navigation-core/saved-data-client";
import {
  projectSavedDataArtifact,
  type SavedDataSource,
} from "../../../../packages/navigation-core/saved-data-privacy";
import { IndexedDBCloudDataStore } from "../../../../packages/site-memory/cloud-data";
import { IndexedDBSiteMemory } from "../../../../packages/site-memory";
import { api } from "./api";
import { getPrivateSetting, setPrivateSetting } from "./private-settings";
import {
  onServiceAccountChange,
  serviceAccountConnection,
  serviceAuthorizedRequest,
  serviceInferenceAccess,
  serviceInferenceSignal,
} from "./service-auth";
import {
  navigationKnowledgeOriginSchema,
  navigationKnowledgeSiteSettingsInputSchema,
  type NavigationKnowledgeSiteSettings,
} from "../../../../packages/navigation-core/contracts-navigation-knowledge";
import {
  navigationKnowledgeQueryFromObservation,
  projectNavigationKnowledge,
} from "../../../../packages/navigation-core/navigation-knowledge-projection";
import type { NavigationObservation } from "../../../../packages/navigation-core/contracts-navigation";
import type { SiteMemory } from "../../../../packages/page-model";
import { hasBackendAccess, hostPermissionPattern } from "./site-access";
import { ServiceClientError } from "../../../../packages/navigation-core/service-client";

const websiteOrigin = navigationKnowledgeOriginSchema;
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
    type: z.literal("SAVED_DATA_SITE_SETTINGS"),
    origin: websiteOrigin,
  }),
  scoped({
    type: z.literal("SAVED_DATA_SITE_CONFIGURE"),
    choice: navigationKnowledgeSiteSettingsInputSchema.omit({
      idempotencyKey: true,
    }),
  }),
  scoped({
    type: z.literal("SAVED_DATA_SITE_FORGET"),
    origin: websiteOrigin,
    expectedRevision: serviceExpectedRevisionSchema,
    idempotencyKey: z.string().uuid(),
    approved: z.literal(true),
  }),
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
let knowledgeView = false;
let learningPending = new AbortController();
let choiceWrites = Promise.resolve();
const siteManagementEpochs = new Map<string, symbol>();
const learningAttempts = new Map<
  string,
  { at: number; savedAt?: number; digest?: string }
>();
const privateSiteChoicesSchema = z
  .array(
    savedDataScopeSchema.extend({
      serviceOrigin: z.string().url(),
      origin: websiteOrigin,
      collect: z.boolean(),
      use: z.boolean(),
    }),
  )
  .max(50);
async function privateSiteChoices() {
  return privateSiteChoicesSchema.parse(
    (await getPrivateSetting("privateSiteLearning")) ?? [],
  );
}
function updatePrivateSiteChoices(
  change: (
    choices: z.infer<typeof privateSiteChoicesSchema>,
  ) => z.infer<typeof privateSiteChoicesSchema>,
  current: () => void = () => {},
) {
  const work = choiceWrites.then(async () => {
    current();
    const choices = await privateSiteChoices();
    current();
    await setPrivateSetting(
      "privateSiteLearning",
      privateSiteChoicesSchema.parse(change(choices)),
    );
    current();
  });
  choiceWrites = work.catch(() => {});
  return work;
}
const sameSiteAccount = (
  choice: z.infer<typeof privateSiteChoicesSchema>[number],
  connection: NonNullable<Awaited<ReturnType<typeof serviceAccountConnection>>>,
) =>
  choice.serviceOrigin === connection.origin &&
  choice.accountId === connection.account.id &&
  choice.workspaceId === connection.account.workspaceId;
function privateSiteKey(
  connection: NonNullable<Awaited<ReturnType<typeof serviceAccountConnection>>>,
  origin: string,
) {
  return JSON.stringify([
    connection.origin,
    connection.account.id,
    connection.account.workspaceId,
    origin,
  ]);
}
function siteManagementLease(
  connection: NonNullable<Awaited<ReturnType<typeof serviceAccountConnection>>>,
  origin: string,
  changing: boolean,
) {
  const key = privateSiteKey(connection, origin);
  let epoch = siteManagementEpochs.get(key);
  if (!epoch || changing) {
    epoch = Symbol();
    siteManagementEpochs.delete(key);
    siteManagementEpochs.set(key, epoch);
  }
  while (siteManagementEpochs.size > 100)
    siteManagementEpochs.delete(siteManagementEpochs.keys().next().value!);
  return () => {
    if (siteManagementEpochs.get(key) !== epoch)
      throw new Error("The private website memory choice changed.");
  };
}
async function rememberSiteChoice(
  connection: NonNullable<Awaited<ReturnType<typeof serviceAccountConnection>>>,
  value: NavigationKnowledgeSiteSettings,
  current: () => void,
  allowEnabling = false,
) {
  let remembered = value;
  await updatePrivateSiteChoices((previous) => {
    const approved = previous.find(
      (item) =>
        sameSiteAccount(item, connection) && item.origin === value.origin,
    );
    // A read can confirm or reduce this device's choice, never grant a new one.
    remembered = {
      ...value,
      collect: value.collect && (allowEnabling || !!approved?.collect),
      use: value.use && (allowEnabling || !!approved?.use),
    };
    const choices = previous.filter(
      (item) =>
        !sameSiteAccount(item, connection) || item.origin !== value.origin,
    );
    if (remembered.collect || remembered.use)
      choices.push({
        serviceOrigin: connection.origin,
        accountId: connection.account.id,
        workspaceId: connection.account.workspaceId,
        origin: value.origin,
        collect: remembered.collect,
        use: remembered.use,
      });
    return choices.slice(-50);
  }, current);
  learningAttempts.delete(privateSiteKey(connection, value.origin));
  return remembered;
}

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
          ...(knowledgeView ? { schemaVersion: 2 as const } : {}),
        }
      : undefined;
  },
  request: (path, schema, method, body, signal, beforeSend) => {
    const pathname = path.split("?")[0];
    const graph =
      body &&
      typeof body === "object" &&
      "artifact" in body &&
      body.artifact &&
      typeof body.artifact === "object" &&
      "schemaVersion" in body.artifact &&
      body.artifact.schemaVersion === 2;
    const retrieval = path.includes("/artifacts/navigation-knowledge");
    const automatic = !!graph || retrieval;
    const guardedSignal = automatic
      ? AbortSignal.any(
          [signal, serviceInferenceSignal(), learningPending.signal].filter(
            (value): value is AbortSignal => !!value,
          ),
        )
      : signal;
    return serviceAuthorizedRequest(path, schema, method, body, {
      signal: guardedSignal,
      requireAccountBinding: path !== "/api/v1/capabilities",
      beforeSend: async (connection) => {
        if (automatic) await serviceInferenceAccess(false);
        const siteOrigin =
          graph && body && typeof body === "object" && "artifact" in body
            ? savedDataArtifactV2Schema.parse(body.artifact).data
            : retrieval && body && typeof body === "object" && "origin" in body
              ? body
              : undefined;
        if (
          automatic &&
          (!siteOrigin ||
            !("origin" in siteOrigin) ||
            !(await privateSiteChoices()).some(
              (item) =>
                sameSiteAccount(item, connection) &&
                item.origin === siteOrigin.origin &&
                (graph ? item.collect : item.use),
            ))
        )
          throw new ServiceClientError(
            "FORBIDDEN",
            403,
            "Private learning or retrieval is paused for this site.",
          );
        if (graph && body && typeof body === "object" && "artifact" in body) {
          const artifact = savedDataArtifactV2Schema.parse(body.artifact);
          if (
            artifact.schemaVersion === 2 &&
            !(await api.permissions.contains({
              origins: [hostPermissionPattern(artifact.data.origin)],
            }))
          )
            throw new ServiceClientError(
              "FORBIDDEN",
              403,
              "Current website access is required for private learning.",
            );
        }
        // Reading, deleting and requesting an export never uploads local content.
        const siteManagement = pathname.endsWith("/artifacts/site-settings");
        const uploads =
          !siteManagement &&
          ((method === "POST" && !pathname.endsWith("/export")) ||
            method === "PATCH");
        if (uploads && !(await hasBackendAccess(connection.origin)))
          throw new ServiceClientError(
            "FORBIDDEN",
            403,
            "Grant website data transmission access from the Tholi sidebar before saving cloud data.",
          );
        await beforeSend?.();
      },
    });
  },
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
  siteManagementEpochs.clear();
  knowledgeView = false;
  learningAttempts.clear();
  learningPending.abort();
  learningPending = new AbortController();
  await client.reset(previous);
  const old = await previous;
  if (old)
    await updatePrivateSiteChoices((choices) =>
      choices.filter(
        (item) =>
          item.serviceOrigin !== old.serviceOrigin ||
          item.accountId !== old.accountId ||
          item.workspaceId !== old.workspaceId,
      ),
    );
});

async function enableKnowledgeView(execution?: SavedDataExecution) {
  if (knowledgeView) return;
  const expected = sourceGeneration;
  const capabilities = await serviceAuthorizedRequest(
    "/api/v1/capabilities",
    serviceCapabilitiesSchema,
    "GET",
    undefined,
    { signal: execution?.signal, beforeSend: execution?.beforeSend },
  );
  execution?.signal?.throwIfAborted();
  if (expected !== sourceGeneration)
    throw new ServiceClientError(
      "CANCELLED",
      0,
      "The private memory account changed.",
    );
  if (!capabilities.capabilities.includes("saved-data-schema-2"))
    throw new ServiceClientError(
      "UNAVAILABLE",
      503,
      "This service does not support private navigation memory.",
    );
  if (knowledgeView) return;
  sources.clear();
  client.suspend();
  knowledgeView = true;
}

/** Explicit cloud processing is checked again at the actual transmission boundary. */
export async function retrievePrivateNavigationKnowledge(
  observation: NavigationObservation,
  origin: string,
  signal: AbortSignal,
  beforeSend: () => Promise<void>,
) {
  signal = AbortSignal.any([signal, learningPending.signal]);
  signal.throwIfAborted();
  const choice = await serviceInferenceAccess(false);
  const enabled = (await privateSiteChoices()).some(
    (item) =>
      sameSiteAccount(item, {
        origin: choice.origin,
        account: choice.account,
      }) &&
      item.origin === origin &&
      item.use,
  );
  if (!enabled) return undefined;
  signal.throwIfAborted();
  await enableKnowledgeView({ signal, beforeSend });
  signal.throwIfAborted();
  const result = await client.retrieveKnowledge(
    navigationKnowledgeQueryFromObservation(observation, origin),
    { signal, beforeSend },
  );
  signal.throwIfAborted();
  const current = await serviceInferenceAccess(false);
  signal.throwIfAborted();
  if (
    choice.origin !== current.origin ||
    choice.account.id !== current.account.id ||
    choice.account.workspaceId !== current.account.workspaceId
  )
    throw new ServiceClientError(
      "CANCELLED",
      0,
      "The private memory account changed.",
    );
  return result;
}

/** Fresh local evidence is projected only after separate server site approval. */
export async function learnPrivateNavigation(site: SiteMemory) {
  const signal = AbortSignal.any([
    serviceInferenceSignal(),
    learningPending.signal,
  ]);
  let choice;
  try {
    choice = await serviceInferenceAccess(false);
  } catch {
    return;
  }
  signal.throwIfAborted();
  const enabled = (await privateSiteChoices()).some(
    (item) =>
      sameSiteAccount(item, {
        origin: choice.origin,
        account: choice.account,
      }) &&
      item.origin === site.origin &&
      item.collect,
  );
  signal.throwIfAborted();
  if (!enabled) return;
  const key = privateSiteKey(
    { origin: choice.origin, account: choice.account },
    site.origin,
  );
  const previous = learningAttempts.get(key);
  if (previous && Date.now() - previous.at < 30000) return;
  const attempt = {
    at: Date.now(),
    savedAt: previous?.savedAt,
    digest: previous?.digest,
  };
  learningAttempts.delete(key);
  learningAttempts.set(key, attempt);
  while (learningAttempts.size > 32)
    learningAttempts.delete(learningAttempts.keys().next().value!);
  const execution = {
    signal,
    beforeSend: async () => {
      signal.throwIfAborted();
      const current = await serviceInferenceAccess(false);
      if (
        choice.origin !== current.origin ||
        choice.account.id !== current.account.id ||
        choice.account.workspaceId !== current.account.workspaceId ||
        !(await privateSiteChoices()).some(
          (item) =>
            sameSiteAccount(item, {
              origin: current.origin,
              account: current.account,
            }) &&
            item.origin === site.origin &&
            item.collect,
        )
      )
        throw new ServiceClientError(
          "CANCELLED",
          0,
          "Private learning permission changed.",
        );
      if (
        !(await api.permissions.contains({
          origins: [hostPermissionPattern(site.origin)],
        }))
      )
        throw new ServiceClientError(
          "FORBIDDEN",
          403,
          "Current website access is required for private learning.",
        );
      signal.throwIfAborted();
    },
  };
  await enableKnowledgeView(execution);
  signal.throwIfAborted();
  const settings = await client.siteSettings(site.origin, execution);
  signal.throwIfAborted();
  if (!settings.collect || settings.revision === "0" || !settings.updatedAt)
    return;
  const data = await projectNavigationKnowledge(
    site,
    Date.now(),
    Date.parse(settings.updatedAt),
  );
  signal.throwIfAborted();
  if (!data.states.length) return;
  const stable = JSON.stringify([
    settings.revision,
    {
      controls: data.controls,
      states: data.states.map(({ observedAt: _at, ...state }) => state),
      edges: data.edges.map(({ observedAt: _at, ...edge }) => edge),
    },
  ]);
  if (
    previous?.digest === stable &&
    previous.savedAt &&
    Date.now() - previous.savedAt < 86400000
  )
    return;
  const page = await client.list(
    { kind: "site_knowledge", limit: 100 },
    false,
    execution,
  );
  signal.throwIfAborted();
  const record = page.items.find(
    (item) => item.schemaVersion === 2 && item.data?.origin === site.origin,
  );
  // A bounded page cannot prove this origin has no existing graph.
  if (!record && page.nextCursor) return;
  const cache = await client.cached();
  if (
    cache.outbox.some(({ operation }) => {
      const artifacts =
        operation.kind === "save"
          ? [operation.body.artifact]
          : operation.kind === "import"
            ? operation.body.items.map((item) => item.artifact)
            : [];
      return (
        artifacts.some(
          (artifact) =>
            artifact.schemaVersion === 2 &&
            artifact.data.origin === site.origin,
        ) ||
        (record && savedDataOperationIds(operation).includes(record.id))
      );
    })
  )
    throw new Error("Private memory has an unresolved change.");
  const artifact = savedDataArtifactV2Schema.parse({
    id: record?.id ?? crypto.randomUUID(),
    schemaVersion: 2,
    kind: "site_knowledge",
    metadata: record?.metadata ?? {
      label: "Private website knowledge",
      folder: null,
      tags: [],
    },
    data,
  });
  signal.throwIfAborted();
  const operationId = await client.save(
    artifact,
    record?.revision ?? "0",
    settings.revision,
    execution,
  );
  signal.throwIfAborted();
  await client.reconcile(operationId, execution);
  signal.throwIfAborted();
  attempt.digest = stable;
  attempt.savedAt = Date.now();
}

/** The message router admits only the exact privileged panel sender. */
export async function savedDataCommand(raw: unknown) {
  const expected = sourceGeneration;
  const command = commandSchema.parse(raw);
  const connection = await serviceAccountConnection();
  const accountCurrent = () => {
    if (sourceGeneration !== expected)
      throw new Error("The cloud data account changed.");
  };
  accountCurrent();
  if (
    !connection ||
    connection.account.id !== command.scope.accountId ||
    connection.account.workspaceId !== command.scope.workspaceId
  )
    throw new Error("The displayed cloud data account changed. Open it again.");
  const siteOrigin =
    command.type === "SAVED_DATA_SITE_CONFIGURE"
      ? command.choice.origin
      : command.type === "SAVED_DATA_SITE_SETTINGS" ||
          command.type === "SAVED_DATA_SITE_FORGET"
        ? command.origin
        : undefined;
  const siteCurrent = siteOrigin
    ? siteManagementLease(
        connection,
        siteOrigin,
        command.type !== "SAVED_DATA_SITE_SETTINGS",
      )
    : undefined;
  const current = () => {
    accountCurrent();
    siteCurrent?.();
  };
  const result = await (async () => {
    switch (command.type) {
      case "SAVED_DATA_SITE_SETTINGS": {
        await enableKnowledgeView();
        const result = await client.siteSettings(command.origin);
        current();
        return rememberSiteChoice(connection, result, current);
      }
      case "SAVED_DATA_SITE_CONFIGURE": {
        learningPending.abort();
        // Reductions fence this device even if the service acknowledgement is lost.
        await updatePrivateSiteChoices(
          (choices) =>
            choices.map((item) =>
              sameSiteAccount(item, connection) &&
              item.origin === command.choice.origin
                ? {
                    ...item,
                    collect: item.collect && command.choice.collect,
                    use: item.use && command.choice.use,
                  }
                : item,
            ),
          current,
        );
        current();
        learningPending = new AbortController();
        await enableKnowledgeView();
        const result = await client.updateSiteSettings(command.choice);
        current();
        return rememberSiteChoice(connection, result, current, true);
      }
      case "SAVED_DATA_SITE_FORGET": {
        learningPending.abort();
        await updatePrivateSiteChoices(
          (choices) =>
            choices.filter(
              (item) =>
                !sameSiteAccount(item, connection) ||
                item.origin !== command.origin,
            ),
          current,
        );
        current();
        learningPending = new AbortController();
        await enableKnowledgeView();
        const result = await client.forgetSite(
          command.origin,
          command.expectedRevision,
          command.idempotencyKey,
        );
        current();
        await rememberSiteChoice(connection, result.siteSettings, current);
        return result;
      }
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
