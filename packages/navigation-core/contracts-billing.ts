import { z } from "zod";
import {
  SERVICE_LIMITS,
  serviceExpectedRevisionSchema,
  serviceQuantitySchema,
  serviceRevisionSchema,
} from "./contracts-service";
import { productPlanReferenceSchema } from "./contracts-plans";

export const BILLING_LIMITS = Object.freeze({
  maxDeadlineMs: SERVICE_LIMITS.maxDeadlineMs,
  maxWebhookBytes: 64 * 1024,
  maxResponseBytes: 128 * 1024,
  maxSignatureBytes: 4096,
  signatureToleranceSeconds: 300,
  returnSeconds: 300,
  maxInvoices: 20,
});

export const billingModeSchema = z.enum(["fake", "stripe-test", "stripe-live"]);
const timestamp = z.string().datetime({ offset: true });
const plan = productPlanReferenceSchema;
const period = z
  .object({ startsAt: timestamp, endsAt: timestamp })
  .strict()
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt));

/** Billing metadata never supplies browser identity or an inference allowance. */
export const billingSubscriptionSchema = z
  .object({
    version: z.literal(1),
    workspaceId: z.string().uuid(),
    revision: serviceExpectedRevisionSchema,
    mode: billingModeSchema.nullable(),
    status: z.enum([
      "none",
      "pending",
      "active",
      "past-due",
      "ended",
      "uncertain",
      "review",
    ]),
    plan: plan.nullable(),
    period: period.nullable(),
    cancelAtPeriodEnd: z.boolean(),
    managedSpendingHeld: z.boolean(),
    available: z.boolean(),
  })
  .strict();

/** Prices and allowances come from the negotiated product catalog, not a request. */
export const billingCheckoutInputSchema = z
  .object({
    operationId: z.string().uuid(),
    expectedRevision: serviceExpectedRevisionSchema,
    planId: productPlanReferenceSchema.shape.id,
    planVersion: productPlanReferenceSchema.shape.version,
  })
  .strict();

export const billingOperationSchema = z
  .object({
    version: z.literal(1),
    id: z.string().uuid(),
    revision: serviceRevisionSchema,
    status: z.enum([
      "pending",
      "ready",
      "completed",
      "cancelled",
      "rejected",
      "uncertain",
    ]),
    kind: z.enum(["checkout", "portal"]),
    mode: billingModeSchema,
    expiresAt: timestamp,
    // Only an explicit fresh launch can receive a provider URL. Replays are status-only.
    launchUrl: z.string().url().max(4096).nullable(),
  })
  .strict();

export const billingPortalInputSchema = billingCheckoutInputSchema.pick({
  operationId: true,
  expectedRevision: true,
});

export const billingInvoiceSchema = z
  .object({
    id: z.string().uuid(),
    status: z.enum([
      "draft",
      "open",
      "paid",
      "void",
      "uncollectible",
      "review",
    ]),
    amountMinor: serviceQuantitySchema,
    currency: z.string().regex(/^[a-z]{3}$/),
    period,
    issuedAt: timestamp,
  })
  .strict();
export const billingInvoicesSchema = z
  .object({
    version: z.literal(1),
    items: z.array(billingInvoiceSchema).max(BILLING_LIMITS.maxInvoices),
  })
  .strict();

export type BillingMode = z.infer<typeof billingModeSchema>;
export type BillingSubscription = z.infer<typeof billingSubscriptionSchema>;
export type BillingCheckoutInput = z.infer<typeof billingCheckoutInputSchema>;
export type BillingOperation = z.infer<typeof billingOperationSchema>;
