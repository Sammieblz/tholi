import { createHash } from "node:crypto";
import { z } from "zod";
import {
  savedDataChangesSchema,
  savedDataCreateSchema,
  savedDataDeleteInputSchema,
  savedDataExportInputSchema,
  savedDataExportResultSchema,
  savedDataImportHash,
  savedDataImportInputSchema,
  savedDataImportResultSchema,
  savedDataListQuerySchema,
  savedDataPageSchema,
  savedDataRecordSchema,
  savedDataUpdateSchema,
  savedDataStorageUsageSchema,
  savedDataRecordV2Schema,
  savedDataCreateV2Schema,
  savedDataUpdateV2Schema,
  savedDataImportInputV2Schema,
  savedDataImportResultV2Schema,
  savedDataPageV2Schema,
  savedDataChangesV2Schema,
  savedDataImportHashV2,
  type SavedDataView,
  type SavedDataRecordV2,
  type SavedDataMutationV2,
  type SavedDataImportInputV2,
  type SavedDataImportResultV2,
  type SavedDataPageV2,
  type SavedDataChangesV2,
  type SavedDataStorageUsage,
  type SavedDataDeleteInput,
  type SavedDataListQuery,
  type SavedDataRecord,
  type SavedDataPage,
  type SavedDataChanges,
  type SavedDataImportResult,
} from "../../../../packages/navigation-core/contracts-saved-data";
import { serviceSyncQuerySchema } from "../../../../packages/navigation-core/contracts-service";
import type { ServiceRequestContext } from "../capabilities";
import type { RepositoryScope } from "../database/contracts";
import {
  AuthorizationError,
  authorizationRepositoryFailure,
  withAuthorization,
  type AuthorizedRepositories,
} from "./authorization";
import type { AuthorizationContextReader } from "./authorization-policy";
import type { IdentitySession } from "./identity-contracts";
import type { DiagnosticRecord } from "./support-contracts";

import {
  navigationKnowledgeQuerySchema,
  navigationKnowledgeOriginSchema,
  navigationKnowledgeSiteSettingsSchema,
  navigationKnowledgeSiteSettingsInputSchema,
  retrievedNavigationKnowledgeSchema,
  navigationKnowledgeSnapshotDigest,
  serializeNavigationKnowledge,
  type RetrievedNavigationKnowledge,
  type NavigationKnowledgeSiteSettings,
  type NavigationKnowledgeSiteSettingsInput,
  navigationKnowledgeForgetSiteInputSchema,
  navigationKnowledgeForgetSiteResultSchema,
  type NavigationKnowledgeForgetSiteInput,
  type NavigationKnowledgeForgetSiteResult,
} from "../../../../packages/navigation-core/contracts-navigation-knowledge";
import { rankNavigationKnowledge } from "./navigation-knowledge";

type Principal = Pick<IdentitySession, "accountId">;
const identifier = z.string().uuid();

/** The existing artifact owner handles quota checks, receipts and tombstones. */
export interface SavedDataTransaction extends AuthorizationContextReader {
  readSavedDataStorage(): Promise<SavedDataStorageUsage>;
  getSavedArtifact(
    id: string,
    view?: SavedDataView,
  ): Promise<SavedDataRecordV2 | undefined>;
  listSavedArtifacts(
    query: SavedDataListQuery,
    view?: SavedDataView,
  ): Promise<SavedDataPageV2>;
  savedArtifactChanges(
    query: {
      after?: string;
      limit?: number;
    },
    view?: SavedDataView,
  ): Promise<SavedDataChangesV2>;
  saveSavedArtifact(
    input: SavedDataMutationV2,
    view?: SavedDataView,
  ): Promise<SavedDataRecordV2>;
  deleteSavedArtifact(
    id: string,
    input: SavedDataDeleteInput,
    view?: SavedDataView,
  ): Promise<SavedDataRecordV2>;
  importSavedArtifacts(
    input: SavedDataImportInputV2,
    view?: SavedDataView,
  ): Promise<SavedDataImportResultV2>;
  getNavigationKnowledgeSiteSettings?(
    origin: string,
  ): Promise<NavigationKnowledgeSiteSettings>;
  setNavigationKnowledgeSiteSettings?(
    input: NavigationKnowledgeSiteSettingsInput,
  ): Promise<NavigationKnowledgeSiteSettings>;
  navigationKnowledgeCandidates?(origin: string): Promise<SavedDataRecordV2[]>;
  forgetNavigationKnowledgeSite?(
    input: NavigationKnowledgeForgetSiteInput,
  ): Promise<NavigationKnowledgeForgetSiteResult>;
}
export type SavedDataRepositories =
  AuthorizedRepositories<SavedDataTransaction>;

/** Export enqueue and private-file delivery stay with the existing support owner. */
export interface SavedDataExports {
  requestSavedExport(
    scope: RepositoryScope,
    input: {
      idempotencyKey: string;
      payloadHash: string;
      ids: string[];
      schemaVersion?: 2;
    },
    signal?: AbortSignal,
  ): Promise<DiagnosticRecord>;
}

/** Saved library records never command or complete an installed browser journey. */
export class SavedDataService {
  constructor(
    private readonly repositories: SavedDataRepositories,
    private readonly exports?: SavedDataExports,
    private readonly environment: "development" | "production" = "production",
  ) {}

  get exportsAvailable() {
    return !!this.exports;
  }

  get writesAvailable() {
    return this.environment === "development";
  }

  private writable() {
    if (this.environment !== "development")
      throw new AuthorizationError(
        503,
        "UNAVAILABLE",
        "Cloud saved-data writes are unavailable in this deployment.",
      );
  }

  list(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
  ): Promise<SavedDataPage>;
  list(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
    view: SavedDataView,
  ): Promise<SavedDataPageV2>;
  list(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
    view: SavedDataView = 1,
  ) {
    const query = savedDataListQuerySchema.parse(rawQuery);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.read",
      async (repository) =>
        (view === 2 ? savedDataPageV2Schema : savedDataPageSchema).parse(
          await (view === 2
            ? repository.listSavedArtifacts(query, 2)
            : repository.listSavedArtifacts(query)),
        ),
      context,
    );
  }

  storage(
    principal: Principal,
    workspaceId: string,
    context: ServiceRequestContext,
  ) {
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.read",
      async (repository) =>
        savedDataStorageUsageSchema.parse(
          await repository.readSavedDataStorage(),
        ),
      context,
    );
  }

  get(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    context: ServiceRequestContext,
  ): Promise<SavedDataRecord>;
  get(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    context: ServiceRequestContext,
    view: SavedDataView,
  ): Promise<SavedDataRecordV2>;
  get(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    context: ServiceRequestContext,
    view: SavedDataView = 1,
  ) {
    const id = identifier.parse(artifactId);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.read",
      async (repository) => {
        const artifact = await (view === 2
          ? repository.getSavedArtifact(id, 2)
          : repository.getSavedArtifact(id));
        if (!artifact)
          throw new AuthorizationError(
            404,
            "NOT_FOUND",
            "The saved artifact is unavailable.",
          );
        return (
          view === 2 ? savedDataRecordV2Schema : savedDataRecordSchema
        ).parse(artifact);
      },
      context,
    );
  }

  create(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ): Promise<SavedDataRecord>;
  create(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
    view: SavedDataView,
  ): Promise<SavedDataRecordV2>;
  create(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
    view: SavedDataView = 1,
  ) {
    this.writable();
    const input = (
      view === 2 ? savedDataCreateV2Schema : savedDataCreateSchema
    ).parse(raw);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.write",
      async (repository) =>
        (view === 2 ? savedDataRecordV2Schema : savedDataRecordSchema).parse(
          await (view === 2
            ? repository.saveSavedArtifact(input, 2)
            : repository.saveSavedArtifact(input)),
        ),
      context,
    );
  }

  update(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ): Promise<SavedDataRecord>;
  update(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    raw: unknown,
    context: ServiceRequestContext,
    view: SavedDataView,
  ): Promise<SavedDataRecordV2>;
  update(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    raw: unknown,
    context: ServiceRequestContext,
    view: SavedDataView = 1,
  ) {
    this.writable();
    const id = identifier.parse(artifactId);
    const input = (
      view === 2 ? savedDataUpdateV2Schema : savedDataUpdateSchema
    ).parse(raw);
    if (input.artifact.id !== id)
      throw new AuthorizationError(
        400,
        "INVALID_REQUEST",
        "The saved artifact identifier does not match the update.",
      );
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.write",
      async (repository) =>
        (view === 2 ? savedDataRecordV2Schema : savedDataRecordSchema).parse(
          await (view === 2
            ? repository.saveSavedArtifact(input, 2)
            : repository.saveSavedArtifact(input)),
        ),
      context,
    );
  }

  delete(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ): Promise<SavedDataRecord>;
  delete(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    raw: unknown,
    context: ServiceRequestContext,
    view: SavedDataView,
  ): Promise<SavedDataRecordV2>;
  delete(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    raw: unknown,
    context: ServiceRequestContext,
    view: SavedDataView = 1,
  ) {
    const id = identifier.parse(artifactId);
    const input = savedDataDeleteInputSchema.parse(raw);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.delete",
      async (repository) =>
        (view === 2 ? savedDataRecordV2Schema : savedDataRecordSchema).parse(
          await (view === 2
            ? repository.deleteSavedArtifact(id, input, 2)
            : repository.deleteSavedArtifact(id, input)),
        ),
      context,
    );
  }

  changes(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
  ): Promise<SavedDataChanges>;
  changes(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
    view: SavedDataView,
  ): Promise<SavedDataChangesV2>;
  changes(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
    view: SavedDataView = 1,
  ) {
    const query = serviceSyncQuerySchema.parse(rawQuery);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.read",
      async (repository) =>
        (view === 2 ? savedDataChangesV2Schema : savedDataChangesSchema).parse(
          await (view === 2
            ? repository.savedArtifactChanges(query, 2)
            : repository.savedArtifactChanges(query)),
        ),
      context,
    );
  }

  import(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ): Promise<SavedDataImportResult>;
  import(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
    view: SavedDataView,
  ): Promise<SavedDataImportResultV2>;
  async import(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
    view: SavedDataView = 1,
  ) {
    this.writable();
    const input = (
      view === 2 ? savedDataImportInputV2Schema : savedDataImportInputSchema
    ).parse(raw);
    const scope = {
      accountId: identifier.parse(principal.accountId),
      workspaceId: identifier.parse(workspaceId),
    };
    context.signal.throwIfAborted();
    if (
      (await (view === 2
        ? savedDataImportHashV2(scope, input.items)
        : savedDataImportHash(
            scope,
            savedDataImportInputSchema.parse(input).items,
          ))) !== input.previewHash
    )
      throw new AuthorizationError(
        409,
        "CONFLICT",
        "The approved import preview no longer matches these artifacts and scope.",
      );
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.import",
      async (repository) =>
        (view === 2
          ? savedDataImportResultV2Schema
          : savedDataImportResultSchema
        ).parse(
          await (view === 2
            ? repository.importSavedArtifacts(input, 2)
            : repository.importSavedArtifacts(input)),
        ),
      context,
    );
  }

  async export(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
    view: SavedDataView = 1,
  ) {
    const input = savedDataExportInputSchema.parse(raw);
    if (!this.exports)
      throw new AuthorizationError(
        503,
        "UNAVAILABLE",
        "Saved-data export is unavailable in this deployment.",
      );
    const scope = {
      accountId: identifier.parse(principal.accountId),
      workspaceId: identifier.parse(workspaceId),
    };
    await withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.export",
      async () => undefined,
      context,
    );
    try {
      const requested = await this.exports.requestSavedExport(
        scope,
        {
          ...input,
          ...(view === 2 ? { schemaVersion: 2 as const } : {}),
          payloadHash: createHash("sha256")
            .update(
              JSON.stringify({
                operation: `saved-data.export.v${view}`,
                ids: input.ids,
              }),
            )
            .digest("hex"),
        },
        context.signal,
      );
      context.signal.throwIfAborted();
      return savedDataExportResultSchema.parse(requested);
    } catch (error) {
      return authorizationRepositoryFailure(error);
    }
  }

  siteSettings(
    principal: Principal,
    workspaceId: string,
    origin: string,
    context: ServiceRequestContext,
  ) {
    const parsed = navigationKnowledgeOriginSchema.parse(origin);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.read",
      async (repository) => {
        if (!repository.getNavigationKnowledgeSiteSettings)
          throw new AuthorizationError(
            503,
            "UNAVAILABLE",
            "Private site settings are unavailable.",
          );
        return navigationKnowledgeSiteSettingsSchema.parse(
          await repository.getNavigationKnowledgeSiteSettings(parsed),
        );
      },
      context,
    );
  }

  async updateSiteSettings(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const input = navigationKnowledgeSiteSettingsInputSchema.parse(raw);
    const current =
      input.collect || input.use
        ? await this.siteSettings(principal, workspaceId, input.origin, context)
        : undefined;
    if (current && current.revision !== input.expectedRevision)
      throw new AuthorizationError(
        409,
        "CONFLICT",
        "The site memory choice changed.",
      );
    const enabling = !!(
      (input.collect && !current?.collect) ||
      (input.use && !current?.use)
    );
    if (enabling) this.writable();
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      enabling ? "saved-data.write" : "saved-data.delete",
      async (repository) => {
        if (!repository.setNavigationKnowledgeSiteSettings)
          throw new AuthorizationError(
            503,
            "UNAVAILABLE",
            "Private site settings are unavailable.",
          );
        return navigationKnowledgeSiteSettingsSchema.parse(
          await repository.setNavigationKnowledgeSiteSettings(input),
        );
      },
      context,
    );
  }

  forgetSite(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const input = navigationKnowledgeForgetSiteInputSchema.parse(raw);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.delete",
      async (repository) => {
        if (!repository.forgetNavigationKnowledgeSite)
          throw new AuthorizationError(
            503,
            "UNAVAILABLE",
            "Private site deletion is unavailable.",
          );
        return navigationKnowledgeForgetSiteResultSchema.parse(
          await repository.forgetNavigationKnowledgeSite(input),
        );
      },
      context,
    );
  }

  async retrieveKnowledge(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const query = navigationKnowledgeQuerySchema.parse(raw);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.write",
      async (repository) => {
        if (
          !repository.getNavigationKnowledgeSiteSettings ||
          !repository.navigationKnowledgeCandidates
        )
          throw new AuthorizationError(
            503,
            "UNAVAILABLE",
            "Private navigation memory is unavailable.",
          );
        const settings = await repository.getNavigationKnowledgeSiteSettings(
          query.origin,
        );
        const ranked = settings.use
          ? await rankNavigationKnowledge(
              query,
              (
                await repository.navigationKnowledgeCandidates(query.origin)
              ).flatMap((record) =>
                record.schemaVersion === 2 && record.data
                  ? [
                      {
                        id: record.id,
                        revision: record.revision,
                        updatedAt: record.updatedAt,
                        data: record.data,
                      },
                    ]
                  : [],
              ),
              context.signal,
            )
          : {
              context: null,
              sources: [],
              siteSettings: null,
              diagnostics: {
                candidates: 0,
                selected: 0,
                omitted: 0,
                reason: "disabled" as const,
              },
            };
        const value = {
          ...ranked,
          siteSettings:
            settings.use && settings.revision !== "0"
              ? { origin: settings.origin, revision: settings.revision }
              : null,
          contextDigest: ranked.context
            ? (await serializeNavigationKnowledge(ranked.context)).digest
            : null,
        };
        context.signal.throwIfAborted();
        return retrievedNavigationKnowledgeSchema.parse({
          ...value,
          snapshotDigest: await navigationKnowledgeSnapshotDigest(query, value),
        });
      },
      context,
    );
  }

  revalidateKnowledge(
    principal: Principal,
    workspaceId: string,
    raw: RetrievedNavigationKnowledge,
    context: ServiceRequestContext,
  ) {
    const value = retrievedNavigationKnowledgeSchema.parse(raw);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.write",
      async (repository) => {
        if (value.siteSettings) {
          if (!repository.getNavigationKnowledgeSiteSettings)
            throw new AuthorizationError(
              503,
              "UNAVAILABLE",
              "Private site settings are unavailable.",
            );
          const current = await repository.getNavigationKnowledgeSiteSettings(
            value.siteSettings.origin,
          );
          if (!current.use || current.revision !== value.siteSettings.revision)
            throw new AuthorizationError(
              409,
              "CONFLICT",
              "The site memory choice changed.",
            );
        } else if (value.sources.length || value.context) {
          throw new AuthorizationError(
            409,
            "CONFLICT",
            "The site memory choice is unavailable.",
          );
        }
        for (const source of value.sources) {
          const record = await repository.getSavedArtifact(
            source.artifactId,
            2,
          );
          if (
            !record ||
            record.deletedAt ||
            record.schemaVersion !== 2 ||
            record.revision !== source.revision ||
            record.data?.origin !== value.siteSettings?.origin
          )
            throw new AuthorizationError(
              409,
              "CONFLICT",
              "Private navigation memory changed.",
            );
        }
        context.signal.throwIfAborted();
      },
      context,
    );
  }
}
