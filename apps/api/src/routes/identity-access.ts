import type { FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AuthorizationError } from "../application/authorization";
import { IdentityError, type IdentityService } from "../application/identity";
import type { IdentitySession } from "../application/identity-contracts";
import type { ServiceRequestContext } from "../capabilities";
import { ApiError, duringServiceRequest } from "../http";
import { identityCookieNames } from "./identity-cookies";

export const identityErrorResponses = Object.fromEntries(
  [400, 401, 403, 404, 409, 413, 500, 503, 504].map((status) => [
    status,
    { $ref: "ServiceError#" },
  ]),
);
const jsonSchema = (schema: z.ZodTypeAny, target: "openApi3" | "jsonSchema7") =>
  zodToJsonSchema(schema, { target });

/** Shared HTTP credential delivery; application services never inspect headers or cookies. */
export function createIdentityAccess(service: IdentityService) {
  const { access } = identityCookieNames(service.options.secureCookies);
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
      bearer ? authorization.slice(7) : request.cookies[access],
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
          if (
            error instanceof IdentityError ||
            error instanceof AuthorizationError
          )
            throw new ApiError(error.statusCode, error.code, error.message);
          throw error;
        }
      });
  return { authenticate, mutation, safe };
}

/** Both protected route owners describe the same native/cookie/CSRF boundary. */
export function identityRouteSchema(
  operationId: string,
  input: {
    query?: z.ZodTypeAny;
    body?: z.ZodTypeAny;
    response?: z.ZodTypeAny;
    protected?: boolean;
    tags?: string[];
  } = {},
  target: "openApi3" | "jsonSchema7" = "openApi3",
) {
  return {
    operationId,
    tags: input.tags ?? ["identity"],
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
    querystring: jsonSchema(input.query ?? z.object({}).strict(), target),
    ...(input.body ? { body: jsonSchema(input.body, target) } : {}),
    response: {
      ...identityErrorResponses,
      ...(input.response ? { 200: jsonSchema(input.response, target) } : {}),
    },
  };
}
