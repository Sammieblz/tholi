import { z } from "zod";
import { workflowGuideSchema } from "./workflow-contracts";
import { navigationKnowledgeOriginSchema } from "./contracts-navigation-knowledge";
import {
  serviceExpectedRevisionSchema,
  serviceRevisionSchema,
} from "./contracts-service";
import { sanitizeSavedText } from "../privacy-redaction";
import { ORGANIZATION_LIMITS } from "./organization-limits";
export { ORGANIZATION_LIMITS } from "./organization-limits";

const safeText = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(
      (s) => sanitizeSavedText(s, max) === s,
      "Preview and remove private values before sharing.",
    );
const hash = z.string().regex(/^[a-f0-9]{64}$/);
export const organizationPolicySchema = z
  .object({
    schemaVersion: z.literal(1),
    allowedOrigins: z
      .array(navigationKnowledgeOriginSchema)
      .max(20)
      .refine((a) => new Set(a).size === a.length),
    cloudInference: z.boolean(),
    imageTransmission: z.boolean(),
    persistentLearning: z.boolean(),
    providers: z
      .array(z.enum(["openai", "anthropic", "openrouter", "gemini"]))
      .max(4)
      .refine((a) => new Set(a).size === a.length),
  })
  .strict()
  .refine(
    (p) =>
      p.cloudInference || (!p.imageTransmission && p.providers.length === 0),
    "Provider and image access require inference policy permission.",
  );
export type OrganizationPolicy = z.infer<typeof organizationPolicySchema>;
export const DEFAULT_ORGANIZATION_POLICY: OrganizationPolicy = Object.freeze({
  schemaVersion: 1,
  allowedOrigins: [],
  cloudInference: false,
  imageTransmission: false,
  persistentLearning: false,
  providers: [],
}) as OrganizationPolicy;
export const organizationPolicyRecordSchema = z
  .object({
    revision: serviceExpectedRevisionSchema,
    policy: organizationPolicySchema,
  })
  .strict();
export const organizationPolicyInputSchema = z
  .object({
    expectedRevision: serviceExpectedRevisionSchema,
    policy: organizationPolicySchema,
  })
  .strict();

export const organizationWorkflowStatusSchema = z.enum([
  "draft",
  "review",
  "approved",
  "published",
  "retired",
]);
export const organizationWorkflowSchema = z
  .object({
    schemaVersion: z.literal(1),
    id: z.string().uuid(),
    revision: serviceRevisionSchema,
    authorId: z.string().uuid(),
    reviewerId: z.string().uuid().nullable(),
    status: organizationWorkflowStatusSchema,
    origin: navigationKnowledgeOriginSchema,
    guide: workflowGuideSchema,
    contentHash: hash,
    createdAt: z.string().datetime({ offset: true }),
  })
  .strict();
export type OrganizationWorkflow = z.infer<typeof organizationWorkflowSchema>;
export const publishedGuideQuerySchema = z
  .object({
    origin: navigationKnowledgeOriginSchema,
    selection: z
      .object({
        id: z.string().uuid(),
        revision: serviceRevisionSchema,
        index: z.number().int().min(0).max(63),
      })
      .strict()
      .optional(),
  })
  .strict();
export const publishedGuideListSchema = z
  .object({
    items: z
      .array(
        organizationWorkflowSchema.pick({ id: true, revision: true }).extend({
          title: z.string().max(160),
        }),
      )
      .max(ORGANIZATION_LIMITS.workflows),
  })
  .strict();
export const publishedGuideStepSchema = z
  .object({
    milestone: workflowGuideSchema.shape.milestones.element,
    count: z.number().int().min(1).max(64),
  })
  .strict();
export const organizationWorkflowDraftSchema = z
  .object({
    expectedRevision: serviceExpectedRevisionSchema,
    origin: navigationKnowledgeOriginSchema,
    guide: workflowGuideSchema,
  })
  .strict()
  .superRefine((value, ctx) => {
    const text = JSON.stringify(value.guide);
    if (new TextEncoder().encode(text).byteLength > 24576)
      ctx.addIssue({
        code: "custom",
        message: "The workflow exceeds its size limit.",
      });
    // Captures share safe vocabulary, not field values, native IDs or selectors.
    for (const step of value.guide.milestones) {
      for (const label of [
        step.purpose,
        step.instruction,
        ...step.targets,
        ...(step.context || []),
      ]) {
        if (sanitizeSavedText(label, 1000) !== label)
          ctx.addIssue({
            code: "custom",
            message: "Preview and remove private values before sharing.",
          });
      }
    }
  });
export type OrganizationWorkflowDraft = z.infer<
  typeof organizationWorkflowDraftSchema
>;
export const organizationWorkflowActionSchema = z
  .object({
    expectedRevision: serviceRevisionSchema,
    action: z.enum(["submit", "approve", "publish", "retire", "restore"]),
    publishedRevision: serviceRevisionSchema.optional(),
    contentHash: hash,
  })
  .strict();
export const organizationPublicationHistorySchema = z
  .object({
    revisions: z
      .array(
        z
          .object({
            revision: serviceRevisionSchema,
            publishedAt: z.string().datetime(),
          })
          .strict(),
      )
      .max(50),
  })
  .strict();
export type OrganizationWorkflowAction = z.infer<
  typeof organizationWorkflowActionSchema
>;
export const organizationWorkflowPageSchema = z
  .object({
    items: z
      .array(organizationWorkflowSchema)
      .max(ORGANIZATION_LIMITS.workflows),
  })
  .strict();

const knowledgeDocumentBaseSchema = z
  .object({
    schemaVersion: z.literal(1),
    title: safeText(120),
    origin: navigationKnowledgeOriginSchema,
    sourceUrl: z.string().url().max(2048).optional(),
    format: z.enum(["text", "markdown", "html", "pdf", "docx"]),
    // Documentary content is deliberately imported private data, never navigation evidence.
    text: z.string().min(1).max(ORGANIZATION_LIMITS.extractedBytes),
  })
  .strict();
function validateCitationUrl(
  document: { origin: string; sourceUrl?: string },
  ctx: z.RefinementCtx,
) {
  if (!document.sourceUrl) return;
  try {
    const url = new URL(document.sourceUrl);
    if (
      url.protocol !== "https:" ||
      url.origin !== document.origin ||
      url.username ||
      url.password ||
      url.search ||
      url.hash ||
      url.href !== document.sourceUrl
    )
      ctx.addIssue({
        code: "custom",
        message:
          "A source citation must be a canonical HTTPS URL on its origin.",
        path: ["sourceUrl"],
      });
  } catch {
    ctx.addIssue({
      code: "custom",
      message: "A source citation must be a canonical HTTPS URL on its origin.",
      path: ["sourceUrl"],
    });
  }
}
export const knowledgeDocumentSchema =
  knowledgeDocumentBaseSchema.superRefine(validateCitationUrl);
export const knowledgeFileImportSchema = knowledgeDocumentBaseSchema
  .omit({ text: true })
  .extend({
    base64: z
      .string()
      .min(4)
      .max(Math.ceil(ORGANIZATION_LIMITS.documentBytes / 3) * 4)
      .regex(
        /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/,
      ),
  })
  .strict()
  .superRefine(validateCitationUrl);
export const publicDocumentationCrawlSchema = z
  .object({
    schemaVersion: z.literal(1),
    origin: navigationKnowledgeOriginSchema,
    url: z.string().url().max(2048),
  })
  .strict()
  .superRefine((value, ctx) => {
    try {
      const url = new URL(value.url);
      if (
        url.protocol !== "https:" ||
        url.origin !== value.origin ||
        url.username ||
        url.password ||
        url.search ||
        url.hash ||
        url.href !== value.url
      )
        ctx.addIssue({
          code: "custom",
          message: "Choose a canonical HTTPS page from the approved origin.",
        });
    } catch {
      ctx.addIssue({
        code: "custom",
        message: "Choose a canonical HTTPS page from the approved origin.",
      });
    }
  });
export const knowledgeSourceSchema = z
  .object({
    id: z.string().uuid(),
    revision: serviceRevisionSchema,
    title: z.string().max(120),
    origin: navigationKnowledgeOriginSchema,
    sourceUrl: z.string().url().max(2048).optional(),
    sha256: hash,
    observedAt: z.string().datetime({ offset: true }),
    chunks: z.number().int().min(1).max(ORGANIZATION_LIMITS.chunks),
  })
  .strict()
  .superRefine(validateCitationUrl);
export const knowledgeSourcePageSchema = z
  .object({
    items: z.array(knowledgeSourceSchema).max(ORGANIZATION_LIMITS.sources),
  })
  .strict();
export const publicDocumentationCrawlResultSchema = z
  .object({
    schemaVersion: z.literal(1),
    visited: z.number().int().min(0).max(500),
    skipped: z.number().int().min(0).max(500),
    sources: z.array(knowledgeSourceSchema).max(ORGANIZATION_LIMITS.crawlPages),
  })
  .strict();
export const knowledgeSourceExportSchema = z
  .object({
    schemaVersion: z.literal(1),
    evidence: z.literal("documentation"),
    source: knowledgeSourceSchema,
    sections: z
      .array(z.string().max(ORGANIZATION_LIMITS.chunkBytes))
      .max(ORGANIZATION_LIMITS.chunks),
  })
  .strict();
export const knowledgeQuerySchema = z
  .object({ origin: navigationKnowledgeOriginSchema, query: safeText(1000) })
  .strict();
export const documentaryBundleSchema = z
  .object({
    sourceId: z.string().uuid(),
    sourceRevision: serviceRevisionSchema,
    sourceHash: hash,
    title: z.string().max(120),
    sourceUrl: z.string().url().max(2048).optional(),
    locator: z.string().max(120),
    text: z.string().max(ORGANIZATION_LIMITS.chunkBytes),
    evidence: z.literal("documentation"),
  })
  .strict();
export const documentaryRetrievalSchema = z
  .object({
    schemaVersion: z.literal(1),
    snapshot: hash,
    bundles: z
      .array(documentaryBundleSchema)
      .max(ORGANIZATION_LIMITS.retrievalBundles),
  })
  .strict();
export type DocumentaryBundle = z.infer<typeof documentaryBundleSchema>;
