import { z } from "zod";
import {
  serviceCursorSchema,
  serviceInt8Schema,
  servicePageQuerySchema,
  serviceQuantitySchema,
} from "./contracts-service";

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

export const chargingPolicySchema = z
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

export type ChargingPolicy = z.infer<typeof chargingPolicySchema>;
export type WorkspaceCredits = z.infer<typeof workspaceCreditsSchema>;
export type CreditHistoryPage = z.infer<typeof creditHistoryPageSchema>;
export type CreditUsagePage = z.infer<typeof creditUsagePageSchema>;
