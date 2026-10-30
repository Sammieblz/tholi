import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  PRODUCT_ANALYTICS_LIMITS,
  productAnalyticsDeletedSchema,
  productAnalyticsPageSchema,
  productAnalyticsQuerySchema,
  productAnalyticsReceiptSchema,
  recordProductEventInputSchema,
} from "../../../../packages/navigation-core/contracts-analytics";
import type { ProductAnalyticsService } from "../application/analytics";
import type { IdentityService } from "../application/identity";
import { AuthorizationError } from "../application/authorization";
import { createIdentityAccess, identityRouteSchema } from "./identity-access";

const params = z.object({ workspaceId: z.string().uuid() }).strict();
export async function registerAnalyticsApi(
  app: FastifyInstance,
  identity: IdentityService,
  analytics: ProductAnalyticsService,
) {
  const { safe, authenticate, mutation } = createIdentityAccess(identity);
  const schema = (
    operationId: string,
    response: z.ZodTypeAny,
    input: { query?: z.ZodTypeAny; body?: z.ZodTypeAny } = {},
  ) => ({
    ...identityRouteSchema(operationId, {
      ...input,
      response,
      protected: true,
      tags: ["analytics"],
    }),
    params: zodToJsonSchema(params, { target: "openApi3" }),
  });
  const path = "/api/v1/workspaces/:workspaceId/analytics/events";
  app.post(
    path,
    {
      bodyLimit: PRODUCT_ANALYTICS_LIMITS.maxBodyBytes,
      schema: schema(
        "recordProductAnalyticsEvent",
        productAnalyticsReceiptSchema,
        { body: recordProductEventInputSchema },
      ),
    },
    safe(async (request, reply, context) => {
      const { session, bearer } = await authenticate(request);
      mutation(request, session, bearer);
      try {
        return await analytics.record(
          session,
          params.parse(request.params).workspaceId,
          request.body,
          context,
        );
      } catch (error) {
        if (error instanceof AuthorizationError && error.statusCode === 429)
          reply.header("Retry-After", "86400");
        throw error;
      }
    }),
  );
  app.get(
    path,
    {
      schema: schema(
        "exportProductAnalyticsEvents",
        productAnalyticsPageSchema,
        { query: productAnalyticsQuerySchema },
      ),
    },
    safe(async (request, _reply, context) =>
      analytics.list(
        (await authenticate(request)).session,
        params.parse(request.params).workspaceId,
        request.query,
        context,
      ),
    ),
  );
  app.delete(
    path,
    {
      schema: schema(
        "deleteProductAnalyticsEvents",
        productAnalyticsDeletedSchema,
      ),
    },
    safe(async (request, _reply, context) => {
      const { session, bearer } = await authenticate(request);
      mutation(request, session, bearer);
      return analytics.delete(
        session,
        params.parse(request.params).workspaceId,
        context,
      );
    }),
  );
}
