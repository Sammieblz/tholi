import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  accountExportInputSchema,
  accountExportStatusSchema,
  accountExportPageSchema,
  accountExportQuerySchema,
  accountDeletionInputSchema,
  accountDeletionResultSchema,
} from "../../../../packages/navigation-core/contracts-account";
import type { AccountService } from "../application/account";
import type { IdentityService } from "../application/identity";
import { createIdentityAccess, identityRouteOptions } from "./identity-access";
import { clearIdentityCookies } from "./identity-cookies";

export async function registerAccountApi(
  app: FastifyInstance,
  identity: IdentityService,
  account: AccountService,
) {
  const { safe, protect, protectedSession } = createIdentityAccess(identity);
  if (account.exportsAvailable) {
    app.get(
      "/api/v1/account/exports",
      {
        onRequest: protect(),
        ...identityRouteOptions("listAccountExports", {
          query: accountExportQuerySchema,
          response: accountExportPageSchema,
          protected: true,
          requireAccountBinding: true,
          tags: ["account"],
        }),
      },
      safe(async (request, _reply, context) =>
        account.listExports(protectedSession(request), request.query, context),
      ),
    );
    app.post(
      "/api/v1/account/exports",
      {
        bodyLimit: 4096,
        onRequest: protect(true),
        ...identityRouteOptions("prepareAccountExport", {
          body: accountExportInputSchema,
          response: accountExportStatusSchema,
          protected: true,
          requireAccountBinding: true,
          tags: ["account"],
        }),
      },
      safe((request, _reply, context) =>
        account.requestExport(protectedSession(request), request.body, context),
      ),
    );
    const params = z.object({ generation: z.string().uuid() }).strict();
    app.get(
      "/api/v1/account/exports/:generation",
      {
        onRequest: protect(),
        ...identityRouteOptions("getAccountExport", {
          params,
          response: accountExportStatusSchema,
          protected: true,
          requireAccountBinding: true,
          tags: ["account"],
        }),
      },
      safe(async (request, _reply, context) =>
        account.getExport(
          protectedSession(request),
          params.parse(request.params).generation,
          context,
        ),
      ),
    );
  }
  if (account.deletionAvailable)
    app.post(
      "/api/v1/account/deletion",
      {
        bodyLimit: 4096,
        onRequest: protect(true),
        ...identityRouteOptions("requestAccountDeletion", {
          body: accountDeletionInputSchema,
          response: accountDeletionResultSchema,
          protected: true,
          requireAccountBinding: true,
          tags: ["account"],
        }),
      },
      safe(async (request, reply, context) => {
        const session = protectedSession(request);
        const result = await account.deleteAccount(
          session,
          request.body,
          context,
        );
        if (session.clientKind === "web")
          clearIdentityCookies(reply, identity.options.secureCookies);
        return result;
      }),
    );
}
