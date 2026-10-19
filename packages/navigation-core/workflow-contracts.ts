import { z } from "zod";

export const entitySchema = z
  .object({
    type: z.enum([
      "account",
      "repository",
      "project",
      "issue",
      "branch",
      "plan",
      "query",
      "language",
      "speed",
      "method",
    ]),
    value: z.string().min(1).max(1000),
    source: z.enum(["request", "clarification", "observation"]),
    binding: z
      .object({
        origin: z.string().url(),
        path: z.string().max(500),
        frameId: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
  })
  .strict();
export const controlReferenceSchema = z
  .object({
    tabId: z.number().int(),
    frameId: z.number().int().nonnegative(),
    documentId: z.string().min(1).max(200),
    controlId: z.string().max(100),
  })
  .strict();
export const coverageSchema = z
  .object({
    surfaceId: z.string().max(100),
    role: z.string().max(40),
    indexed: z.number().int().nonnegative(),
    projected: z.number().int().nonnegative(),
    complete: z.boolean(),
    virtualized: z.boolean(),
    omitted: z.number().int().nonnegative(),
  })
  .strict();
export const outcomeEvidenceSchema = z
  .object({
    kind: z.enum(["state", "arrival", "status", "created-item", "failure"]),
    subject: z.string().max(160),
    text: z.string().max(300),
    revision: z.number().int().nonnegative(),
    documentId: z.string().max(200).optional(),
    identity: z.string().max(100).optional(),
    frameId: z.number().int().nonnegative().optional(),
  })
  .strict();
export const workflowContextSchema = z
  .object({
    id: z.string().uuid(),
    requestTaskId: z.string().uuid(),
    guideId: z.string().max(100),
    guideVersion: z.string().max(40),
    original: z.string().max(1000),
    objective: z.string().max(1000),
    outcome: z.enum(["locate", "review", "result"]),
    revision: z.number().int().nonnegative(),
    entities: z.array(entitySchema).max(20),
    exclusions: z.array(z.string().max(1000)).max(256),
    activeMilestone: z.number().int().nonnegative(),
    verified: z
      .array(
        z
          .object({
            milestone: z.string().max(100),
            revision: z.number().int().nonnegative(),
            evidence: outcomeEvidenceSchema,
          })
          .strict(),
      )
      .max(64),
    status: z.enum([
      "active",
      "clarification",
      "review",
      "verifying",
      "completed",
      "failed",
      "paused",
      "canceled",
      "waiting",
    ]),
    pendingAction: z
      .object({
        milestone: z.string().max(100),
        signature: z.string().max(100),
        controlId: z.string().max(100),
        label: z.string().max(160),
        beforeRevision: z.number().int().nonnegative(),
        beforeFingerprint: z.string().max(100),
        acted: z.boolean(),
        startedAt: z.number().nonnegative(),
        beforeControls: z.array(z.string().max(100)).max(600).optional(),
        beforeSignals: z.array(z.string().max(100)).max(30).optional(),
        beforeDocumentId: z.string().max(200).optional(),
        final: z.boolean().optional(),
        frameId: z.number().int().nonnegative().optional(),
      })
      .strict()
      .optional(),
    choice: z.string().max(100).optional(),
    reason: z.string().max(500),
    waitExpired: z.boolean().optional(),
    attempts: z
      .array(
        z
          .object({
            key: z.string().max(100),
            count: z.number().int().min(1).max(3),
            failed: z.boolean(),
          })
          .strict(),
      )
      .max(32)
      .optional(),
  })
  .strict();
export const workflowGuideSchema = z
  .object({
    id: z.string().max(100),
    version: z.string().max(40),
    platform: z.enum([
      "cloudflare",
      "github",
      "jira",
      "youtube",
      "netflix",
      "amazon",
    ]),
    purpose: z.string().max(160),
    intents: z.array(z.string().max(160)).max(20),
    sources: z
      .array(
        z
          .object({
            url: z.string().url(),
            reviewedAt: z.string(),
            sha256: z.string().regex(/^[a-f0-9]{64}$/),
          })
          .strict(),
      )
      .min(1),
    milestones: z
      .array(
        z
          .object({
            id: z.string().max(100),
            purpose: z.string().max(160),
            targets: z.array(z.string().max(160)).min(1).max(12),
            kind: z.enum([
              "navigate",
              "reveal",
              "input",
              "choose",
              "review",
              "result",
            ]),
            entity: entitySchema.shape.type.optional(),
            branch: z.string().max(60).optional(),
            outcome: z.array(z.string().max(160)).max(12).optional(),
            instruction: z.string().max(500),
            context: z.array(z.string().max(100)).max(8).optional(),
          })
          .strict(),
      )
      .min(1)
      .max(64),
    scopeEntities: z.array(entitySchema.shape.type).max(4).optional(),
    subjects: z.array(z.string().max(100)).max(8).optional(),
  })
  .strict();
export type WorkflowContext = z.infer<typeof workflowContextSchema>;
export type WorkflowGuide = z.infer<typeof workflowGuideSchema>;
export type OutcomeEvidence = z.infer<typeof outcomeEvidenceSchema>;
export type ControlReference = z.infer<typeof controlReferenceSchema>;
