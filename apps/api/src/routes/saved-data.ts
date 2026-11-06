import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  SAVED_DATA_LIMITS,
  savedDataDeleteInputSchema,
  savedDataExportInputSchema,
  savedDataExportResultSchema,
  savedDataStorageUsageSchema,
} from "../../../../packages/navigation-core/contracts-saved-data";
import {
  savedDataViewSchema,
  savedDataViewQuerySchema,
  savedDataNegotiatedListQuerySchema,
  savedDataRecordV2Schema,
  savedDataCreateV2Schema,
  savedDataUpdateV2Schema,
  savedDataPageV2Schema,
  savedDataChangesV2Schema,
  savedDataImportInputV2Schema,
  savedDataImportResultV2Schema,
} from "../../../../packages/navigation-core/contracts-saved-data";
import {
  navigationKnowledgeOriginSchema,
  navigationKnowledgeQuerySchema,
  navigationKnowledgeSiteSettingsSchema,
  navigationKnowledgeSiteSettingsInputSchema,
  retrievedNavigationKnowledgeSchema,
  navigationKnowledgeForgetSiteInputSchema,
  navigationKnowledgeForgetSiteResultSchema,
} from "../../../../packages/navigation-core/contracts-navigation-knowledge";
import { serviceSyncQuerySchema } from "../../../../packages/navigation-core/contracts-service";
import type { IdentityService } from "../application/identity";
import type { SavedDataService } from "../application/saved-data";
import { AuthorizationError } from "../application/authorization";
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
  const { safe, protect, protectedSession } = createIdentityAccess(identity);
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
      query: input.query ?? savedDataViewQuerySchema,
    });
  const workspace = (request: FastifyRequest) =>
    workspaceParams.parse(request.params).workspaceId;
  const artifacts = "/api/v1/workspaces/:workspaceId/artifacts";
  const view = (request: FastifyRequest) =>
    savedDataViewSchema.parse(
      (request.query as { schemaVersion?: unknown } | undefined)
        ?.schemaVersion ?? 1,
    );
  const query = (request: FastifyRequest) => {
    const { schemaVersion: _view, ...value } = request.query as Record<
      string,
      unknown
    >;
    return value;
  };
  const requireV2 = (request: FastifyRequest) => {
    if (view(request) !== 2)
      throw new AuthorizationError(
        400,
        "INVALID_REQUEST",
        "This operation requires saved-data schema version 2.",
      );
  };

  app.get(
    `${artifacts}/usage`,
    {
      onRequest: protect(),
      ...options("getSavedDataStorageUsage", savedDataStorageUsageSchema),
    },
    safe((request, _reply, context) =>
      savedData.storage(protectedSession(request), workspace(request), context),
    ),
  );

  app.get(
    artifacts,
    {
      onRequest: protect(),
      ...options("listSavedArtifacts", savedDataPageV2Schema, {
        query: savedDataNegotiatedListQuerySchema,
      }),
    },
    safe((request, _reply, context) =>
      savedData.list(
        protectedSession(request),
        workspace(request),
        query(request),
        context,
        view(request),
      ),
    ),
  );

  app.post(
    artifacts,
    {
      onRequest: protect(true),
      bodyLimit: SAVED_DATA_LIMITS.itemBytes + 2048,
      ...options("createSavedArtifact", savedDataRecordV2Schema, {
        body: savedDataCreateV2Schema,
      }),
    },
    safe((request, _reply, context) =>
      savedData.create(
        protectedSession(request),
        workspace(request),
        request.body,
        context,
        view(request),
      ),
    ),
  );

  app.get(
    `${artifacts}/search`,
    {
      onRequest: protect(),
      ...options("searchSavedArtifacts", savedDataPageV2Schema, {
        query: savedDataNegotiatedListQuerySchema,
      }),
    },
    safe((request, _reply, context) =>
      savedData.list(
        protectedSession(request),
        workspace(request),
        query(request),
        context,
        view(request),
      ),
    ),
  );

  app.post(
    `${artifacts}/export`,
    {
      onRequest: protect(true),
      bodyLimit: 2048,
      ...options("exportSavedArtifacts", savedDataExportResultSchema, {
        body: savedDataExportInputSchema,
      }),
    },
    safe((request, _reply, context) =>
      savedData.export(
        protectedSession(request),
        workspace(request),
        request.body,
        context,
        view(request),
      ),
    ),
  );

  app.get(
    `${artifacts}/site-settings`,
    {
      onRequest: protect(),
      ...options(
        "getNavigationKnowledgeSiteSettings",
        navigationKnowledgeSiteSettingsSchema,
        {
          query: savedDataViewQuerySchema.extend({
            origin: navigationKnowledgeOriginSchema,
          }),
        },
      ),
    },
    safe((request, _reply, context) => {
      requireV2(request);
      return savedData.siteSettings(
        protectedSession(request),
        workspace(request),
        navigationKnowledgeOriginSchema.parse(
          (request.query as { origin: unknown }).origin,
        ),
        context,
      );
    }),
  );
  app.patch(
    `${artifacts}/site-settings`,
    {
      onRequest: protect(true),
      bodyLimit: 2048,
      ...options(
        "updateNavigationKnowledgeSiteSettings",
        navigationKnowledgeSiteSettingsSchema,
        {
          body: navigationKnowledgeSiteSettingsInputSchema,
        },
      ),
    },
    safe((request, _reply, context) => {
      requireV2(request);
      return savedData.updateSiteSettings(
        protectedSession(request),
        workspace(request),
        request.body,
        context,
      );
    }),
  );
  app.delete(
    `${artifacts}/site-settings`,
    {
      onRequest: protect(true),
      bodyLimit: 2048,
      ...options(
        "forgetNavigationKnowledgeSite",
        navigationKnowledgeForgetSiteResultSchema,
        { body: navigationKnowledgeForgetSiteInputSchema },
      ),
    },
    safe((request, _reply, context) => {
      requireV2(request);
      return savedData.forgetSite(
        protectedSession(request),
        workspace(request),
        request.body,
        context,
      );
    }),
  );
  app.post(
    `${artifacts}/navigation-knowledge`,
    {
      onRequest: protect(true),
      bodyLimit: 12288,
      ...options(
        "retrieveNavigationKnowledge",
        retrievedNavigationKnowledgeSchema,
        { body: navigationKnowledgeQuerySchema },
      ),
    },
    safe((request, _reply, context) => {
      requireV2(request);
      return savedData.retrieveKnowledge(
        protectedSession(request),
        workspace(request),
        request.body,
        context,
      );
    }),
  );

  app.get(
    `${artifacts}/:artifactId`,
    {
      onRequest: protect(),
      ...options("getSavedArtifact", savedDataRecordV2Schema, {
        artifact: true,
      }),
    },
    safe((request, _reply, context) => {
      const params = artifactParams.parse(request.params);
      return savedData.get(
        protectedSession(request),
        params.workspaceId,
        params.artifactId,
        context,
        view(request),
      );
    }),
  );

  app.patch(
    `${artifacts}/:artifactId`,
    {
      onRequest: protect(true),
      bodyLimit: SAVED_DATA_LIMITS.itemBytes + 2048,
      ...options("updateSavedArtifact", savedDataRecordV2Schema, {
        artifact: true,
        body: savedDataUpdateV2Schema,
      }),
    },
    safe((request, _reply, context) => {
      const params = artifactParams.parse(request.params);
      return savedData.update(
        protectedSession(request),
        params.workspaceId,
        params.artifactId,
        request.body,
        context,
        view(request),
      );
    }),
  );

  app.delete(
    `${artifacts}/:artifactId`,
    {
      onRequest: protect(true),
      bodyLimit: 1024,
      ...options("deleteSavedArtifact", savedDataRecordV2Schema, {
        artifact: true,
        body: savedDataDeleteInputSchema,
      }),
    },
    safe((request, _reply, context) => {
      const params = artifactParams.parse(request.params);
      return savedData.delete(
        protectedSession(request),
        params.workspaceId,
        params.artifactId,
        request.body,
        context,
        view(request),
      );
    }),
  );

  app.get(
    "/api/v1/workspaces/:workspaceId/sync/changes",
    {
      onRequest: protect(),
      ...options("getSavedArtifactChanges", savedDataChangesV2Schema, {
        query: serviceSyncQuerySchema.extend({
          schemaVersion: savedDataViewSchema.optional(),
        }),
      }),
    },
    safe((request, _reply, context) =>
      savedData.changes(
        protectedSession(request),
        workspace(request),
        query(request),
        context,
        view(request),
      ),
    ),
  );

  app.post(
    "/api/v1/workspaces/:workspaceId/sync/import",
    {
      onRequest: protect(true),
      bodyLimit: SAVED_DATA_LIMITS.importBytes,
      ...options("importSavedArtifacts", savedDataImportResultV2Schema, {
        body: savedDataImportInputV2Schema,
      }),
    },
    safe((request, _reply, context) =>
      savedData.import(
        protectedSession(request),
        workspace(request),
        request.body,
        context,
        view(request),
      ),
    ),
  );
}
