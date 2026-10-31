import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  identityAccountResponseSchema,
  identityAuthorizeSchema,
  identityExchangeSchema,
  identityLogoutResponseSchema,
  identityLogoutSchema,
  identityProfileSchema,
  identityRefreshSchema,
  identityRevokedSchema,
  identitySessionsSchema,
  identityTokensSchema,
} from "../../../../packages/navigation-core/contracts-identity";
import {
  IdentityError,
  type IdentityService,
  type IssuedIdentitySession,
} from "../application/identity";
import { ApiError } from "../http";
import {
  identityCookieNames,
  identityCookieOptions,
  clearIdentityCookies,
} from "./identity-cookies";
import {
  createIdentityAccess,
  identityErrorResponses,
  identityRouteSchema as schema,
  identityRouteOptions,
} from "./identity-access";

const jsonSchema = (schema: z.ZodTypeAny) =>
  zodToJsonSchema(schema, { target: "openApi3" });
const callbackSchema = z
  .object({
    state: z.string().min(43).max(128),
    code: z.string().max(4096).optional(),
    iss: z.string().max(2048).optional(),
    session_state: z.string().max(512).optional(),
    error: z.string().max(100).optional(),
    error_description: z.string().max(500).optional(),
    error_uri: z.string().max(2048).optional(),
    kc_action_status: z.string().max(100).optional(),
  })
  .strict();

/** HTTP delivery only. Provider/session authority stays in IdentityService and its ports. */
export async function registerIdentityApi(
  app: FastifyInstance,
  service: IdentityService,
) {
  await app.register(cookie);
  const {
    access: ACCESS,
    refresh: REFRESH,
    flow: FLOW,
  } = identityCookieNames(service.options.secureCookies);
  const options = identityCookieOptions(service.options.secureCookies);
  function clear(reply: FastifyReply) {
    clearIdentityCookies(reply, service.options.secureCookies);
  }
  function credentials(reply: FastifyReply, issued: IssuedIdentitySession) {
    const seconds = Math.max(
      1,
      Math.floor((issued.session.expiresAt.getTime() - Date.now()) / 1000),
    );
    reply.setCookie(ACCESS, issued.tokens.accessToken, {
      ...options,
      maxAge: seconds,
    });
    reply.setCookie(REFRESH, issued.tokens.refreshToken, {
      ...options,
      maxAge: seconds,
    });
  }
  const { safe, authenticate, mutation } = createIdentityAccess(service);
  app.get(
    "/api/v1/account/profile",
    {
      onRequest: safe(async (request) => {
        await authenticate(request, { requireAccountBinding: true });
      }),
      ...identityRouteOptions("getAccountProfile", {
        protected: true,
        requireAccountBinding: true,
        response: identityProfileSchema,
      }),
    },
    safe(async (request, _reply, context) =>
      service.profile(
        (await authenticate(request, { requireAccountBinding: true })).session,
        context,
      ),
    ),
  );
  app.get(
    "/api/v1/auth/authorize",
    {
      schema: schema("startServiceAuthorization", {
        query: identityAuthorizeSchema,
      }),
    },
    safe(async (request, reply) => {
      const result = await service.start(
        identityAuthorizeSchema.parse(request.query),
        request.cookies[FLOW],
      );
      reply.setCookie(FLOW, result.browserBinding, {
        ...options,
        path: service.options.secureCookies ? "/" : "/api/v1/auth",
        maxAge: 300,
      });
      return reply.redirect(result.url);
    }),
  );
  app.get(
    "/api/v1/auth/callback",
    {
      schema: schema("completeServiceAuthorization", { query: callbackSchema }),
    },
    safe(async (request, reply, context) => {
      const input = callbackSchema.parse(request.query);
      if (
        input.error ||
        !input.code ||
        (input.iss !== undefined && input.iss !== service.options.issuer)
      )
        throw new IdentityError(
          401,
          "UNAUTHENTICATED",
          "Authentication was not completed. Return to Tholi and try again.",
        );
      const result = await service.complete(
        {
          state: input.state,
          code: input.code,
          browserBinding: request.cookies[FLOW],
        },
        context,
      );
      if (result.kind === "web") credentials(reply, result.issued);
      return reply.redirect(result.redirectUri);
    }),
  );
  app.post(
    "/api/v1/auth/exchange",
    {
      bodyLimit: 8192,
      schema: schema("exchangeServiceAuthorization", {
        body: identityExchangeSchema,
        response: identityTokensSchema,
      }),
    },
    safe(async (request) => (await service.exchange(request.body)).tokens),
  );
  app.get(
    "/api/v1/account",
    {
      schema: schema("getCurrentAccount", {
        response: identityAccountResponseSchema,
        protected: true,
      }),
    },
    safe(async (request) =>
      service.account((await authenticate(request)).session),
    ),
  );
  app.post(
    "/api/v1/auth/refresh",
    {
      bodyLimit: 8192,
      schema: schema("refreshServiceSession", {
        body: identityRefreshSchema,
        response: z.union([
          identityAccountResponseSchema,
          identityTokensSchema,
        ]),
      }),
    },
    safe(async (request, reply) => {
      const input = identityRefreshSchema.parse(request.body);
      const client = service.options.clients.find(
        (entry) => entry.id === input.clientId,
      );
      if (client?.kind === "web") {
        if (input.refreshToken !== undefined)
          throw new IdentityError(
            400,
            "INVALID_REQUEST",
            "Website refresh credentials must use the protected cookie.",
          );
        const { session, bearer } = await authenticate(request);
        mutation(request, session, bearer);
        const issued = await service.refresh(
          input.clientId,
          request.cookies[REFRESH],
          session,
        );
        credentials(reply, issued);
        return service.account(issued.session);
      }
      return (await service.refresh(input.clientId, input.refreshToken)).tokens;
    }),
  );
  app.post(
    "/api/v1/auth/logout",
    {
      bodyLimit: 8192,
      schema: schema("revokeCurrentServiceSession", {
        body: identityLogoutSchema,
        response: identityLogoutResponseSchema,
        protected: true,
      }),
    },
    safe(async (request, reply) => {
      const { session, bearer } = await authenticate(request);
      mutation(request, session, bearer);
      const result = await service.logout(
        session,
        identityLogoutSchema.parse(request.body).all ?? false,
      );
      if (!bearer) clear(reply);
      return result;
    }),
  );
  app.get(
    "/api/v1/account/sessions",
    {
      schema: schema("listAccountSessions", {
        response: identitySessionsSchema,
        protected: true,
      }),
    },
    safe(async (request) =>
      service.sessions((await authenticate(request)).session),
    ),
  );
  app.delete(
    "/api/v1/account/sessions/:sessionId",
    {
      schema: {
        ...schema("revokeAccountSession", {
          response: identityRevokedSchema,
          protected: true,
        }),
        params: jsonSchema(z.object({ sessionId: z.string().uuid() }).strict()),
      },
    },
    safe(async (request, reply) => {
      const { session, bearer } = await authenticate(request);
      mutation(request, session, bearer);
      const { sessionId } = request.params as { sessionId: string };
      const result = await service.revoke(session, sessionId);
      if (!bearer && sessionId === session.id) clear(reply);
      return result;
    }),
  );
  await app.register(async (backchannel) => {
    backchannel.addContentTypeParser(
      "application/x-www-form-urlencoded",
      { parseAs: "string", bodyLimit: 32 * 1024 },
      (_request, body, done) => {
        const parameters = new URLSearchParams(body as string);
        if (parameters.size !== 1 || !parameters.has("logout_token")) {
          done(
            new ApiError(
              400,
              "INVALID_REQUEST",
              "The logout notification is invalid.",
            ),
          );
          return;
        }
        done(null, { logout_token: parameters.get("logout_token") });
      },
    );
    const body = z
      .object({
        logout_token: z
          .string()
          .min(1)
          .max(32 * 1024),
      })
      .strict();
    backchannel.post(
      "/api/v1/auth/backchannel-logout",
      {
        bodyLimit: 32 * 1024,
        schema: {
          ...schema("receiveProviderLogout", { body }),
          consumes: ["application/x-www-form-urlencoded", "application/json"],
          response: { ...identityErrorResponses, 204: { type: "null" } },
        },
      },
      safe(async (request, reply, context) => {
        await service.backchannel(
          body.parse(request.body).logout_token,
          context,
        );
        return reply.code(204).send();
      }),
    );
  });
}
