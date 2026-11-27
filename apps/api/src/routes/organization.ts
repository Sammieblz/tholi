import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { z } from "zod";
import {
  organizationWorkflowPageSchema,
  organizationPublicationHistorySchema,
  publishedGuideQuerySchema,
  publishedGuideListSchema,
  publishedGuideStepSchema,
  organizationWorkflowSchema,
  organizationWorkflowDraftSchema,
  organizationWorkflowActionSchema,
  organizationPolicyRecordSchema,
  organizationPolicyInputSchema,
  knowledgeSourcePageSchema,
  knowledgeSourceSchema,
  knowledgeDocumentSchema,
  knowledgeQuerySchema,
  documentaryRetrievalSchema,
  knowledgeFileImportSchema,
  knowledgeSourceExportSchema,
  publicDocumentationCrawlSchema,
  publicDocumentationCrawlResultSchema,
} from "../../../../packages/navigation-core/contracts-organization";
import type { OrganizationService } from "../application/organization";
import type { IdentityService } from "../application/identity";
import { AuthorizationError } from "../application/authorization";
import { createIdentityAccess, identityRouteOptions } from "./identity-access";
import { serviceRevisionSchema } from "../../../../packages/navigation-core/contracts-service";

/** Native and website sessions use the same account binding and CSRF boundary. */
export async function registerOrganizationApi(
  app: FastifyInstance,
  identity: IdentityService,
  service: OrganizationService,
) {
  const { protect, safe, protectedSession } = createIdentityAccess(identity);
  // Admit a single document body per replica before parsing it. Late close
  // events cannot release a newer request's slot.
  let activeImport: symbol | undefined;
  const admitImport = async (_request: FastifyRequest, reply: FastifyReply) => {
    if (activeImport)
      throw new AuthorizationError(
        429,
        "RATE_LIMITED",
        "Another document import is in progress. Try again after it finishes.",
      );
    const token = Symbol();
    activeImport = token;
    const release = () => {
      if (activeImport === token) activeImport = undefined;
    };
    reply.raw.once("finish", release);
    reply.raw.once("close", release);
  };
  const base = "/api/v1/workspaces/:workspaceId/organization";
  const params = z.object({ workspaceId: z.string().uuid() }).strict();
  const resource = params.extend({ id: z.string().uuid() }).strict();
  const options = (
    operationId: string,
    response: z.ZodTypeAny,
    body?: z.ZodTypeAny,
    item = false,
  ) =>
    identityRouteOptions(operationId, {
      protected: true,
      requireAccountBinding: true,
      tags: ["organizations"],
      params: item ? resource : params,
      response,
      ...(body ? { body } : {}),
    });
  app.get(
    `${base}/policy`,
    {
      onRequest: protect(),
      ...options("getOrganizationPilotPolicy", organizationPolicyRecordSchema),
    },
    safe((request, _reply, context) =>
      service.policy(
        protectedSession(request),
        params.parse(request.params).workspaceId,
        context,
      ),
    ),
  );
  app.patch(
    `${base}/policy`,
    {
      onRequest: protect(true),
      ...options(
        "updateOrganizationPilotPolicy",
        organizationPolicyRecordSchema,
        organizationPolicyInputSchema,
      ),
    },
    safe((request, _reply, context) =>
      service.setPolicy(
        protectedSession(request),
        params.parse(request.params).workspaceId,
        request.body,
        context,
      ),
    ),
  );
  app.get(
    `${base}/workflows/:id/publications`,
    {
      onRequest: protect(),
      ...options(
        "listOrganizationPublications",
        organizationPublicationHistorySchema,
        undefined,
        true,
      ),
    },
    safe((request, _reply, context) => {
      const { workspaceId, id } = resource.parse(request.params);
      return service.history(
        protectedSession(request),
        workspaceId,
        id,
        context,
      );
    }),
  );
  app.post(
    `${base}/guide-lookup`,
    {
      onRequest: protect(true),
      ...options(
        "lookupPublishedOrganizationGuide",
        z.union([publishedGuideListSchema, publishedGuideStepSchema]),
        publishedGuideQuerySchema,
      ),
    },
    safe((request, _reply, context) =>
      service.publishedGuide(
        protectedSession(request),
        params.parse(request.params).workspaceId,
        request.body,
        context,
      ),
    ),
  );
  for (const publishedOnly of [false, true])
    app.get(
      `${base}/${publishedOnly ? "published-workflows" : "workflows"}`,
      {
        onRequest: protect(),
        ...options(
          publishedOnly
            ? "listPublishedOrganizationWorkflows"
            : "listOrganizationWorkflowDrafts",
          organizationWorkflowPageSchema,
        ),
      },
      safe((request, _reply, context) =>
        service.workflows(
          protectedSession(request),
          params.parse(request.params).workspaceId,
          publishedOnly,
          context,
        ),
      ),
    );
  app.post(
    `${base}/workflows/:id`,
    {
      onRequest: protect(true),
      bodyLimit: 32768,
      ...options(
        "saveOrganizationWorkflowDraft",
        organizationWorkflowSchema,
        organizationWorkflowDraftSchema,
        true,
      ),
    },
    safe((request, _reply, context) => {
      const { workspaceId, id } = resource.parse(request.params);
      return service.saveWorkflow(
        protectedSession(request),
        workspaceId,
        id,
        request.body,
        context,
      );
    }),
  );
  app.post(
    `${base}/workflows/:id/actions`,
    {
      onRequest: protect(true),
      ...options(
        "transitionOrganizationWorkflow",
        organizationWorkflowSchema,
        organizationWorkflowActionSchema,
        true,
      ),
    },
    safe((request, _reply, context) => {
      const { workspaceId, id } = resource.parse(request.params);
      return service.actWorkflow(
        protectedSession(request),
        workspaceId,
        id,
        request.body,
        context,
      );
    }),
  );
  app.get(
    `${base}/sources`,
    {
      onRequest: protect(),
      ...options("listOrganizationKnowledgeSources", knowledgeSourcePageSchema),
    },
    safe((request, _reply, context) =>
      service.sources(
        protectedSession(request),
        params.parse(request.params).workspaceId,
        context,
      ),
    ),
  );
  app.get(
    `${base}/sources/:id`,
    {
      onRequest: protect(),
      ...options(
        "exportOrganizationKnowledgeSource",
        knowledgeSourceExportSchema,
        undefined,
        true,
      ),
    },
    safe((request, _reply, context) => {
      const { workspaceId, id } = resource.parse(request.params);
      return service.source(
        protectedSession(request),
        workspaceId,
        id,
        context,
      );
    }),
  );
  app.post(
    `${base}/sources`,
    {
      onRequest: [protect(true), admitImport],
      bodyLimit: 2 * 1024 * 1024,
      ...options(
        "importOrganizationKnowledgeText",
        knowledgeSourceSchema,
        knowledgeDocumentSchema,
      ),
    },
    safe((request, _reply, context) =>
      service.saveSource(
        protectedSession(request),
        params.parse(request.params).workspaceId,
        request.body,
        context,
      ),
    ),
  );
  if (service.importsAvailable)
    app.post(
      `${base}/imports`,
      {
        onRequest: [protect(true), admitImport],
        bodyLimit: 3 * 1024 * 1024,
        ...options(
          "convertOrganizationKnowledgeFile",
          knowledgeSourceSchema,
          knowledgeFileImportSchema,
        ),
      },
      safe((request, _reply, context) =>
        service.importFile(
          protectedSession(request),
          params.parse(request.params).workspaceId,
          request.body,
          context,
        ),
      ),
    );
  if (service.publicCrawlingAvailable)
    app.post(
      base + "/crawl",
      {
        onRequest: [protect(true), admitImport],
        bodyLimit: 4096,
        ...options(
          "crawlApprovedPublicDocumentation",
          publicDocumentationCrawlResultSchema,
          publicDocumentationCrawlSchema,
        ),
      },
      safe((request, _reply, context) =>
        service.crawlPublicDocumentation(
          protectedSession(request),
          params.parse(request.params).workspaceId,
          request.body,
          context,
        ),
      ),
    );
  app.delete(
    `${base}/sources/:id`,
    {
      onRequest: protect(true),
      ...options(
        "forgetOrganizationKnowledgeSource",
        z.object({ deleted: z.literal(true) }).strict(),
        z.object({ expectedRevision: serviceRevisionSchema }).strict(),
        true,
      ),
    },
    safe(async (request, _reply, context) => {
      const { workspaceId, id } = resource.parse(request.params);
      const { expectedRevision } = z
        .object({ expectedRevision: serviceRevisionSchema })
        .parse(request.body);
      await service.deleteSource(
        protectedSession(request),
        workspaceId,
        id,
        expectedRevision,
        context,
      );
      return { deleted: true };
    }),
  );
  app.post(
    `${base}/retrieve`,
    {
      onRequest: protect(true),
      ...options(
        "retrieveOrganizationDocumentation",
        documentaryRetrievalSchema,
        knowledgeQuerySchema,
      ),
    },
    safe((request, _reply, context) =>
      service.retrieve(
        protectedSession(request),
        params.parse(request.params).workspaceId,
        request.body,
        context,
      ),
    ),
  );
}
