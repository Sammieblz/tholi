import { z } from "zod";
import {
  serviceExpectedRevisionSchema,
  servicePageQuerySchema,
  servicePageSchema,
  serviceRevisionSchema,
} from "./contracts-service";

export const workspaceKindSchema = z.enum(["personal", "organization"]);
export const membershipRoleSchema = z.enum(["owner", "admin", "member"]);
export const membershipStatusSchema = z.enum(["active", "revoked"]);
export const consentPurposeSchema = z.enum([
  "cloud_saved_routes",
  "cloud_inference",
  "image_transmission",
  "product_analytics",
]);
export type ConsentPurpose = z.infer<typeof consentPurposeSchema>;

/** Current service policy versions, independent of host grants and product releases. */
export const AUTHORIZATION_CONSENT_POLICIES = Object.freeze(
  consentPurposeSchema.options.map((purpose) =>
    Object.freeze({ purpose, policyVersion: "1" }),
  ),
);

const storedPurposeSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9_-]*$/);
const policyVersionSchema = z
  .string()
  .min(1)
  .max(100)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._-]*$/);

export const workspaceSchema = z
  .object({
    id: z.string().uuid(),
    kind: workspaceKindSchema,
    ownerAccountId: z.string().uuid(),
    revision: serviceRevisionSchema,
  })
  .strict();
export const membershipSchema = z
  .object({
    accountId: z.string().uuid(),
    role: membershipRoleSchema,
    status: membershipStatusSchema,
    revision: serviceRevisionSchema,
  })
  .strict();
// Stored versions remain readable and revocable after the current catalog changes.
export const consentSchema = z
  .object({
    id: z.string().uuid(),
    purpose: storedPurposeSchema,
    policyVersion: policyVersionSchema,
    granted: z.boolean(),
    revision: serviceRevisionSchema,
  })
  .strict();

export const authorizationPageQuerySchema = servicePageQuerySchema
  .omit({ cursor: true })
  .extend({ after: z.string().uuid().optional() })
  .strict();
const nextCursor = z.string().uuid().optional();
export const workspacePageSchema = servicePageSchema(workspaceSchema).extend({
  nextCursor,
});
export const membershipPageSchema = servicePageSchema(membershipSchema).extend({
  nextCursor,
});
export const consentPageSchema = z
  .object({ items: z.array(consentSchema).max(100) })
  .strict();

/** Existing memberships only. The canonical owner cannot be reassigned here. */
export const membershipUpdateSchema = z
  .object({
    role: z.enum(["admin", "member"]),
    status: membershipStatusSchema,
    expectedRevision: serviceRevisionSchema,
  })
  .strict();
export const consentUpdateSchema = z
  .object({
    purpose: storedPurposeSchema,
    policyVersion: policyVersionSchema,
    granted: z.boolean(),
    expectedRevision: serviceExpectedRevisionSchema,
  })
  .strict();

export const authorizationActionSchema = z.enum([
  "account.read",
  "account.manage",
  "workspaces.list",
  "memberships.read",
  "memberships.update",
  "policies.read",
  "consents.read",
  "consents.write",
  "jobs.read",
  "jobs.cancel",
  "saved-data.read",
  "saved-data.write",
  "saved-data.import",
  "saved-data.export",
  "saved-data.delete",
  "inference.request",
  "image.transmit",
  "usage.read",
  "credits.read",
  "support.request",
  "diagnostics.export",
  "files.read",
  "files.link",
  "files.download",
  "analytics.record",
]);
export type AuthorizationAction = z.infer<typeof authorizationActionSchema>;

export const policyCatalogSchema = z
  .object({
    workspaceId: z.string().uuid(),
    role: membershipRoleSchema,
    allowedActions: z
      .array(authorizationActionSchema)
      .max(authorizationActionSchema.options.length)
      .refine((actions) => new Set(actions).size === actions.length),
    consentPolicies: z
      .array(
        z
          .object({
            purpose: consentPurposeSchema,
            policyVersion: policyVersionSchema,
          })
          .strict(),
      )
      .max(consentPurposeSchema.options.length)
      .refine(
        (policies) =>
          new Set(policies.map((policy) => policy.purpose)).size ===
          policies.length,
      ),
  })
  .strict()
  .describe(
    "Authorization preconditions only. This does not advertise route, provider, upload or credit availability.",
  );

export type Workspace = z.infer<typeof workspaceSchema>;
export type Membership = z.infer<typeof membershipSchema>;
export type Consent = z.infer<typeof consentSchema>;
export type MembershipUpdate = z.infer<typeof membershipUpdateSchema>;
export type ConsentUpdate = z.infer<typeof consentUpdateSchema>;
export type AuthorizationPolicyCatalog = z.infer<typeof policyCatalogSchema>;
