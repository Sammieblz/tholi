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
  type SavedDataChanges,
  type SavedDataDeleteInput,
  type SavedDataImportInput,
  type SavedDataImportResult,
  type SavedDataListQuery,
  type SavedDataMutation,
  type SavedDataPage,
  type SavedDataRecord,
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

type Principal = Pick<IdentitySession, "accountId">;
const identifier = z.string().uuid();

/** The existing artifact owner handles quota checks, receipts and tombstones. */
export interface SavedDataTransaction extends AuthorizationContextReader {
  getSavedArtifact(id: string): Promise<SavedDataRecord | undefined>;
  listSavedArtifacts(query: SavedDataListQuery): Promise<SavedDataPage>;
  savedArtifactChanges(query: {
    after?: string;
    limit?: number;
  }): Promise<SavedDataChanges>;
  saveSavedArtifact(input: SavedDataMutation): Promise<SavedDataRecord>;
  deleteSavedArtifact(
    id: string,
    input: SavedDataDeleteInput,
  ): Promise<SavedDataRecord>;
  importSavedArtifacts(
    input: SavedDataImportInput,
  ): Promise<SavedDataImportResult>;
}
export type SavedDataRepositories =
  AuthorizedRepositories<SavedDataTransaction>;

/** Export enqueue and private-file delivery stay with the existing support owner. */
export interface SavedDataExports {
  requestSavedExport(
    scope: RepositoryScope,
    input: { idempotencyKey: string; payloadHash: string; ids: string[] },
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
  ) {
    const query = savedDataListQuerySchema.parse(rawQuery);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.read",
      async (repository) =>
        savedDataPageSchema.parse(await repository.listSavedArtifacts(query)),
      context,
    );
  }

  get(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    context: ServiceRequestContext,
  ) {
    const id = identifier.parse(artifactId);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.read",
      async (repository) => {
        const artifact = await repository.getSavedArtifact(id);
        if (!artifact)
          throw new AuthorizationError(
            404,
            "NOT_FOUND",
            "The saved artifact is unavailable.",
          );
        return savedDataRecordSchema.parse(artifact);
      },
      context,
    );
  }

  create(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    this.writable();
    const input = savedDataCreateSchema.parse(raw);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.write",
      async (repository) =>
        savedDataRecordSchema.parse(await repository.saveSavedArtifact(input)),
      context,
    );
  }

  update(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    this.writable();
    const id = identifier.parse(artifactId);
    const input = savedDataUpdateSchema.parse(raw);
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
        savedDataRecordSchema.parse(await repository.saveSavedArtifact(input)),
      context,
    );
  }

  delete(
    principal: Principal,
    workspaceId: string,
    artifactId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    const id = identifier.parse(artifactId);
    const input = savedDataDeleteInputSchema.parse(raw);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.delete",
      async (repository) =>
        savedDataRecordSchema.parse(
          await repository.deleteSavedArtifact(id, input),
        ),
      context,
    );
  }

  changes(
    principal: Principal,
    workspaceId: string,
    rawQuery: unknown,
    context: ServiceRequestContext,
  ) {
    const query = serviceSyncQuerySchema.parse(rawQuery);
    return withAuthorization(
      this.repositories,
      principal,
      workspaceId,
      "saved-data.read",
      async (repository) =>
        savedDataChangesSchema.parse(
          await repository.savedArtifactChanges(query),
        ),
      context,
    );
  }

  async import(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
  ) {
    this.writable();
    const input = savedDataImportInputSchema.parse(raw);
    const scope = {
      accountId: identifier.parse(principal.accountId),
      workspaceId: identifier.parse(workspaceId),
    };
    context.signal.throwIfAborted();
    if ((await savedDataImportHash(scope, input.items)) !== input.previewHash)
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
        savedDataImportResultSchema.parse(
          await repository.importSavedArtifacts(input),
        ),
      context,
    );
  }

  async export(
    principal: Principal,
    workspaceId: string,
    raw: unknown,
    context: ServiceRequestContext,
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
          payloadHash: createHash("sha256")
            .update(
              JSON.stringify({
                operation: "saved-data.export.v1",
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
}
