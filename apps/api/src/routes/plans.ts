import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  enrollFreeInputSchema,
  freeEnrollmentSchema,
  productCatalogSchema,
  productCatalogV2Schema,
  productEntitlementsSchema,
} from "../../../../packages/navigation-core/contracts-plans";
import type { IdentityService } from "../application/identity";
import type { IdentitySession } from "../application/identity-contracts";
import type { PlanService } from "../application/plans";
import { serviceSchemaVersionQuerySchema } from "../../../../packages/navigation-core/contracts-service";
import { createIdentityAccess, identityRouteOptions } from "./identity-access";

const workspaceParams = z.object({ workspaceId: z.string().uuid() }).strict();
const catalogQuery = z
  .object({ schemaVersion: serviceSchemaVersionQuerySchema.default(1) })
  .strict();

/** Catalog reads grant no account, entitlement or provider authority. */
export async function registerPlansApi(
  app: FastifyInstance,
  identity: IdentityService,
  plans: PlanService,
) {
  const { safe, authenticate, mutation } = createIdentityAccess(identity);
  const sessions = new WeakMap<FastifyRequest, IdentitySession>();
  const early = (write = false) =>
    safe(async (request) => {
      const { session, bearer } = await authenticate(request);
      if (write) mutation(request, session, bearer);
      sessions.set(request, session);
    });
  const schema = (
    operationId: string,
    response: z.ZodTypeAny,
    input: {
      protected?: boolean;
      body?: z.ZodTypeAny;
      query?: z.ZodTypeAny;
    } = {},
  ) =>
    identityRouteOptions(operationId, {
      ...input,
      tags: ["plans"],
      response,
      ...(input.protected
        ? { params: workspaceParams }
        : {
            description:
              "Read public plan availability. This grants no account access, allowance or installation capability.",
          }),
    });
  app.get(
    "/api/v1/plans",
    schema(
      "listPublishedPlans",
      z.union([productCatalogSchema, productCatalogV2Schema]),
      { query: catalogQuery },
    ),
    safe((request, _reply, context) =>
      plans.catalog(context, catalogQuery.parse(request.query).schemaVersion),
    ),
  );
  app.get(
    "/api/v1/workspaces/:workspaceId/entitlements",
    {
      onRequest: early(),
      ...schema("getWorkspaceEntitlements", productEntitlementsSchema, {
        protected: true,
      }),
    },
    safe((request, _reply, context) =>
      plans.entitlements(
        sessions.get(request)!,
        workspaceParams.parse(request.params).workspaceId,
        context,
      ),
    ),
  );
  app.post(
    "/api/v1/workspaces/:workspaceId/entitlements/free",
    {
      onRequest: early(true),
      bodyLimit: 1024,
      ...schema("enrollWorkspaceFreePlan", freeEnrollmentSchema, {
        protected: true,
        body: enrollFreeInputSchema,
      }),
    },
    safe((request, _reply, context) =>
      plans.enrollFree(
        sessions.get(request)!,
        workspaceParams.parse(request.params).workspaceId,
        request.body,
        context,
      ),
    ),
  );
}
