import { z } from "zod";
import { authorizationPageQuerySchema } from "./contracts-authorization";
import { servicePageSchema, serviceQuantitySchema } from "./contracts-service";

/** Product measurements are independent of the API, extension and release versions. */
export const PRODUCT_ANALYTICS_VERSION = 1;
export const PRODUCT_ANALYTICS_LIMITS = Object.freeze({
  maxBodyBytes: 4096,
  retentionMs: 30 * 24 * 60 * 60 * 1000,
  dailyEvents: 1000,
} as const);
export const PRODUCT_ANALYTICS_PROVIDER = Object.freeze({
  id: "tholi-account",
  disclosure: "product-analytics-v1",
});
export const productPageSchema = z.enum([
  "home",
  "about",
  "download",
  "support",
  "contact",
  "onboarding",
  "docs",
  "privacy",
  "terms",
  "cookies",
  "account",
]);
const practiceSchema = z.enum(["account-settings", "language-preference"]);
/** No free-form labels, IDs, URLs, client times or navigation content. */
export const productEventSchema = z.discriminatedUnion("name", [
  z.object({ name: z.literal("page_view"), page: productPageSchema }).strict(),
  z.object({ name: z.literal("download_click") }).strict(),
  z
    .object({
      name: z.literal("store_listing_opened"),
      browser: z.enum(["chromium", "firefox"]),
    })
    .strict(),
  z
    .object({ name: z.literal("practice_start"), practice: practiceSchema })
    .strict(),
  z
    .object({ name: z.literal("practice_complete"), practice: practiceSchema })
    .strict(),
  z.object({ name: z.literal("onboarding_complete") }).strict(),
]);
export type ProductEvent = z.infer<typeof productEventSchema>;

/** Later producers must establish activation or authoritative allowance admission. */
export const productFunnelEventSchema = z.discriminatedUnion("name", [
  z
    .object({
      name: z.literal("mode_activated"),
      mode: z.enum(["local", "free-cloud", "paid-cloud"]),
    })
    .strict(),
  z
    .object({
      name: z.literal("allowance_exhausted"),
      mode: z.enum(["free-cloud", "paid-cloud"]),
    })
    .strict(),
]);
export const PRODUCT_FUNNEL_AVAILABILITY = Object.freeze({
  publicOnboardingFunnel: "unavailable",
  localActivation: "unavailable",
  freeCloudActivation: "unavailable",
  paidCloudActivation: "unavailable",
  allowanceExhaustion: "unavailable",
} as const);

export const recordProductEventInputSchema = z
  .object({
    schemaVersion: z.literal(PRODUCT_ANALYTICS_VERSION),
    eventId: z.string().uuid(),
    event: productEventSchema,
  })
  .strict();
export const productAnalyticsReceiptSchema = z
  .object({ recorded: z.boolean() })
  .strict();
export const productAnalyticsRecordSchema = recordProductEventInputSchema
  .extend({
    recordedAt: z.string().datetime({ offset: true }),
  })
  .strict();
export const productAnalyticsQuerySchema = authorizationPageQuerySchema;
export const productAnalyticsPageSchema = servicePageSchema(
  productAnalyticsRecordSchema,
).extend({ nextCursor: z.string().uuid().optional() });
export const productAnalyticsDeletedSchema = z
  .object({ deleted: serviceQuantitySchema })
  .strict();
export type RecordProductEventInput = z.infer<
  typeof recordProductEventInputSchema
>;
export type ProductAnalyticsRecord = z.infer<
  typeof productAnalyticsRecordSchema
>;
export type ProductAnalyticsQuery = z.infer<typeof productAnalyticsQuerySchema>;
