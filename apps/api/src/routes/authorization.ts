import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  authorizationPageQuerySchema,
  consentPageSchema,
  consentSchema,
  consentUpdateSchema,
  membershipPageSchema,
  membershipSchema,
  membershipUpdateSchema,
  policyCatalogSchema,
  workspacePageSchema,
} from "../../../../packages/navigation-core/contracts-authorization";
import type { AuthorizationService } from "../application/authorization";
import type { IdentityService } from "../application/identity";
import { createIdentityAccess, identityRouteSchema } from "./identity-access";

const workspaceParams = z.object({ workspaceId: z.string().uuid() }).strict();
const membershipParams = workspaceParams.extend({
  accountId: z.string().uuid(),
});

/** Client workspace IDs are selectors; the application resolves current authority. */
export async function registerAuthorizationApi(
  app: FastifyInstance,
  identity: IdentityService,
  authorization: AuthorizationService,
) {
  const { safe, authenticate, mutation } = createIdentityAccess(identity);
  const schema = (
    operationId: string,
    input: {
      params?: z.ZodTypeAny;
      query?: z.ZodTypeAny;
      body?: z.ZodTypeAny;
      response: z.ZodTypeAny;
    },
  ) => ({
    ...identityRouteSchema(operationId, {
      ...input,
      protected: true,
      tags: ["authorization"],
    }),
    ...(input.params
      ? { params: zodToJsonSchema(input.params, { target: "openApi3" }) }
      : {}),
  });

  app.get(
    "/api/v1/workspaces",
    {
      schema: schema("listAuthorizedWorkspaces", {
        query: authorizationPageQuerySchema,
        response: workspacePageSchema,
      }),
    },
    safe(async (request, _reply, context) =>
      authorization.listWorkspaces(
        (await authenticate(request)).session,
        request.query,
        context,
      ),
    ),
  );
  app.get(
    "/api/v1/workspaces/:workspaceId/memberships",
    {
      schema: schema("listWorkspaceMemberships", {
        params: workspaceParams,
        query: authorizationPageQuerySchema,
        response: membershipPageSchema,
      }),
    },
    safe(async (request, _reply, context) =>
      authorization.listMemberships(
        (await authenticate(request)).session,
        workspaceParams.parse(request.params).workspaceId,
        request.query,
        context,
      ),
    ),
  );
  app.patch(
    "/api/v1/workspaces/:workspaceId/memberships/:accountId",
    {
      bodyLimit: 8192,
      schema: schema("updateWorkspaceMembership", {
        params: membershipParams,
        body: membershipUpdateSchema,
        response: membershipSchema,
      }),
    },
    safe(async (request, _reply, context) => {
      const { session, bearer } = await authenticate(request);
      mutation(request, session, bearer);
      const { workspaceId, accountId } = membershipParams.parse(request.params);
      return authorization.updateMembership(
        session,
        workspaceId,
        accountId,
        request.body,
        context,
      );
    }),
  );
  app.get(
    "/api/v1/workspaces/:workspaceId/policies",
    {
      schema: schema("getWorkspacePolicies", {
        params: workspaceParams,
        response: policyCatalogSchema,
      }),
    },
    safe(async (request, _reply, context) =>
      authorization.policies(
        (await authenticate(request)).session,
        workspaceParams.parse(request.params).workspaceId,
        context,
      ),
    ),
  );
  app.get(
    "/api/v1/workspaces/:workspaceId/consents",
    {
      schema: schema("listWorkspaceConsents", {
        params: workspaceParams,
        response: consentPageSchema,
      }),
    },
    safe(async (request, _reply, context) =>
      authorization.listConsents(
        (await authenticate(request)).session,
        workspaceParams.parse(request.params).workspaceId,
        context,
      ),
    ),
  );
  app.post(
    "/api/v1/workspaces/:workspaceId/consents",
    {
      bodyLimit: 8192,
      schema: schema("recordWorkspaceConsent", {
        params: workspaceParams,
        body: consentUpdateSchema,
        response: consentSchema,
      }),
    },
    safe(async (request, _reply, context) => {
      const { session, bearer } = await authenticate(request);
      mutation(request, session, bearer);
      return authorization.recordConsent(
        session,
        workspaceParams.parse(request.params).workspaceId,
        request.body,
        context,
      );
    }),
  );
}
