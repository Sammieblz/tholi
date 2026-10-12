import { z } from "zod";
import {
  pageSnapshotSchema,
  goalPlanSchema,
  strategySchema,
  modelProposalSchema,
  journeySchema,
  savedTaskSchema,
  controlSchema,
} from "../page-model";
export const stampSchema = z
  .object({
    requestId: z.string().uuid(),
    documentId: z.string().min(1).max(200),
    revision: z.number().int().nonnegative(),
  })
  .strict();
export const taskIntentSchema = z
  .object({
    id: z.string().uuid(),
    original: z.string().min(1).max(1000),
    operation: z.enum([
      "locate",
      "navigate",
      "reveal",
      "choose",
      "focus",
      "search",
    ]),
    target: z.string().min(1).max(1000),
    desiredValue: z.string().max(1000).optional(),
    qualifiers: z.array(z.string().max(1000)).max(256),
    exclusions: z.array(z.string().max(1000)).max(256),
    scope: z.enum(["page", "section", "any"]),
    status: z.enum(["pending", "active", "completed", "skipped", "blocked"]),
    boundSignature: z.string().max(100).optional(),
    contextTarget: z.string().max(1000).optional(),
    needsReference: z.boolean().optional(),
    negatedOnly: z.boolean().optional(),
    searchPhase: z.enum(["input", "results", "destination"]).optional(),
  })
  .strict();
export const requestSchema = z
  .object({
    id: z.string().uuid(),
    original: z.string().min(1).max(1000),
    tasks: z.array(taskIntentSchema).min(1).max(3),
    active: z.number().int().min(0).max(3),
    status: z.enum([
      "active",
      "paused",
      "completed",
      "canceled",
      "clarification",
      "blocked",
    ]),
    createdAt: z.number().nonnegative(),
    resumeStatus: z.enum(["active", "clarification", "blocked"]).optional(),
  })
  .strict();
export const clarificationSchema = z
  .object({
    question: z.string().max(300),
    choices: z
      .array(
        z
          .object({
            id: z.string().max(100),
            label: z.string().max(200),
            signature: z.string().max(100),
            target: z.string().max(160),
          })
          .strict(),
      )
      .min(2)
      .max(3),
  })
  .strict();
export const planInputSchema = stampSchema
  .extend({
    text: z.string().min(1).max(1000),
    observation: pageSnapshotSchema,
    strategy: strategySchema.default("fastest"),
    request: requestSchema.optional(),
    journey: journeySchema.optional(),
    savedRoute: savedTaskSchema.optional(),
    choice: z.string().max(100).optional(),
    context: z
      .object({
        target: z.string().max(1000).optional(),
        verifiedDestination: z.string().max(160).optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .refine(
    (v) => v.revision === v.observation.revision,
    "Observation revision mismatch",
  );
export const resultSchema = stampSchema
  .extend({
    status: z.enum([
      "plan",
      "clarification",
      "pending-indexing",
      "unsupported",
    ]),
    request: requestSchema.optional(),
    clarification: clarificationSchema.optional(),
    plan: goalPlanSchema.optional(),
    proposal: modelProposalSchema.optional(),
    canonicalGoal: z.string().max(1000).optional(),
    reason: z.string().max(500),
    activity: z
      .object({
        embedded: z.number().int().nonnegative(),
        cacheHits: z.number().int().nonnegative(),
        llmCalls: z.literal(0),
        modelRevision: z.string(),
      })
      .strict(),
  })
  .strict();
export const observationInputSchema = z
  .object({ observation: pageSnapshotSchema })
  .strict();
const memoryControlSchema = controlSchema
  .omit({
    id: true,
    revealIds: true,
    inViewport: true,
    placement: true,
    navigationKey: true,
  })
  .extend({ lastSeen: z.number().nonnegative(), active: z.boolean() })
  .strict();
const memoryPageSchema = z
  .object({
    key: z.string().max(100),
    path: z.string().max(500),
    templateKey: z.string().max(100),
    fingerprint: z.string().max(100),
    version: z.number().nonnegative(),
    lastSeen: z.number().nonnegative(),
    controls: z.array(memoryControlSchema).max(600),
    stateKey: z.string().max(100),
    language: z.string().max(20).optional(),
  })
  .strict();
export const siteKnowledgeSchema = z
  .object({
    schemaVersion: z.literal(1),
    origin: z.string().url().max(300),
    version: z.number().nonnegative(),
    lastSeen: z.number().nonnegative(),
    pages: z.array(memoryPageSchema).max(100),
    states: z.array(memoryPageSchema).max(120).optional(),
    templates: z
      .array(
        z
          .object({
            key: z.string().max(100),
            fingerprint: z.string().max(100),
            version: z.number().nonnegative(),
            lastSeen: z.number().nonnegative(),
          })
          .strict(),
      )
      .max(30),
    transitions: z
      .array(
        z
          .object({
            from: z.string().max(100),
            to: z.string().max(100),
            signature: z.string().max(100),
            label: z.string().max(160),
            evidence: z.enum(["observed", "inferred"]),
            lastVerified: z.number().nonnegative(),
            active: z.boolean(),
            samples: z.number().nonnegative().optional(),
            meanMs: z.number().nonnegative().optional(),
          })
          .strict(),
      )
      .max(400),
  })
  .strict();
export type TaskIntent = z.infer<typeof taskIntentSchema>;
export type NavigationRequest = z.infer<typeof requestSchema>;
export type PlanInput = z.infer<typeof planInputSchema>;
export type PlanResult = z.infer<typeof resultSchema>;
export type Clarification = z.infer<typeof clarificationSchema>;
