import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  SAVED_DATA_LIMITS,
  savedDataChangesSchema,
  savedDataCreateSchema,
  savedDataDeleteInputSchema,
  savedDataExportInputSchema,
  savedDataExportResultSchema,
  savedDataImportInputSchema,
  savedDataImportResultSchema,
  savedDataListQuerySchema,
  savedDataPageSchema,
  savedDataRecordSchema,
  savedDataUpdateSchema,
} from "../../../../packages/navigation-core/contracts-saved-data";
import { serviceSyncQuerySchema } from "../../../../packages/navigation-core/contracts-service";
import type { IdentityService } from "../application/identity";
import type { IdentitySession } from "../application/identity-contracts";
import type { SavedDataService } from "../application/saved-data";
import { createIdentityAccess, identityRouteOptions } from "./identity-access";

const workspaceParams = z.object({ workspaceId: z.string().uuid() }).strict();
const artifactParams = workspaceParams
  .extend({ artifactId: z.string().uuid() })
  .strict();

/** Explicit library operations never issue browser or journey commands. */
export async function registerSavedDataApi(
  app: FastifyInstance,
  identity: IdentityService,
  savedData: SavedDataService,
) {
  const { safe, authenticate, mutation } = createIdentityAccess(identity);
  const sessions = new WeakMap<FastifyRequest, IdentitySession>();
  const early = (write = false) =>
    safe(async (request) => {
      const { session, bearer } = await authenticate(request, {
        requireAccountBinding: true,
      });
      if (write) mutation(request, session, bearer);
      sessions.set(request, session);
    });
  const options = (
    operationId: string,
    response: z.ZodTypeAny,
    input: {
      body?: z.ZodTypeAny;
      query?: z.ZodTypeAny;
      artifact?: boolean;
    } = {},
  ) =>
    identityRouteOptions(operationId, {
      protected: true,
      requireAccountBinding: true,
      tags: ["saved-data"],
      params: input.artifact ? artifactParams : workspaceParams,
      response,
      ...(input.body ? { body: input.body } : {}),
      ...(input.query ? { query: input.query } : {}),
    });
  const workspace = (request: FastifyRequest) =>
    workspaceParams.parse(request.params).workspaceId;
  const artifacts = "/api/v1/workspaces/:workspaceId/artifacts";

  app.get(
    artifacts,
    {
      onRequest: early(),
      ...options("listSavedArtifacts", savedDataPageSchema, {
        query: savedDataListQuerySchema,
      }),
    },
    safe((request, _reply, context) =>
      savedData.list(
        sessions.get(request)!,
        workspace(request),
        request.query,
        context,
      ),
    ),
  );

  app.post(
    artifacts,
    {
      onRequest: early(true),
      bodyLimit: SAVED_DATA_LIMITS.itemBytes + 2048,
      ...options("createSavedArtifact", savedDataRecordSchema, {
        body: savedDataCreateSchema,
      }),
    },
    safe((request, _reply, context) =>
      savedData.create(
        sessions.get(request)!,
        workspace(request),
        request.body,
        context,
      ),
    ),
  );

  app.get(
    `${artifacts}/search`,
    {
      onRequest: early(),
      ...options("searchSavedArtifacts", savedDataPageSchema, {
        query: savedDataListQuerySchema,
      }),
    },
    safe((request, _reply, context) =>
      savedData.list(
        sessions.get(request)!,
        workspace(request),
        request.query,
        context,
      ),
    ),
  );

  app.post(
    `${artifacts}/export`,
    {
      onRequest: early(true),
      bodyLimit: 2048,
      ...options("exportSavedArtifacts", savedDataExportResultSchema, {
        body: savedDataExportInputSchema,
      }),
    },
    safe((request, _reply, context) =>
      savedData.export(
        sessions.get(request)!,
        workspace(request),
        request.body,
        context,
      ),
    ),
  );

  app.get(
    `${artifacts}/:artifactId`,
    {
      onRequest: early(),
      ...options("getSavedArtifact", savedDataRecordSchema, { artifact: true }),
    },
    safe((request, _reply, context) => {
      const params = artifactParams.parse(request.params);
      return savedData.get(
        sessions.get(request)!,
        params.workspaceId,
        params.artifactId,
        context,
      );
    }),
  );

  app.patch(
    `${artifacts}/:artifactId`,
    {
      onRequest: early(true),
      bodyLimit: SAVED_DATA_LIMITS.itemBytes + 2048,
      ...options("updateSavedArtifact", savedDataRecordSchema, {
        artifact: true,
        body: savedDataUpdateSchema,
      }),
    },
    safe((request, _reply, context) => {
      const params = artifactParams.parse(request.params);
      return savedData.update(
        sessions.get(request)!,
        params.workspaceId,
        params.artifactId,
        request.body,
        context,
      );
    }),
  );

  app.delete(
    `${artifacts}/:artifactId`,
    {
      onRequest: early(true),
      bodyLimit: 1024,
      ...options("deleteSavedArtifact", savedDataRecordSchema, {
        artifact: true,
        body: savedDataDeleteInputSchema,
      }),
    },
    safe((request, _reply, context) => {
      const params = artifactParams.parse(request.params);
      return savedData.delete(
        sessions.get(request)!,
        params.workspaceId,
        params.artifactId,
        request.body,
        context,
      );
    }),
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/sync/changes",
    {
      onRequest: early(),
      ...options("getSavedArtifactChanges", savedDataChangesSchema, {
        query: serviceSyncQuerySchema,
      }),
    },
    safe((request, _reply, context) =>
      savedData.changes(
        sessions.get(request)!,
        workspace(request),
        request.query,
        context,
      ),
    ),
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/sync/import",
    {
      onRequest: early(true),
      bodyLimit: SAVED_DATA_LIMITS.importBytes,
      ...options("importSavedArtifacts", savedDataImportResultSchema, {
        body: savedDataImportInputSchema,
      }),
    },
    safe((request, _reply, context) =>
      savedData.import(
        sessions.get(request)!,
        workspace(request),
        request.body,
        context,
      ),
    ),
  );
}
