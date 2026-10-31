import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  creditHistoryPageSchema,
  creditPageQuerySchema,
  creditUsagePageSchema,
  workspaceCreditsSchema,
} from "../../../../packages/navigation-core/contracts-credits";
import type { IdentityService } from "../application/identity";
import type { IdentitySession } from "../application/identity-contracts";
import type { CreditService } from "../application/quotas";
import { createIdentityAccess, identityRouteSchema } from "./identity-access";

const workspaceParams = z.object({ workspaceId: z.string().uuid() }).strict();

/** Read-only accounting never authorizes grants, settlement or model execution. */
export async function registerCreditsApi(
  app: FastifyInstance,
  identity: IdentityService,
  credits: CreditService,
) {
  const { safe, authenticate } = createIdentityAccess(identity);
  const sessions = new WeakMap<FastifyRequest, IdentitySession>();
  const early = safe(async (request) => {
    sessions.set(request, (await authenticate(request)).session);
  });
  const schema = (
    operationId: string,
    response: z.ZodTypeAny,
    paged = false,
  ) => {
    const contract = (target: "openApi3" | "jsonSchema7") => ({
      ...identityRouteSchema(
        operationId,
        {
          protected: true,
          tags: ["credits", "usage"],
          response,
          ...(paged ? { query: creditPageQuerySchema } : {}),
        },
        target,
      ),
      params: zodToJsonSchema(workspaceParams, { target }),
    });
    return {
      schema: contract("jsonSchema7"),
      config: {
        swaggerTransform: ({ url }: { url: string }) => ({
          url,
          schema: contract("openApi3"),
        }),
      },
    };
  };
  app.get(
    "/api/v1/workspaces/:workspaceId/credits",
    {
      onRequest: early,
      ...schema("getWorkspaceCredits", workspaceCreditsSchema),
    },
    safe(async (request, _reply, context) =>
      credits.balance(
        sessions.get(request)!,
        workspaceParams.parse(request.params).workspaceId,
        context,
      ),
    ),
  );
  app.get(
    "/api/v1/workspaces/:workspaceId/credits/events",
    {
      onRequest: early,
      ...schema("listWorkspaceCreditEvents", creditHistoryPageSchema, true),
    },
    safe(async (request, _reply, context) =>
      credits.history(
        sessions.get(request)!,
        workspaceParams.parse(request.params).workspaceId,
        request.query,
        context,
      ),
    ),
  );
  app.get(
    "/api/v1/workspaces/:workspaceId/usage",
    {
      onRequest: early,
      ...schema("listWorkspaceUsage", creditUsagePageSchema, true),
    },
    safe(async (request, _reply, context) =>
      credits.usage(
        sessions.get(request)!,
        workspaceParams.parse(request.params).workspaceId,
        request.query,
        context,
      ),
    ),
  );
}
