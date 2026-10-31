import { z } from "zod";
import { privateFileRequestSchema } from "./contracts-private-files";
import {
  serviceCursorSchema,
  serviceRevisionSchema,
  servicePageQuerySchema,
  servicePageSchema,
} from "./contracts-service";
import { savedDataRecordSchema } from "./contracts-saved-data";
import {
  consentSchema,
  membershipRoleSchema,
  workspaceKindSchema,
} from "./contracts-authorization";
import { identitySessionsSchema } from "./contracts-identity";
import {
  creditHistoryEntrySchema,
  creditUsageEntrySchema,
  workspaceCreditsSchema,
} from "./contracts-credits";
import {
  effectiveProductPlanSchema,
  productEntitlementsSchema,
} from "./contracts-plans";
import { productAnalyticsRecordSchema } from "./contracts-analytics";
import { supportInputSchema, SUPPORT_LIMITS } from "./contracts-support";

export const ACCOUNT_EXPORT_LIMITS = Object.freeze({
  rows: 10000,
  bytes: 4 * 1024 * 1024,
  parts: 64,
  page: 100,
});
const identifier = z.string().uuid();
const instant = z.string().datetime({ offset: true });
export const accountExportInputSchema = z
  .object({
    idempotencyKey: identifier,
    continuation: serviceCursorSchema.optional(),
  })
  .strict();
export const accountExportStatusSchema = privateFileRequestSchema
  .extend({
    generation: identifier,
    preparation: z.enum(["complete", "partial"]),
    delivery: z.enum(["pending", "ready", "failed", "expired"]),
    continuation: serviceCursorSchema.nullable(),
    expiresAt: instant,
  })
  .strict();
export const accountExportPageSchema = servicePageSchema(
  accountExportStatusSchema,
);
export const accountExportQuerySchema = servicePageQuerySchema;

const profile = z
  .object({
    accountId: identifier,
    revision: serviceRevisionSchema,
    createdAt: instant,
    updatedAt: instant,
  })
  .strict();
const contact = z
  .object({
    identityId: identifier,
    verifiedEmail: z.string().email().max(254).nullable(),
  })
  .strict();
const membership = z
  .object({
    workspaceId: identifier,
    kind: workspaceKindSchema,
    role: membershipRoleSchema,
    status: z.literal("active"),
    revision: serviceRevisionSchema,
  })
  .strict();
const plan = z.discriminatedUnion("kind", [
  z
    .object({
      kind: z.literal("effective"),
      value: effectiveProductPlanSchema.nullable(),
    })
    .strict(),
  z
    .object({
      kind: z.literal("entitlement"),
      value: productEntitlementsSchema.shape.items.element,
    })
    .strict(),
]);
const support = z
  .object({
    requestId: identifier,
    name: supportInputSchema.shape.name.unwrap().nullable(),
    email: supportInputSchema.shape.email.nullable(),
    topic: supportInputSchema.shape.topic,
    subject: supportInputSchema.shape.subject.nullable(),
    message: supportInputSchema.shape.message.nullable(),
    createdAt: instant,
    purgedAt: instant.nullable(),
    expiresAt: instant,
  })
  .strict();
const part = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("account-export-part"),
    generation: identifier,
    accountId: identifier,
    workspaceId: identifier.nullable(),
    cutoff: instant,
  })
  .strict();
export const accountExportPartSchema = z.discriminatedUnion("section", [
  part.extend({
    section: z.literal("profile"),
    items: z.array(profile).max(100),
  }),
  part.extend({
    section: z.literal("contacts"),
    items: z.array(contact).max(100),
  }),
  part.extend({
    section: z.literal("sessions"),
    items: z.array(identitySessionsSchema.shape.items.element).max(100),
  }),
  part.extend({
    section: z.literal("memberships"),
    items: z.array(membership).max(100),
  }),
  part.extend({
    section: z.literal("consents"),
    items: z.array(consentSchema).max(100),
  }),
  part.extend({
    section: z.literal("saved_data"),
    items: z.array(savedDataRecordSchema).max(100),
  }),
  part.extend({ section: z.literal("plans"), items: z.array(plan).max(100) }),
  part.extend({
    section: z.literal("credits"),
    items: z.array(workspaceCreditsSchema).max(100),
  }),
  part.extend({
    section: z.literal("credit_history"),
    items: z.array(creditHistoryEntrySchema).max(100),
  }),
  part.extend({
    section: z.literal("usage"),
    items: z.array(creditUsageEntrySchema).max(100),
  }),
  part.extend({
    section: z.literal("support"),
    items: z.array(support).max(100),
  }),
  part.extend({
    section: z.literal("product_events"),
    items: z.array(productAnalyticsRecordSchema).max(100),
  }),
]);
export const accountExportSectionSchema = z.enum([
  "profile",
  "contacts",
  "sessions",
  "memberships",
  "consents",
  "saved_data",
  "plans",
  "credits",
  "credit_history",
  "usage",
  "support",
  "product_events",
]);
const omission = z
  .object({
    workspaceId: identifier.nullable(),
    section: accountExportSectionSchema,
    reason: z.enum([
      "workspace-access-revoked",
      "changed-during-collection",
      "not-exportable",
    ]),
  })
  .strict();
export const accountExportManifestSchema = z
  .object({
    schemaVersion: z.literal(1),
    kind: z.literal("account-export-manifest"),
    generation: identifier,
    accountId: identifier,
    startedAt: instant,
    completedAt: instant,
    cutoff: instant,
    consistency: z.literal("collected-over-interval"),
    scope: z
      .object({
        workspaces: z.literal("current-memberships"),
        workspaceIds: z.array(identifier).max(100),
      })
      .strict(),
    parts: z
      .array(
        z
          .object({
            fileId: identifier,
            section: accountExportSectionSchema,
            workspaceId: identifier.nullable(),
            count: z.number().int().min(0).max(ACCOUNT_EXPORT_LIMITS.page),
            bytes: z.number().int().positive().max(SUPPORT_LIMITS.maxFileBytes),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .max(ACCOUNT_EXPORT_LIMITS.parts),
    previousManifestFileId: identifier.nullable(),
    continuation: serviceCursorSchema.nullable(),
    complete: z.boolean(),
    omissions: z.array(omission).max(100),
  })
  .strict()
  .refine(
    (value) =>
      !value.complete ||
      (value.continuation === null && value.omissions.length === 0),
    "An incomplete preparation must not be described as complete.",
  );

export const accountDeletionInputSchema = z
  .object({
    operationId: identifier,
    expectedRevision: serviceRevisionSchema,
    confirmation: z.literal("DELETE"),
  })
  .strict();
export const accountDeletionResultSchema = z
  .object({
    requestId: identifier,
    jobId: identifier,
    status: z.literal("deletion_pending"),
    signedOut: z.literal(true),
    retained: z.tuple([
      z.literal("identity-and-abuse-prevention"),
      z.literal("financial-liabilities"),
      z.literal("security-audit"),
      z.literal("deletion-tombstones"),
    ]),
  })
  .strict();

export type AccountExportInput = z.infer<typeof accountExportInputSchema>;
export type AccountExportStatus = z.infer<typeof accountExportStatusSchema>;
export type AccountExportPage = z.infer<typeof accountExportPageSchema>;
export type AccountExportQuery = z.infer<typeof accountExportQuerySchema>;
export type AccountExportPart = z.infer<typeof accountExportPartSchema>;
export type AccountExportManifest = z.infer<typeof accountExportManifestSchema>;
export type AccountExportSection = z.infer<typeof accountExportSectionSchema>;
export type AccountDeletionInput = z.infer<typeof accountDeletionInputSchema>;
export type AccountDeletionResult = z.infer<typeof accountDeletionResultSchema>;
