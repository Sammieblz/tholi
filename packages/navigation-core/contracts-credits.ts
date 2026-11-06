import { z } from "zod";
import {
  serviceCursorSchema,
  serviceInt8Schema,
  servicePageQuerySchema,
  serviceQuantitySchema,
  serviceSchemaVersionQuerySchema,
} from "./contracts-service";
import {
  PROVIDER_CATALOG_REVISION,
  getProviderDefinition,
  providerIdSchema,
  type ProviderId,
} from "./contracts-providers";

/** Development fixtures are not a published plan, price or live-provider allowance. */
export const fakeDevelopmentChargingPolicy = Object.freeze({
  version: "fake-development-v1",
  environment: "development",
  provider: "fake",
  model: "tholi-deterministic-v1",
  creditUnit: "development-credit",
  chargeBasis: "validated-proposal-generation",
  maxCredits: "1",
  maxProviderCostUsdMicros: "0",
  inputUsdMicrosPerMillion: "0",
  outputUsdMicrosPerMillion: "0",
  maxInputTokens: 32768,
  maxOutputTokens: 2048,
  maxImages: 1,
  maxRetries: 0,
  maxDecisionsPerJourney: 8,
  billingAvailable: false,
} as const);

const policyVersion = z.string().min(1).max(100);
const timestamp = z.string().datetime({ offset: true });
const cursor = serviceCursorSchema;

const fakeChargingPolicySchema = z
  .object({
    version: z.literal(fakeDevelopmentChargingPolicy.version),
    environment: z.literal("development"),
    provider: z.literal("fake"),
    model: z.literal("tholi-deterministic-v1"),
    creditUnit: z.literal("development-credit"),
    chargeBasis: z.literal("validated-proposal-generation"),
    maxCredits: z.literal("1"),
    maxProviderCostUsdMicros: z.literal("0"),
    inputUsdMicrosPerMillion: z.literal("0"),
    outputUsdMicrosPerMillion: z.literal("0"),
    maxInputTokens: z.number().int().positive().max(32768),
    maxOutputTokens: z.number().int().positive().max(2048),
    maxImages: z.number().int().nonnegative().max(1),
    maxRetries: z.literal(0),
    maxDecisionsPerJourney: z.number().int().positive().max(100),
    billingAvailable: z.literal(false),
  })
  .strict();

/** Customer-funded development limits are not commercial allowances or model prices. */
export const customerChargingPolicySchema = z
  .object({
    fundingSource: z.literal("customer"),
    version: z.string().min(1).max(100),
    environment: z.literal("development"),
    provider: providerIdSchema,
    model: z.string().min(1).max(200),
    catalogRevision: z.literal(PROVIDER_CATALOG_REVISION),
    routingPolicyVersion: z.string().min(1).max(100),
    creditUnit: z.literal("not-applicable"),
    chargeBasis: z.literal("customer-provider-usage"),
    maxCredits: z.literal("0"),
    maxProviderCostUsdMicros: z.literal("0"),
    inputUsdMicrosPerMillion: z.null(),
    outputUsdMicrosPerMillion: z.null(),
    maxInputTokens: z.number().int().positive().max(32768),
    maxOutputTokens: z.number().int().positive().max(2048),
    maxImages: z.number().int().nonnegative().max(1),
    maxRetries: z.literal(0),
    maxDecisionsPerJourney: z.number().int().positive().max(8),
    periodSeconds: z.literal(86400),
    requestsPerPeriod: z.number().int().positive().max(10000),
    requestsPerMinute: z.number().int().positive().max(60),
    foregroundRequests: z.literal(1),
    billingAvailable: z.literal(false),
  })
  .strict()
  .superRefine((policy, context) => {
    const definition = getProviderDefinition(policy.provider);
    if (
      !new RegExp(
        `^customer-${policy.provider}-development-v[1-9][0-9]*$`,
      ).test(policy.version) ||
      policy.model !== definition.model ||
      policy.routingPolicyVersion !== definition.routingPolicyVersion
    )
      context.addIssue({
        code: "custom",
        message: "The customer-funded policy is unavailable.",
      });
  });
export function customerDevelopmentChargingPolicy(
  provider: ProviderId,
  limits: Partial<
    Pick<
      CustomerChargingPolicy,
      | "version"
      | "requestsPerPeriod"
      | "requestsPerMinute"
      | "maxDecisionsPerJourney"
      | "maxInputTokens"
      | "maxOutputTokens"
      | "maxImages"
    >
  > = {},
) {
  const definition = getProviderDefinition(provider);
  return Object.freeze(
    customerChargingPolicySchema.parse({
      fundingSource: "customer",
      version: `customer-${provider}-development-v1`,
      environment: "development",
      provider,
      model: definition.model,
      catalogRevision: PROVIDER_CATALOG_REVISION,
      routingPolicyVersion: definition.routingPolicyVersion,
      creditUnit: "not-applicable",
      chargeBasis: "customer-provider-usage",
      maxCredits: "0",
      maxProviderCostUsdMicros: "0",
      inputUsdMicrosPerMillion: null,
      outputUsdMicrosPerMillion: null,
      maxInputTokens: 32768,
      maxOutputTokens: 2048,
      maxImages: 1,
      maxRetries: 0,
      maxDecisionsPerJourney: 2,
      periodSeconds: 86400,
      requestsPerPeriod: 6,
      requestsPerMinute: 2,
      foregroundRequests: 1,
      billingAvailable: false,
      ...limits,
    }),
  );
}
export const chargingPolicySchema = z.union([
  fakeChargingPolicySchema,
  customerChargingPolicySchema,
]);
export type CustomerChargingPolicy = z.infer<
  typeof customerChargingPolicySchema
>;

export const creditBalanceSchema = z
  .object({
    granted: serviceQuantitySchema,
    spent: serviceQuantitySchema,
    reserved: serviceQuantitySchema,
    available: serviceQuantitySchema,
    expired: serviceQuantitySchema,
    refunded: serviceQuantitySchema,
  })
  .strict();

export const workspaceCreditsSchema = z
  .object({ balance: creditBalanceSchema, policy: chargingPolicySchema })
  .strict();

export const creditPageQuerySchema = servicePageQuerySchema
  .omit({ cursor: true })
  .extend({ after: cursor.optional() })
  .strict();
export const creditUsageQuerySchema = creditPageQuerySchema
  .extend({
    schemaVersion: serviceSchemaVersionQuerySchema.optional(),
  })
  .strict();

export const creditHistoryEntrySchema = z
  .object({
    id: z.string().uuid(),
    kind: z.enum(["grant", "settlement", "refund"]),
    amount: serviceInt8Schema,
    createdAt: timestamp,
    source: z.string().min(1).max(100).nullable(),
    periodStart: timestamp.nullable(),
    periodEnd: timestamp.nullable(),
    expiresAt: timestamp.nullable(),
    policyVersion: policyVersion.nullable(),
  })
  .strict();

export const creditHistoryPageSchema = z
  .object({
    items: z.array(creditHistoryEntrySchema).max(100),
    nextCursor: cursor.optional(),
  })
  .strict();

export const creditUsageEntrySchema = z
  .object({
    id: z.string().uuid(),
    requestId: z.string().uuid(),
    provider: z.string().min(1).max(100),
    model: z.string().min(1).max(200),
    inputUnits: serviceQuantitySchema.nullable(),
    outputUnits: serviceQuantitySchema.nullable(),
    providerUsdMicros: serviceQuantitySchema.nullable(),
    chargedCredits: serviceQuantitySchema.nullable(),
    policyVersion: policyVersion.nullable(),
    createdAt: timestamp,
  })
  .strict();
export const creditUsageEntryV2Schema = creditUsageEntrySchema
  .extend({
    provider: z.enum(["fake", "vertex", "openai", "anthropic", "openrouter"]),
    fundingSource: z.enum(["managed", "customer"]),
    usageVersion: z.union([z.literal(1), z.literal(2)]),
    customerUsdMicros: serviceQuantitySchema.nullable(),
    cacheReadInputUnits: serviceQuantitySchema.nullable(),
    cacheWriteInputUnits: serviceQuantitySchema.nullable(),
    reasoningOutputUnits: serviceQuantitySchema.nullable(),
  })
  .strict()
  .superRefine((entry, context) => {
    const customer = entry.fundingSource === "customer";
    if (
      customer !==
        ["openai", "anthropic", "openrouter"].includes(entry.provider) ||
      (customer &&
        (entry.usageVersion !== 2 ||
          entry.providerUsdMicros !== "0" ||
          entry.chargedCredits !== "0")) ||
      (!customer && entry.customerUsdMicros !== null)
    )
      context.addIssue({
        code: "custom",
        message: "The usage funding identity is invalid.",
      });
  });

export const creditUsagePageSchema = z
  .object({
    items: z.array(creditUsageEntrySchema).max(100),
    nextCursor: cursor.optional(),
    verification: z
      .object({
        independentOutcomesAvailable: z.literal(false),
        costPerVerifiedSuccessUsdMicros: z.null(),
      })
      .strict(),
  })
  .strict();
export const creditUsagePageV2Schema = creditUsagePageSchema
  .extend({
    schemaVersion: z.literal(2),
    items: z.array(creditUsageEntryV2Schema).max(100),
  })
  .strict();

export type ChargingPolicy = z.infer<typeof chargingPolicySchema>;
export type WorkspaceCredits = z.infer<typeof workspaceCreditsSchema>;
export type CreditHistoryPage = z.infer<typeof creditHistoryPageSchema>;
export type CreditUsagePage = z.infer<typeof creditUsagePageSchema>;
export type CreditUsagePageV2 = z.infer<typeof creditUsagePageV2Schema>;
