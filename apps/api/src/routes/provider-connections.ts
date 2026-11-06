import type { FastifyInstance } from "fastify";
import {
  PROVIDER_CONNECTION_LIMITS,
  providerConnectionCreateSchema,
  providerConnectionParamsSchema,
  providerConnectionRemoveSchema,
  providerConnectionReplaceSchema,
  providerConnectionSchema,
  providerConnectionsSchema,
} from "../../../../packages/navigation-core/contracts-providers";
import type { ProviderConnectionService } from "../application/provider-connections";
import type { IdentityService } from "../application/identity";
import { createIdentityAccess, identityRouteOptions } from "./identity-access";

/** Current account proof and cookie CSRF admission precede credential body parsing. */
export async function registerProviderConnectionsApi(
  app: FastifyInstance,
  identity: IdentityService,
  connections: ProviderConnectionService,
) {
  const { safe, protect, protectedSession } = createIdentityAccess(identity);
  const base = "/api/v1/account/provider-connections";
  app.get(
    base,
    {
      onRequest: protect(),
      ...identityRouteOptions("listProviderConnections", {
        protected: true,
        requireAccountBinding: true,
        response: providerConnectionsSchema,
        tags: ["account"],
      }),
    },
    safe((request, _reply, context) =>
      connections.list(protectedSession(request), context),
    ),
  );
  app.post(
    base,
    {
      bodyLimit: PROVIDER_CONNECTION_LIMITS.maxBodyBytes,
      onRequest: protect(true),
      ...identityRouteOptions("createProviderConnection", {
        protected: true,
        requireAccountBinding: true,
        body: providerConnectionCreateSchema,
        response: providerConnectionSchema,
        tags: ["account"],
      }),
    },
    safe((request, _reply, context) =>
      connections.create(protectedSession(request), request.body, context),
    ),
  );
  app.patch(
    `${base}/:connectionId`,
    {
      bodyLimit: PROVIDER_CONNECTION_LIMITS.maxBodyBytes,
      onRequest: protect(true),
      ...identityRouteOptions("replaceProviderConnection", {
        protected: true,
        requireAccountBinding: true,
        params: providerConnectionParamsSchema,
        body: providerConnectionReplaceSchema,
        response: providerConnectionSchema,
        tags: ["account"],
      }),
    },
    safe((request, _reply, context) =>
      connections.replace(
        protectedSession(request),
        providerConnectionParamsSchema.parse(request.params).connectionId,
        request.body,
        context,
      ),
    ),
  );
  app.delete(
    `${base}/:connectionId`,
    {
      bodyLimit: 4096,
      onRequest: protect(true),
      ...identityRouteOptions("removeProviderConnection", {
        protected: true,
        requireAccountBinding: true,
        params: providerConnectionParamsSchema,
        body: providerConnectionRemoveSchema,
        response: providerConnectionSchema,
        tags: ["account"],
      }),
    },
    safe((request, _reply, context) =>
      connections.remove(
        protectedSession(request),
        providerConnectionParamsSchema.parse(request.params).connectionId,
        request.body,
        context,
      ),
    ),
  );
}
