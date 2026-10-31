import { z } from "zod";

export const SERVICE_PROTOCOL = "tholi-service";
export const SERVICE_CONTRACT_VERSION = 1;
export const SERVICE_LIMITS = Object.freeze({
  maxBodyBytes: 512 * 1024,
  maxPageSize: 100,
  maxCursorLength: 512,
  defaultDeadlineMs: 25000,
  maxDeadlineMs: 25000,
} as const);
export const SERVICE_TIMEOUT_HEADER = "x-tholi-timeout-ms";

const capabilityNameSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9-]*$/);
const versionSchema = z.number().int().min(1).max(2147483647);
const implementationVersionSchema = z.string().min(1).max(80);
const supportedVersionsSchema = z
  .array(z.literal(SERVICE_CONTRACT_VERSION))
  .length(1);
// Unknown, bounded capability names remain readable by older version-1 clients.
// Clients must explicitly require a capability before using its contract.
export const serviceCapabilitySchema = capabilityNameSchema;
const capabilitiesSchema = z
  .array(serviceCapabilitySchema)
  .max(32)
  .refine(
    (values) => new Set(values).size === values.length,
    "Capabilities must be distinct.",
  );

export const serviceCapabilitiesSchema = z
  .object({
    protocol: z.literal(SERVICE_PROTOCOL),
    version: z.literal(SERVICE_CONTRACT_VERSION),
    implementationVersion: implementationVersionSchema,
    supportedVersions: supportedVersionsSchema,
    capabilities: capabilitiesSchema,
    availability: z
      .object({
        authentication: z.boolean(),
        accountData: z.boolean(),
        decisions: z.boolean(),
        billing: z.boolean(),
      })
      .strict(),
    limits: z
      .object({
        maxBodyBytes: z.literal(SERVICE_LIMITS.maxBodyBytes),
        maxPageSize: z.literal(SERVICE_LIMITS.maxPageSize),
        maxCursorLength: z.literal(SERVICE_LIMITS.maxCursorLength),
        defaultDeadlineMs: z.literal(SERVICE_LIMITS.defaultDeadlineMs),
        maxDeadlineMs: z.literal(SERVICE_LIMITS.maxDeadlineMs),
      })
      .strict(),
  })
  .strict();

export const serviceClientSchema = z
  .object({
    kind: z.enum(["extension", "web", "desktop"]),
    version: implementationVersionSchema,
  })
  .strict();

export const serviceHandshakeInputSchema = z
  .object({
    protocol: z.literal(SERVICE_PROTOCOL),
    versions: z
      .array(versionSchema)
      .min(1)
      .max(8)
      .refine(
        (values) => new Set(values).size === values.length,
        "Versions must be distinct.",
      ),
    client: serviceClientSchema,
    requiredCapabilities: z.array(capabilityNameSchema).max(32).optional(),
  })
  .strict();

export const serviceHandshakeSuccessSchema = z
  .object({
    compatible: z.literal(true),
    protocol: z.literal(SERVICE_PROTOCOL),
    version: z.literal(SERVICE_CONTRACT_VERSION),
    capabilities: capabilitiesSchema,
  })
  .strict();

const incompatibleSchema = z
  .object({
    compatible: z.literal(false),
    reason: z.enum(["UNSUPPORTED_VERSION", "UNSUPPORTED_CAPABILITY"]),
    supportedVersions: supportedVersionsSchema,
    missingCapabilities: z.array(capabilityNameSchema).max(32),
  })
  .strict();

export const serviceHandshakeResultSchema = z.discriminatedUnion("compatible", [
  serviceHandshakeSuccessSchema,
  incompatibleSchema,
]);

export type ServiceCapabilities = z.infer<typeof serviceCapabilitiesSchema>;
export type ServiceHandshakeInput = z.infer<typeof serviceHandshakeInputSchema>;
export type ServiceHandshakeResult = z.infer<
  typeof serviceHandshakeResultSchema
>;

/** Compatibility grants no identity, data access, model execution or entitlement. */
export function negotiateService(
  input: ServiceHandshakeInput,
  capabilities: ServiceCapabilities,
): ServiceHandshakeResult {
  const request = serviceHandshakeInputSchema.parse(input);
  const offered = serviceCapabilitiesSchema.parse(capabilities);
  if (!request.versions.includes(offered.version))
    return {
      compatible: false,
      reason: "UNSUPPORTED_VERSION",
      supportedVersions: [...offered.supportedVersions],
      missingCapabilities: [],
    };
  const missing = [...new Set(request.requiredCapabilities || [])].filter(
    (name) => !offered.capabilities.some((capability) => capability === name),
  );
  if (missing.length)
    return {
      compatible: false,
      reason: "UNSUPPORTED_CAPABILITY",
      supportedVersions: [...offered.supportedVersions],
      missingCapabilities: missing,
    };
  return {
    compatible: true,
    protocol: offered.protocol,
    version: offered.version,
    capabilities: [...offered.capabilities],
  };
}

export const serviceErrorCodeSchema = z.enum([
  "INVALID_REQUEST",
  "COMPATIBILITY_MISMATCH",
  "UNAUTHENTICATED",
  "FORBIDDEN",
  "NOT_FOUND",
  "CONFLICT",
  "IDEMPOTENCY_CONFLICT",
  "PAYLOAD_TOO_LARGE",
  "UNSUPPORTED_MEDIA_TYPE",
  "RATE_LIMITED",
  "QUOTA_EXCEEDED",
  "DEADLINE_EXCEEDED",
  "CANCELLED",
  "UNAVAILABLE",
  "INTERNAL_ERROR",
]);
export const serviceErrorSchema = z
  .object({
    code: serviceErrorCodeSchema,
    message: z.string().min(1).max(300),
    requestId: z.string().uuid(),
    retryable: z.boolean(),
  })
  .strict();
export const serviceErrorEnvelopeSchema = z
  .object({ error: serviceErrorSchema })
  .strict();
export type ServiceErrorCode = z.infer<typeof serviceErrorCodeSchema>;
export type ServiceErrorEnvelope = z.infer<typeof serviceErrorEnvelopeSchema>;

/** PostgreSQL int8 fields travel as canonical decimal strings, never JSON numbers. */
export const serviceInt8Schema = z
  .string()
  .regex(/^(?:0|-?[1-9][0-9]{0,18})$/)
  .refine((value) => {
    if (value.length > 20) return false;
    try {
      const integer = BigInt(value);
      return (
        integer >= -9223372036854775808n && integer <= 9223372036854775807n
      );
    } catch {
      return false;
    }
  }, "Integer is outside the PostgreSQL int8 range.");
export const serviceQuantitySchema = serviceInt8Schema.refine(
  (value) => !value.startsWith("-"),
);
export const serviceRevisionSchema = serviceQuantitySchema.refine(
  (value) => value !== "0",
);
export const serviceSyncRevisionSchema = serviceQuantitySchema;
export const serviceExpectedRevisionSchema = serviceSyncRevisionSchema.describe(
  "Zero creates a record; updates require its exact current revision.",
);
export const serviceCursorSchema = z
  .string()
  .min(1)
  .max(SERVICE_LIMITS.maxCursorLength)
  .regex(/^[A-Za-z0-9_-]+$/);
const pageLimitSchema = z.number().int().min(1).max(SERVICE_LIMITS.maxPageSize);
const pageQueryLimitSchema = z.union([
  pageLimitSchema,
  z
    .string()
    .max(3)
    .regex(/^(?:[1-9]|[1-9][0-9]|100)$/)
    .transform((value) => Number(value)),
]);
export const servicePageQuerySchema = z
  .object({
    limit: pageQueryLimitSchema.default(50),
    cursor: serviceCursorSchema.optional(),
  })
  .strict();
export function servicePageSchema<T extends z.ZodTypeAny>(item: T) {
  return z
    .object({
      items: z.array(item).max(SERVICE_LIMITS.maxPageSize),
      nextCursor: serviceCursorSchema.optional(),
    })
    .strict();
}
export const serviceRevisionGuardSchema = z
  .object({
    expectedRevision: serviceExpectedRevisionSchema,
  })
  .strict();
export const serviceSyncQuerySchema = z
  .object({
    after: serviceSyncRevisionSchema.default("0"),
    limit: pageQueryLimitSchema.default(50),
  })
  .strict();

export const serviceIdempotencyKeySchema = z
  .string()
  .min(1)
  .max(200)
  .regex(/^[\x21-\x7e]+$/);
export const servicePayloadHashSchema = z
  .string()
  .regex(/^[a-f0-9]{64}$/)
  .describe(
    "Server-computed SHA-256 of the canonical versioned command; never client authority.",
  );
export const serviceTimeoutSchema = z
  .number()
  .int()
  .min(1)
  .max(SERVICE_LIMITS.maxDeadlineMs);
export const serviceRequestPolicySchema = z
  .object({
    timeoutMs: serviceTimeoutSchema.default(SERVICE_LIMITS.defaultDeadlineMs),
    idempotencyKey: serviceIdempotencyKeySchema.optional(),
  })
  .strict();
export const serviceRequestMetadataSchema = z
  .object({
    requestId: z.string().uuid(),
    contractVersion: z.literal(SERVICE_CONTRACT_VERSION),
    deadlineAt: z.string().datetime({ offset: true }),
    idempotencyKey: serviceIdempotencyKeySchema.optional(),
    payloadHash: servicePayloadHashSchema.optional(),
  })
  .strict();
export type ServiceRequestPolicy = z.infer<typeof serviceRequestPolicySchema>;
export type ServiceRequestMetadata = z.infer<
  typeof serviceRequestMetadataSchema
>;

/** Durable request progress is distinct from a model proposal or browser arrival. */
export const serviceRequestStatusSchema = z.enum([
  "pending",
  "completed",
  "failed",
  "uncertain",
]);
export type ServiceRequestStatus = z.infer<typeof serviceRequestStatusSchema>;

/** Destination names are intent. #30/#50 resolve an approved registered return. */
export const serviceReturnIntentSchema = z
  .object({
    clientKind: serviceClientSchema.shape.kind,
    destination: z.enum([
      "download",
      "account",
      "saved-data",
      "credits",
      "client",
    ]),
  })
  .strict();
const planIdSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9-]*$/);
export const servicePlanIntentSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("local") }).strict(),
  z.object({ mode: z.literal("free-cloud") }).strict(),
  z
    .object({
      mode: z.literal("paid"),
      planId: planIdSchema,
      planVersion: versionSchema,
    })
    .strict(),
]);
export const serviceAuthIntentSchema = z
  .object({
    action: z.enum(["signup", "signin"]),
    returnIntent: serviceReturnIntentSchema,
    planIntent: servicePlanIntentSchema.optional(),
  })
  .strict();
export const serviceCheckoutIntentSchema = z
  .object({
    planId: planIdSchema,
    planVersion: versionSchema,
    returnIntent: serviceReturnIntentSchema,
  })
  .strict();
export type ServiceReturnIntent = z.infer<typeof serviceReturnIntentSchema>;
export type ServiceAuthIntent = z.infer<typeof serviceAuthIntentSchema>;
export type ServiceCheckoutIntent = z.infer<typeof serviceCheckoutIntentSchema>;
