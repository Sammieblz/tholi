import type { FastifyInstance } from "fastify";
import {
  diagnosticInputSchema,
  diagnosticSchema,
  supportInputSchema,
  supportRequestSchema,
} from "../../../../packages/navigation-core/contracts-support";
import type { IdentityService } from "../application/identity";
import { AuthorizationError } from "../application/authorization";
import type { SupportService } from "../application/support";
import { createIdentityAccess, identityRouteSchema } from "./identity-access";

export async function registerSupportApi(
  app: FastifyInstance,
  identity: IdentityService,
  support: SupportService,
) {
  const { safe, authenticate, mutation } = createIdentityAccess(identity);
  for (const route of [
    {
      url: "/api/v1/support/requests",
      operationId: "createSupportRequest",
      input: supportInputSchema,
      output: supportRequestSchema,
      submit: support.submit.bind(support),
    },
    {
      url: "/api/v1/account/diagnostic-exports",
      operationId: "createAccountDiagnosticExport",
      input: diagnosticInputSchema,
      output: diagnosticSchema,
      submit: support.diagnostic.bind(support),
    },
  ]) {
    const schema = identityRouteSchema(route.operationId, {
      body: route.input,
      response: route.output,
      protected: true,
      tags: ["support"],
    });
    app.post(
      route.url,
      {
        bodyLimit: 16 * 1024,
        schema: {
          ...schema,
          response: { ...schema.response, 429: { $ref: "ServiceError#" } },
        },
      },
      safe(async (request, reply, context) => {
        const { session, bearer } = await authenticate(request);
        mutation(request, session, bearer);
        try {
          return await route.submit(session, request.body, context);
        } catch (error) {
          if (error instanceof AuthorizationError && error.statusCode === 429)
            reply.header("Retry-After", "3600");
          throw error;
        }
      }),
    );
  }
}
