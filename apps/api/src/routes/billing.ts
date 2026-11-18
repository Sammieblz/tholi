import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import {
  billingSubscriptionSchema,
  billingInvoicesSchema,
} from "../../../../packages/navigation-core/contracts-billing";
import type { BillingService } from "../application/billing";
import type { IdentityService } from "../application/identity";
import type { IdentitySession } from "../application/identity-contracts";
import { createIdentityAccess, identityRouteOptions } from "./identity-access";

const workspaceParams = z.object({ workspaceId: z.string().uuid() }).strict();

/** Account-bound financial metadata only. No payment credential or client mutation. */
export async function registerBillingApi(
  app: FastifyInstance,
  identity: IdentityService,
  billing: BillingService,
) {
  const { safe, authenticate } = createIdentityAccess(identity),
    sessions = new WeakMap<FastifyRequest, IdentitySession>(),
    early = safe(async (request) => {
      sessions.set(
        request,
        (await authenticate(request, { requireAccountBinding: true })).session,
      );
    });
  for (const [path, operationId, response, read] of [
    [
      "subscription",
      "getWorkspaceSubscription",
      billingSubscriptionSchema,
      billing.subscription.bind(billing),
    ],
    [
      "invoices",
      "listWorkspaceInvoices",
      billingInvoicesSchema,
      billing.invoices.bind(billing),
    ],
  ] as const) {
    app.get(
      "/api/v1/workspaces/:workspaceId/" + path,
      {
        onRequest: early,
        ...identityRouteOptions(operationId, {
          protected: true,
          requireAccountBinding: true,
          params: workspaceParams,
          response,
          tags: ["billing"],
        }),
      },
      safe((request, _reply, context) =>
        read(
          sessions.get(request)!,
          workspaceParams.parse(request.params).workspaceId,
          context,
        ),
      ),
    );
  }
}
