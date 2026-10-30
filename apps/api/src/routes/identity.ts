import cookie from "@fastify/cookie";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  identityAccountResponseSchema,
  identityAuthorizeSchema,
  identityExchangeSchema,
  identityLogoutResponseSchema,
  identityLogoutSchema,
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
import type { IdentitySession } from "../application/identity-contracts";
import type { ServiceRequestContext } from "../capabilities";
import { ApiError, duringServiceRequest } from "../http";
import { identityCookieNames } from "./identity-cookies";

const jsonSchema = (schema: z.ZodTypeAny) =>
  zodToJsonSchema(schema, { target: "openApi3" });
const empty = z.object({}).strict();
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
  const options = {
    httpOnly: true,
    secure: service.options.secureCookies,
    sameSite: "lax" as const,
    path: service.options.secureCookies ? "/" : "/api/v1",
  };
  function clear(reply: FastifyReply) {
    reply.clearCookie(ACCESS, options).clearCookie(REFRESH, options);
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
  const safe =
    (
      work: (
        request: FastifyRequest,
        reply: FastifyReply,
        context: ServiceRequestContext,
      ) => Promise<unknown>,
    ) =>
    (request: FastifyRequest, reply: FastifyReply) =>
      duringServiceRequest(request, async (context) => {
        reply.header("Referrer-Policy", "no-referrer");
        try {
          return await work(request, reply, context);
        } catch (error) {
          if (error instanceof IdentityError)
            throw new ApiError(error.statusCode, error.code, error.message);
          throw error;
        }
      });
  async function authenticate(request: FastifyRequest) {
    const authorization = request.headers.authorization;
    const bearer = authorization !== undefined;
    if (
      !bearer &&
      request.headers.origin !== undefined &&
      request.headers.origin !== service.options.webOrigin
    )
      throw new IdentityError(
        403,
        "FORBIDDEN",
        "The account request origin is not allowed.",
      );
    if (bearer && !/^Bearer [A-Za-z0-9_-]{43,128}$/i.test(authorization))
      throw new IdentityError(
        401,
        "UNAUTHENTICATED",
        "Sign in again to continue.",
      );
    const session = await service.authenticate(
      bearer ? authorization.slice(7) : request.cookies[ACCESS],
    );
    if (
      (bearer && session.clientKind === "web") ||
      (!bearer && session.clientKind !== "web")
    )
      throw new IdentityError(
        401,
        "UNAUTHENTICATED",
        "The session delivery method is invalid.",
      );
    return { session, bearer };
  }
  function mutation(
    request: FastifyRequest,
    session: IdentitySession,
    bearer: boolean,
  ) {
    if (bearer) return;
    if (request.headers.origin !== service.options.webOrigin)
      throw new IdentityError(
        403,
        "FORBIDDEN",
        "The account request origin is not allowed.",
      );
    service.verifyCsrf(session, request.headers["x-tholi-csrf"]);
  }
  const errors = Object.fromEntries(
    [400, 401, 403, 404, 409, 413, 500, 503, 504].map((status) => [
      status,
      { $ref: "ServiceError#" },
    ]),
  );
  const schema = (
    operationId: string,
    input: {
      query?: z.ZodTypeAny;
      body?: z.ZodTypeAny;
      response?: z.ZodTypeAny;
      protected?: boolean;
    } = {},
  ) => ({
    operationId,
    tags: ["identity"],
    security: input.protected
      ? ([{ NativeBearer: [] }, { WebSession: [] }] as Record<
          string,
          string[]
        >[])
      : [],
    description: input.protected
      ? "Requires a current native bearer session or protected website session. Cookie mutations additionally require the exact website Origin and X-Tholi-CSRF token."
      : "Requires this operation's bound authorization, PKCE, refresh or signed provider proof. Public discovery does not grant identity authority.",
    ...(input.protected
      ? {
          headers: {
            type: "object",
            properties: {
              "x-tholi-csrf": {
                type: "string",
                minLength: 43,
                maxLength: 128,
                description:
                  "Required for website cookie mutations, obtained from the authenticated account response.",
              },
            },
          },
        }
      : {}),
    querystring: jsonSchema(input.query ?? empty),
    ...(input.body ? { body: jsonSchema(input.body) } : {}),
    response: {
      ...errors,
      ...(input.response ? { 200: jsonSchema(input.response) } : {}),
    },
  });
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
          response: { ...errors, 204: { type: "null" } },
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
