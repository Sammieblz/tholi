import { z } from "zod";
import { sanitizeSavedText } from "../privacy-redaction";
import {
  serviceExpectedRevisionSchema,
  servicePageQuerySchema,
  servicePayloadHashSchema,
  serviceRevisionSchema,
  serviceSyncRevisionSchema,
  serviceQuantitySchema,
  serviceSchemaVersionQuerySchema,
} from "./contracts-service";
import { privateFileRequestSchema } from "./contracts-private-files";
import {
  NAVIGATION_KNOWLEDGE_LIMITS,
  savedNavigationKnowledgeSchema,
  navigationKnowledgeOriginSchema,
} from "./contracts-navigation-knowledge";

export const SAVED_DATA_LIMITS = Object.freeze({
  label: 120,
  folder: 80,
  tag: 40,
  tags: 10,
  itemBytes: 32768,
  importBytes: 131072,
  importItems: 20,
  conversationMessages: 12,
});
/** Logical saved-item bytes match database quota accounting, not physical disk usage. */
export const savedDataStorageUsageSchema = z
  .object({
    scope: z.literal("account"),
    artifacts: serviceQuantitySchema,
    bytes: serviceQuantitySchema,
  })
  .strict();
export type SavedDataStorageUsage = z.infer<typeof savedDataStorageUsageSchema>;
const safeText = (maximum: number) =>
  z
    .string()
    .min(1)
    .max(maximum)
    .refine(
      (value) =>
        value.length <= maximum && sanitizeSavedText(value, maximum) === value,
      "Saved text must match its privacy preview.",
    );
const origin = navigationKnowledgeOriginSchema;
const time = z.string().datetime({ offset: true });
const operationId = z.string().uuid();
export const savedDataKindSchema = z.enum([
  "saved_route",
  "site_knowledge",
  "conversation_excerpt",
  "preferences",
]);
const historicalStep = z
  .object({
    kind: z.enum(["control", "navigation"]),
    label: safeText(160),
  })
  .strict();
export const savedRouteDataSchema = z
  .object({
    origin,
    goal: safeText(1000),
    steps: z.array(historicalStep).max(30),
    historyCompleted: z
      .boolean()
      .describe("Historical only; never proof of current arrival."),
  })
  .strict();
export const savedSiteKnowledgeDataSchema = z
  .object({
    origin,
    controls: z
      .array(
        z
          .object({
            role: safeText(40),
            label: safeText(160),
            kind: z.enum(["control", "navigation"]),
          })
          .strict(),
      )
      .max(48),
  })
  .strict();
export const savedConversationDataSchema = z
  .object({
    messages: z
      .array(
        z
          .object({ role: z.enum(["user", "assistant"]), text: safeText(1000) })
          .strict(),
      )
      .min(1)
      .max(SAVED_DATA_LIMITS.conversationMessages),
  })
  .strict();
export const savedPreferencesDataSchema = z
  .object({
    websiteAppearance: z.enum(["light", "dark"]),
  })
  .strict();
export const savedDataMetadataSchema = z
  .object({
    label: safeText(SAVED_DATA_LIMITS.label),
    folder: safeText(SAVED_DATA_LIMITS.folder).nullable(),
    tags: z
      .array(safeText(SAVED_DATA_LIMITS.tag))
      .max(SAVED_DATA_LIMITS.tags)
      .refine(
        (values) => new Set(values).size === values.length,
        "Tags must be distinct.",
      ),
  })
  .strict();
const draft = z
  .object({
    id: z.string().uuid(),
    schemaVersion: z.literal(1),
    metadata: savedDataMetadataSchema,
  })
  .strict();
const record = draft.extend({
  revision: serviceRevisionSchema,
  syncRevision: serviceSyncRevisionSchema,
  createdAt: time,
  updatedAt: time,
  deletedAt: time.nullable(),
});
export const savedDataArtifactSchema = z
  .discriminatedUnion("kind", [
    draft.extend({
      kind: z.literal("saved_route"),
      data: savedRouteDataSchema,
    }),
    draft.extend({
      kind: z.literal("site_knowledge"),
      data: savedSiteKnowledgeDataSchema,
    }),
    draft.extend({
      kind: z.literal("conversation_excerpt"),
      data: savedConversationDataSchema,
    }),
    draft.extend({
      kind: z.literal("preferences"),
      data: savedPreferencesDataSchema,
    }),
  ])
  .superRefine((value, context) => {
    if (
      new TextEncoder().encode(JSON.stringify(value)).length >
      SAVED_DATA_LIMITS.itemBytes
    )
      context.addIssue({
        code: "custom",
        message: "The saved artifact is too large.",
      });
  });
export const savedDataRecordSchema = z
  .discriminatedUnion("kind", [
    record.extend({
      kind: z.literal("saved_route"),
      data: savedRouteDataSchema.nullable(),
    }),
    record.extend({
      kind: z.literal("site_knowledge"),
      data: savedSiteKnowledgeDataSchema.nullable(),
    }),
    record.extend({
      kind: z.literal("conversation_excerpt"),
      data: savedConversationDataSchema.nullable(),
    }),
    record.extend({
      kind: z.literal("preferences"),
      data: savedPreferencesDataSchema.nullable(),
    }),
  ])
  .refine(
    (value) => (value.deletedAt === null) === (value.data !== null),
    "Deletion must retain a content-free tombstone.",
  )
  .refine(
    (value) =>
      value.deletedAt === null ||
      (value.metadata.label === "Deleted item" &&
        value.metadata.folder === null &&
        value.metadata.tags.length === 0),
    "Tombstones cannot retain private metadata.",
  );
export const savedDataScopeSchema = z
  .object({ accountId: z.string().uuid(), workspaceId: z.string().uuid() })
  .strict();
export const savedDataMutationSchema = z
  .object({
    idempotencyKey: operationId,
    expectedRevision: serviceExpectedRevisionSchema,
    approved: z.literal(true),
    artifact: savedDataArtifactSchema,
  })
  .strict();
export const savedDataCreateSchema = savedDataMutationSchema.refine(
  (value) => value.expectedRevision === "0",
  "Creation requires revision zero.",
);
export const savedDataUpdateSchema = savedDataMutationSchema.refine(
  (value) => value.expectedRevision !== "0",
  "An update requires its current revision.",
);
export const savedDataDeleteInputSchema = z
  .object({
    idempotencyKey: operationId,
    expectedRevision: serviceRevisionSchema,
    approved: z.literal(true),
  })
  .strict();
export const savedDataImportItemSchema = z
  .object({
    expectedRevision: serviceExpectedRevisionSchema,
    artifact: savedDataArtifactSchema,
  })
  .strict();
const importItems = z
  .array(savedDataImportItemSchema)
  .min(1)
  .max(SAVED_DATA_LIMITS.importItems)
  .refine(
    (items) =>
      new Set(items.map((item) => item.artifact.id)).size === items.length,
    "Import IDs must be distinct.",
  );
export const savedDataImportInputSchema = z
  .object({
    idempotencyKey: operationId,
    approved: z.literal(true),
    previewHash: servicePayloadHashSchema,
    items: importItems,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      new TextEncoder().encode(JSON.stringify(value)).length >
      SAVED_DATA_LIMITS.importBytes
    )
      context.addIssue({
        code: "custom",
        message: "Select a smaller import batch.",
      });
  });
export const savedDataImportResultSchema = z
  .object({
    items: z.array(savedDataRecordSchema).max(SAVED_DATA_LIMITS.importItems),
    replayed: z.boolean(),
  })
  .strict();
export const savedDataListQuerySchema = servicePageQuerySchema.extend({
  query: safeText(80).optional(),
  kind: savedDataKindSchema.optional(),
  folder: safeText(SAVED_DATA_LIMITS.folder).optional(),
  tag: safeText(SAVED_DATA_LIMITS.tag).optional(),
});
export const savedDataPageSchema = z
  .object({
    items: z.array(savedDataRecordSchema).max(100),
    nextCursor: servicePageQuerySchema.shape.cursor,
  })
  .strict();
export const savedDataChangesSchema = z
  .object({
    items: z.array(savedDataRecordSchema).max(100),
    nextAfter: serviceSyncRevisionSchema,
    hasMore: z.boolean(),
  })
  .strict();
export const savedDataExportInputSchema = z
  .object({
    idempotencyKey: operationId,
    ids: z
      .array(z.string().uuid())
      .min(1)
      .max(SAVED_DATA_LIMITS.importItems)
      .refine(
        (ids) => new Set(ids).size === ids.length,
        "Export IDs must be distinct.",
      ),
  })
  .strict();
export const savedDataExportResultSchema = privateFileRequestSchema;
export const savedDataExportSnapshotSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("saved-data-export"),
    createdAt: time,
    items: z
      .array(savedDataRecordSchema)
      .min(1)
      .max(SAVED_DATA_LIMITS.importItems)
      .refine(
        (items) => items.every((item) => item.data !== null),
        "Only selected live artifacts can be exported.",
      ),
  })
  .strict();

/** The same ordered, parsed preview is hashed on the client and authenticated server. */
export async function savedDataImportHash(
  scope: SavedDataScope,
  items: SavedDataImportInput["items"],
): Promise<string> {
  return importPreviewHash(scope, items, 1);
}

export type SavedDataArtifact = z.infer<typeof savedDataArtifactSchema>;
export type SavedDataRecord = z.infer<typeof savedDataRecordSchema>;
export type SavedDataScope = z.infer<typeof savedDataScopeSchema>;
export type SavedDataMutation = z.infer<typeof savedDataMutationSchema>;
export type SavedDataDeleteInput = z.infer<typeof savedDataDeleteInputSchema>;
export type SavedDataImportInput = z.infer<typeof savedDataImportInputSchema>;
export type SavedDataImportResult = z.infer<typeof savedDataImportResultSchema>;
export type SavedDataListQuery = z.infer<typeof savedDataListQuerySchema>;
export type SavedDataPage = z.infer<typeof savedDataPageSchema>;
export type SavedDataChanges = z.infer<typeof savedDataChangesSchema>;
export type SavedDataExportInput = z.infer<typeof savedDataExportInputSchema>;
export type SavedDataExportResult = z.infer<typeof savedDataExportResultSchema>;
export type SavedDataExportSnapshot = z.infer<
  typeof savedDataExportSnapshotSchema
>;

/** Explicitly negotiated view 2 adds graph records without widening the v1 wire. */
export const savedDataViewSchema = serviceSchemaVersionQuerySchema;
export type SavedDataView = z.infer<typeof savedDataViewSchema>;
export const savedDataViewQuerySchema = z
  .object({
    schemaVersion: savedDataViewSchema.optional(),
  })
  .strict();
export const savedDataNegotiatedListQuerySchema =
  savedDataListQuerySchema.extend({
    schemaVersion: savedDataViewSchema.optional(),
  });
const graphDraft = draft.extend({
  schemaVersion: z.literal(2),
  kind: z.literal("site_knowledge"),
  data: savedNavigationKnowledgeSchema,
});
export const savedNavigationKnowledgeArtifactSchema = graphDraft.refine(
  (value) =>
    new TextEncoder().encode(JSON.stringify(value)).byteLength <=
    NAVIGATION_KNOWLEDGE_LIMITS.artifactBytes,
  "The navigation graph artifact is too large.",
);
const graphRecord = record
  .extend({
    schemaVersion: z.literal(2),
    kind: z.literal("site_knowledge"),
    data: savedNavigationKnowledgeSchema.nullable(),
  })
  .refine(
    (value) => (value.deletedAt === null) === (value.data !== null),
    "Deletion must retain a content-free tombstone.",
  )
  .refine(
    (value) =>
      value.deletedAt === null ||
      (value.metadata.label === "Deleted item" &&
        value.metadata.folder === null &&
        value.metadata.tags.length === 0),
    "Tombstones cannot retain private metadata.",
  );
export const savedDataArtifactV2Schema = z.union([
  savedDataArtifactSchema,
  savedNavigationKnowledgeArtifactSchema,
]);
export const savedDataRecordV2Schema = z.union([
  savedDataRecordSchema,
  graphRecord,
]);
export const savedDataMutationV2Schema = savedDataMutationSchema
  .extend({
    artifact: savedDataArtifactV2Schema,
    siteSettingsRevision: serviceRevisionSchema.optional(),
  })
  .refine(
    (value) =>
      value.artifact.schemaVersion !== 2 || !!value.siteSettingsRevision,
    "Graph updates require the current site collection choice.",
  );
export const savedDataCreateV2Schema = savedDataMutationV2Schema.refine(
  (value) => value.expectedRevision === "0",
  "Creation requires revision zero.",
);
export const savedDataUpdateV2Schema = savedDataMutationV2Schema.refine(
  (value) => value.expectedRevision !== "0",
  "An update requires its current revision.",
);
const importItemsV2 = z
  .array(
    savedDataImportItemSchema
      .extend({
        artifact: savedDataArtifactV2Schema,
        siteSettingsRevision: serviceRevisionSchema.optional(),
      })
      .refine(
        (value) =>
          value.artifact.schemaVersion !== 2 || !!value.siteSettingsRevision,
        "Graph imports require the current site collection choice.",
      ),
  )
  .min(1)
  .max(SAVED_DATA_LIMITS.importItems)
  .refine(
    (items) =>
      new Set(items.map((item) => item.artifact.id)).size === items.length,
    "Import IDs must be distinct.",
  );
export const savedDataImportInputV2Schema = z
  .object({
    idempotencyKey: operationId,
    approved: z.literal(true),
    previewHash: servicePayloadHashSchema,
    items: importItemsV2,
  })
  .strict()
  .refine(
    (value) =>
      new TextEncoder().encode(JSON.stringify(value)).length <=
      SAVED_DATA_LIMITS.importBytes,
    "Select a smaller import batch.",
  );
export const savedDataImportResultV2Schema = savedDataImportResultSchema.extend(
  {
    items: z.array(savedDataRecordV2Schema).max(SAVED_DATA_LIMITS.importItems),
  },
);
export const savedDataPageV2Schema = savedDataPageSchema.extend({
  items: z.array(savedDataRecordV2Schema).max(100),
});
export const savedDataChangesV2Schema = savedDataChangesSchema.extend({
  items: z.array(savedDataRecordV2Schema).max(100),
});
export const savedDataExportSnapshotV2Schema =
  savedDataExportSnapshotSchema.extend({
    schemaVersion: z.literal(2),
    items: z
      .array(savedDataRecordV2Schema)
      .min(1)
      .max(SAVED_DATA_LIMITS.importItems)
      .refine(
        (items) => items.every((item) => item.data !== null),
        "Only selected live artifacts can be exported.",
      ),
  });
export const savedDataExportFileSchema = z.union([
  savedDataExportSnapshotSchema,
  savedDataExportSnapshotV2Schema,
]);
export type SavedDataArtifactV2 = z.infer<typeof savedDataArtifactV2Schema>;
export type SavedDataRecordV2 = z.infer<typeof savedDataRecordV2Schema>;
export type SavedDataMutationV2 = z.infer<typeof savedDataMutationV2Schema>;
export type SavedDataImportInputV2 = z.infer<
  typeof savedDataImportInputV2Schema
>;
export type SavedDataImportResultV2 = z.infer<
  typeof savedDataImportResultV2Schema
>;
export type SavedDataPageV2 = z.infer<typeof savedDataPageV2Schema>;
export type SavedDataChangesV2 = z.infer<typeof savedDataChangesV2Schema>;

export async function savedDataImportHashV2(
  scope: SavedDataScope,
  items: SavedDataImportInputV2["items"],
) {
  return importPreviewHash(scope, items, 2);
}

async function importPreviewHash(
  scope: SavedDataScope,
  items: unknown,
  version: SavedDataView,
) {
  const value = {
    schemaVersion: version,
    ...savedDataScopeSchema.parse(scope),
    items:
      version === 2 ? importItemsV2.parse(items) : importItems.parse(items),
  };
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  if (bytes.length > SAVED_DATA_LIMITS.importBytes)
    throw new Error("Select a smaller import batch.");
  const digest = await globalThis.crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
