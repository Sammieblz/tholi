import swagger from "@fastify/swagger";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import apiPackage from "../../package.json" with { type: "json" };
import {
  SERVICE_CONTRACT_VERSION,
  SERVICE_LIMITS,
  SERVICE_PROTOCOL,
  SERVICE_TIMEOUT_HEADER,
  negotiateService,
  serviceAuthIntentSchema,
  serviceCapabilitiesSchema,
  serviceCheckoutIntentSchema,
  serviceErrorEnvelopeSchema,
  serviceHandshakeInputSchema,
  serviceHandshakeSuccessSchema,
  servicePageQuerySchema,
  serviceRequestMetadataSchema,
  serviceRequestPolicySchema,
  serviceRevisionGuardSchema,
  serviceSyncQuerySchema,
} from "../../../../packages/navigation-core/contracts-service";
import {
  navigationDecisionSchema,
  navigationObservationSchema,
  NAVIGATION_TRANSPORT_CAPABILITY,
  NAVIGATION_FAKE_CAPABILITY,
  NAVIGATION_EVALUATION_CAPABILITY,
} from "../../../../packages/navigation-core/contracts-navigation";
import type { OperatorEvaluationMetadata } from "../../../../packages/navigation-core/contracts-evaluation";
import { ApiError, duringServiceRequest } from "../http";
import { SERVICE_ROUTES } from "./service-inventory";
import { identityCookieNames } from "./identity-cookies";

interface ServiceFeatures {
  identityEnabled?: boolean;
  secureCookies?: boolean;
  authorizationEnabled?: boolean;
  jobsEnabled?: boolean;
  supportEnabled?: boolean;
  analyticsEnabled?: boolean;
  navigationEnabled?: boolean;
  evaluation?: OperatorEvaluationMetadata;
  creditsEnabled?: boolean;
  plansEnabled?: boolean;
  savedDataEnabled?: boolean;
  savedDataWritesEnabled?: boolean;
  savedDataExportsEnabled?: boolean;
  accountExportsEnabled?: boolean;
  accountDeletionEnabled?: boolean;
}

function serviceCapabilities(features: ServiceFeatures) {
  const {
    identityEnabled = false,
    authorizationEnabled = false,
    jobsEnabled = false,
    supportEnabled = false,
    analyticsEnabled = false,
    navigationEnabled = false,
    evaluation,
    creditsEnabled = false,
    plansEnabled = false,
    savedDataEnabled = false,
    savedDataWritesEnabled = false,
    savedDataExportsEnabled = false,
    accountExportsEnabled = false,
    accountDeletionEnabled = false,
  } = features;
  return serviceCapabilitiesSchema.parse({
    protocol: SERVICE_PROTOCOL,
    version: SERVICE_CONTRACT_VERSION,
    implementationVersion: apiPackage.version,
    supportedVersions: [SERVICE_CONTRACT_VERSION],
    capabilities: [
      "capabilities",
      "handshake",
      "openapi",
      ...(identityEnabled
        ? ["authentication", "account-security", "account-binding"]
        : []),
      ...(authorizationEnabled
        ? ["tenant-authorization", "purpose-consent"]
        : []),
      ...(jobsEnabled ? ["durable-jobs"] : []),
      ...(supportEnabled ? ["support-requests", "private-files"] : []),
      ...(analyticsEnabled ? ["product-analytics"] : []),
      ...(creditsEnabled ? ["credit-accounting"] : []),
      ...(plansEnabled ? ["product-plans"] : []),
      ...(savedDataEnabled ? ["saved-data"] : []),
      ...(savedDataWritesEnabled ? ["saved-data-write"] : []),
      ...(savedDataExportsEnabled ? ["saved-data-export"] : []),
      ...(accountExportsEnabled ? ["account-export"] : []),
      ...(accountDeletionEnabled ? ["account-deletion"] : []),
      ...(navigationEnabled
        ? [
            NAVIGATION_TRANSPORT_CAPABILITY,
            evaluation
              ? NAVIGATION_EVALUATION_CAPABILITY
              : NAVIGATION_FAKE_CAPABILITY,
          ]
        : []),
    ],
    availability: {
      authentication: identityEnabled,
      accountData: identityEnabled,
      decisions: navigationEnabled,
      billing: false,
    },
    limits: SERVICE_LIMITS,
    ...(evaluation ? { evaluation } : {}),
  });
}

const jsonSchema = (schema: z.ZodTypeAny) =>
  zodToJsonSchema(schema, { target: "openApi3" });

export async function registerServiceApi(
  app: FastifyInstance,
  features: ServiceFeatures = {},
) {
  const { identityEnabled = false, secureCookies = false } = features;
  const capabilities = serviceCapabilities(features);
  const sharedSchemas = {
    ServiceError: serviceErrorEnvelopeSchema,
    PageQuery: servicePageQuerySchema,
    RequestPolicy: serviceRequestPolicySchema,
    RequestMetadata: serviceRequestMetadataSchema,
    RevisionGuard: serviceRevisionGuardSchema,
    SyncQuery: serviceSyncQuerySchema,
    AuthIntent: serviceAuthIntentSchema,
    CheckoutIntent: serviceCheckoutIntentSchema,
  };
  for (const [name, schema] of Object.entries(sharedSchemas))
    app.addSchema({ $id: name, ...jsonSchema(schema) });
  await app.register(swagger, {
    openapi: {
      info: {
        title: "Tholi portable service API",
        version: String(SERVICE_CONTRACT_VERSION),
        description:
          "Service contract version, independent of product releases and the legacy private /v1 and /v2 profiles. Only executable paths are available; x-tholi-route-inventory identifies planned work.",
      },
      security: [],
      components: {
        // Shared OpenAPI components do not enter Fastify's executable AJV schema
        // registry. Their OpenAPI dialect is documentation, not route admission.
        schemas: {
          NavigationObservation: jsonSchema(
            navigationObservationSchema.describe(
              "Independently versioned ephemeral navigation contract. This component alone grants no capability; route availability requires a registered navigation capability. Native scope, encoded budgets and cross-reference validation also require the shared runtime validators.",
            ),
          ),
          NavigationDecision: jsonSchema(
            navigationDecisionSchema.describe(
              "Independently versioned navigation proposal. The browser validates current native references and original deadlines, retains interaction authority and independently verifies outcomes. Server timing is a separate clock domain.",
            ),
          ),
        },
        ...(identityEnabled
          ? {
              securitySchemes: {
                NativeBearer: { type: "http" as const, scheme: "bearer" },
                WebSession: {
                  type: "apiKey" as const,
                  in: "cookie" as const,
                  name: identityCookieNames(secureCookies).access,
                },
              },
            }
          : {}),
      },
    },
  });
  const emptyQuery = jsonSchema(z.object({}).strict());
  const errors = Object.fromEntries(
    [400, 403, 409, 413, 415, 500, 503, 504].map((status) => [
      status,
      { $ref: "ServiceError#" },
    ]),
  );
  for (const route of SERVICE_ROUTES) {
    if (route.status !== "implemented") continue;
    app.route({
      method: route.method,
      url: route.path,
      ...(route.operationId === "negotiateServiceCompatibility"
        ? { bodyLimit: 8 * 1024 }
        : {}),
      schema: {
        operationId: route.operationId,
        summary: route.summary,
        tags: [route.group],
        querystring: emptyQuery,
        headers: {
          type: "object",
          properties: {
            [SERVICE_TIMEOUT_HEADER]: {
              type: "string",
              description: `Optional relative deadline, 1 through ${SERVICE_LIMITS.maxDeadlineMs} milliseconds. It may only shorten the server deadline.`,
              pattern: "^[1-9][0-9]{0,4}$",
            },
          },
        },
        response: {
          ...errors,
          200:
            route.operationId === "getServiceCapabilities"
              ? jsonSchema(serviceCapabilitiesSchema)
              : route.operationId === "negotiateServiceCompatibility"
                ? jsonSchema(serviceHandshakeSuccessSchema)
                : { type: "object", additionalProperties: true },
        },
        ...(route.operationId === "negotiateServiceCompatibility"
          ? {
              body: {
                ...jsonSchema(serviceHandshakeInputSchema),
                examples: [
                  {
                    protocol: SERVICE_PROTOCOL,
                    versions: [SERVICE_CONTRACT_VERSION],
                    client: { kind: "web", version: apiPackage.version },
                    requiredCapabilities: ["handshake"],
                  },
                ],
              },
            }
          : {}),
      },
      handler: (request) =>
        duringServiceRequest(request, () => {
          if (route.operationId === "getServiceCapabilities")
            return capabilities;
          if (route.operationId === "getServiceOpenApi")
            return {
              ...app.swagger(),
              "x-tholi-route-inventory": SERVICE_ROUTES.map((entry) => ({
                ...entry,
                status: app.hasRoute({
                  method: entry.method,
                  url: entry.path.replace(/\{([^}]+)\}/g, ":$1"),
                })
                  ? "implemented"
                  : "planned",
              })),
            };
          const result = negotiateService(
            serviceHandshakeInputSchema.parse(request.body),
            capabilities,
          );
          if (!result.compatible)
            throw new ApiError(
              409,
              "COMPATIBILITY_MISMATCH",
              "The requested service contract or capability is unavailable.",
            );
          return serviceHandshakeSuccessSchema.parse(result);
        }),
    });
  }
}
