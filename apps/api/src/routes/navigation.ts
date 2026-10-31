import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  NAVIGATION_TRANSPORT_LIMITS,
  navigationTransportInputSchema,
  navigationTransportResponseSchema,
  navigationRequestStatusSchema,
  navigationCancellationSchema,
  serializedUtf8Bytes,
} from "../../../../packages/navigation-core/contracts-navigation";
import type { NavigationTransportService } from "../application/navigation";
import type { IdentityService } from "../application/identity";
import type { IdentitySession } from "../application/identity-contracts";
import { ModelError } from "../application/model-contracts";
import { ApiError } from "../http";
import { createIdentityAccess, identityRouteSchema } from "./identity-access";

const workspaceParams = z.object({ workspaceId: z.string().uuid() }).strict();
const requestParams = workspaceParams.extend({ requestId: z.string().uuid() });

/** HTTP delivery reuses the native/cookie boundary; no credential reaches model input. */
export async function registerNavigationApi(
  app: FastifyInstance,
  identity: IdentityService,
  navigation: NavigationTransportService,
) {
  const { safe, authenticate, mutation } = createIdentityAccess(identity);
  const admitted = new WeakMap<
    FastifyRequest,
    { session: IdentitySession; bearer: boolean }
  >();
  const early = (mutating: boolean) =>
    safe(async (request) => {
      const access = await authenticate(request);
      if (mutating) mutation(request, access.session, access.bearer);
      admitted.set(request, { ...access, session: { ...access.session } });
    });
  const access = (request: FastifyRequest, mutating: boolean) => {
    const initial = admitted.get(request);
    if (!initial)
      throw new ApiError(401, "UNAUTHENTICATED", "Sign in again to continue.");
    return {
      principal: initial.session,
      revalidate: async () => {
        const current = await authenticate(request);
        if (mutating) mutation(request, current.session, current.bearer);
        if (
          current.session.id !== initial.session.id ||
          current.session.accountId !== initial.session.accountId
        )
          throw new ApiError(
            401,
            "UNAUTHENTICATED",
            "The account session changed.",
          );
      },
    };
  };
  const schema = (
    operationId: string,
    params: z.ZodTypeAny,
    response: z.ZodTypeAny,
    body?: z.ZodTypeAny,
  ) => {
    const contract = (target: "openApi3" | "jsonSchema7") => {
      const shared = identityRouteSchema(
        operationId,
        {
          protected: true,
          tags: ["decisions"],
          response,
          ...(body ? { body } : {}),
        },
        target,
      );
      return {
        ...shared,
        params: zodToJsonSchema(params, { target }),
        response: {
          ...shared.response,
          429: { $ref: "ServiceError#" },
          415: { $ref: "ServiceError#" },
        },
      };
    };
    return {
      // Numeric exclusive bounds have different dialects. Derive both from the
      // same contracts so AJV admission and OpenAPI documentation retain them.
      schema: contract("jsonSchema7"),
      config: {
        swaggerTransform: ({ url }: { url: string }) => ({
          url,
          schema: contract("openApi3"),
        }),
      },
    };
  };
  const bounded = <T>(value: T): T => {
    if (
      serializedUtf8Bytes(value) > NAVIGATION_TRANSPORT_LIMITS.maxResponseBytes
    )
      throw new ApiError(
        503,
        "UNAVAILABLE",
        "The navigation response exceeds its limit.",
      );
    return value;
  };
  app.post(
    "/api/v1/workspaces/:workspaceId/decisions",
    {
      bodyLimit: NAVIGATION_TRANSPORT_LIMITS.maxBodyBytes,
      onRequest: early(true),
      ...schema(
        "requestNavigationDecision",
        workspaceParams,
        navigationTransportResponseSchema,
        navigationTransportInputSchema,
      ),
    },
    safe(async (request, reply, context) => {
      const { principal, revalidate } = access(request, true);
      try {
        return bounded(
          await navigation.request(
            principal,
            workspaceParams.parse(request.params).workspaceId,
            request.body,
            context,
            revalidate,
          ),
        );
      } catch (error) {
        if (!(error instanceof ModelError)) throw error;
        if (error.retryAfterMs !== undefined)
          reply.header(
            "Retry-After",
            String(Math.max(1, Math.ceil(error.retryAfterMs / 1000))),
          );
        if (error.code === "DEADLINE_EXCEEDED")
          throw new ApiError(504, "DEADLINE_EXCEEDED", error.message);
        if (error.code === "CANCELLED")
          throw new ApiError(409, "CANCELLED", error.message);
        if (error.code === "THROTTLED")
          throw new ApiError(429, "RATE_LIMITED", error.message);
        if (error.code === "BUDGET_EXCEEDED")
          throw new ApiError(413, "PAYLOAD_TOO_LARGE", error.message);
        if (error.code === "INVALID_INPUT")
          throw new ApiError(400, "INVALID_REQUEST", error.message);
        throw new ApiError(503, "UNAVAILABLE", error.message);
      }
    }),
  );
  app.get(
    "/api/v1/workspaces/:workspaceId/decisions/:requestId",
    {
      onRequest: early(false),
      ...schema(
        "getNavigationDecisionStatus",
        requestParams,
        navigationRequestStatusSchema,
      ),
    },
    safe(async (request, _reply, context) => {
      const { principal, revalidate } = access(request, false);
      const { workspaceId, requestId } = requestParams.parse(request.params);
      return bounded(
        await navigation.status(
          principal,
          workspaceId,
          requestId,
          context,
          revalidate,
        ),
      );
    }),
  );
  app.post(
    "/api/v1/workspaces/:workspaceId/decisions/:requestId/cancel",
    {
      bodyLimit: 8192,
      onRequest: early(true),
      ...schema(
        "cancelNavigationDecision",
        requestParams,
        navigationCancellationSchema,
        z.object({}).strict(),
      ),
    },
    safe(async (request, _reply, context) => {
      const { principal, revalidate } = access(request, true);
      const { workspaceId, requestId } = requestParams.parse(request.params);
      return bounded(
        await navigation.cancel(
          principal,
          workspaceId,
          requestId,
          context,
          revalidate,
        ),
      );
    }),
  );
}
