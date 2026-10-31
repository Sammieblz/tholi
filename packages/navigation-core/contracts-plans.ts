import { z } from "zod";
import {
  servicePlanIntentSchema,
  serviceQuantitySchema,
  serviceRevisionSchema,
} from "./contracts-service";

export const FREE_DEVELOPMENT_PROGRAM = "tholi-free-development";

const identifier = z.string().min(1).max(100);
const planIdentity = servicePlanIntentSchema.options[2].shape;
const timestamp = z.string().datetime({ offset: true });
const planMode = z.union([
  servicePlanIntentSchema.options[0].shape.mode,
  servicePlanIntentSchema.options[1].shape.mode,
  servicePlanIntentSchema.options[2].shape.mode,
]);

/** Limits are enforced by the server; client selections never supply them. */
export const planCapsSchema = z
  .object({
    maxInputTokens: z.number().int().positive().max(32768),
    maxOutputTokens: z.number().int().positive().max(2048),
    maxImages: z.number().int().nonnegative().max(1),
    maxRetries: z.literal(0),
    maxDecisionsPerJourney: z.number().int().positive().max(8),
    requestsPerPeriod: z.number().int().positive().max(1000000),
    requestsPerMinute: z.number().int().positive().max(1000),
    maxSavedArtifacts: z.number().int().nonnegative().max(100000),
    maxSavedArtifactBytes: serviceQuantitySchema,
    maxStoredBytes: serviceQuantitySchema,
    maxProviderCostUsdMicros: z.literal("0"),
    maxForegroundDecisions: z.literal(1),
  })
  .strict();

export const developmentAllowanceSchema = z
  .object({
    programId: identifier,
    amount: serviceQuantitySchema.refine((value) => BigInt(value) > 0n),
    periodSeconds: z.number().int().min(60).max(2678400),
    expiresAtPeriodEnd: z.literal(true),
    rollover: z.literal(false),
    caps: planCapsSchema,
  })
  .strict();

const pricingSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("free"), amount: z.literal("0") }).strict(),
  z.object({ status: z.literal("unpublished"), amount: z.null() }).strict(),
]);

export const productPlanSchema = z
  .object({
    id: planIdentity.planId,
    version: planIdentity.planVersion,
    name: z.string().min(1).max(100),
    mode: planMode,
    requiresAccount: z.boolean(),
    availability: z
      .object({
        available: z.boolean(),
        reason: z.enum([
          "available",
          "development-fixture",
          "quality-gate-pending",
          "billing-not-enabled",
        ]),
      })
      .strict(),
    pricing: pricingSchema,
    productionAllowance: z.null(),
    developmentAllowance: developmentAllowanceSchema.nullable(),
  })
  .strict()
  .superRefine((plan, context) => {
    if (
      (plan.mode === "local" &&
        (plan.requiresAccount ||
          plan.developmentAllowance !== null ||
          !plan.availability.available ||
          plan.pricing.status !== "free")) ||
      (plan.mode !== "local" && !plan.requiresAccount) ||
      (plan.mode === "free-cloud" &&
        (plan.pricing.status !== "free" ||
          (plan.availability.available &&
            (!plan.developmentAllowance ||
              plan.availability.reason !== "development-fixture")))) ||
      (plan.mode === "paid" &&
        (plan.availability.available ||
          plan.pricing.status !== "unpublished" ||
          plan.developmentAllowance !== null))
    )
      context.addIssue({
        code: "custom",
        message: "The plan availability is inconsistent.",
      });
  });

export const productCatalogSchema = z
  .object({
    version: z.literal(1),
    catalogVersion: identifier,
    environment: z.enum(["development", "production"]),
    chargingPolicyVersion: identifier,
    plans: z.array(productPlanSchema).min(3).max(8),
  })
  .strict()
  .superRefine((catalog, context) => {
    if (
      new Set(catalog.plans.map((plan) => plan.id)).size !==
        catalog.plans.length ||
      catalog.plans.filter((plan) => plan.mode === "local").length !== 1 ||
      catalog.plans.filter((plan) => plan.mode === "free-cloud").length !== 1 ||
      (catalog.environment === "production" &&
        catalog.plans.some(
          (plan) =>
            plan.mode !== "local" &&
            (plan.availability.available || plan.developmentAllowance !== null),
        ))
    )
      context.addIssue({
        code: "custom",
        message: "The catalog availability is inconsistent.",
      });
  });

export const effectiveProductPlanSchema = z
  .object({
    catalogVersion: identifier,
    planId: planIdentity.planId,
    planVersion: planIdentity.planVersion,
    status: z.enum(["active", "inactive"]),
    periodStart: timestamp,
    periodEnd: timestamp,
    caps: planCapsSchema.nullable(),
  })
  .strict()
  .refine((plan) => Date.parse(plan.periodEnd) > Date.parse(plan.periodStart))
  .refine((plan) => (plan.status === "active") === (plan.caps !== null));

const entitlementSchema = z
  .object({
    id: z.string().uuid(),
    planId: planIdentity.planId,
    planVersion: planIdentity.planVersion,
    status: z.enum(["active", "suspended", "ended"]),
    startsAt: timestamp,
    endsAt: timestamp.nullable(),
    revision: serviceRevisionSchema,
  })
  .strict();

export const productEntitlementsSchema = z
  .object({
    catalogVersion: identifier,
    items: z.array(entitlementSchema).max(100),
    effective: effectiveProductPlanSchema
      .nullable()
      .describe(
        "Null denotes a never-enrolled manual development profile, not a Local processing choice.",
      ),
  })
  .strict();

export const enrollFreeInputSchema = z.object({}).strict();
export const freeEnrollmentSchema = z
  .object({
    effective: effectiveProductPlanSchema,
    grant: z
      .object({
        id: z.string().uuid(),
        amount: serviceQuantitySchema,
        expiresAt: timestamp,
      })
      .strict(),
    replayed: z.boolean(),
  })
  .strict();

export type PlanCaps = z.infer<typeof planCapsSchema>;
export type ProductCatalog = z.infer<typeof productCatalogSchema>;
export type EffectiveProductPlan = z.infer<typeof effectiveProductPlanSchema>;
export type FreeEnrollment = z.infer<typeof freeEnrollmentSchema>;
