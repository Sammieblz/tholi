import { z } from "zod";
import {
  nativeBrowserReferenceSchema,
  navigationProposalSchema,
  navigationServiceStateSchema,
  navigationProcessingProfileSchema,
  navigationEvaluationContextSchema,
} from "../navigation-core/contracts-navigation";
import {
  requestSchema,
  clarificationSchema,
  resultSchema,
} from "../navigation-core/contracts";
import { liveDiagnosticsSchema } from "../live-diagnostics";
import {
  discoveryPerceptionSchema,
  perceptionOmissionsSchema,
  regionObservationRequestSchema,
} from "../page-discovery/perception";
import {
  controlSchema,
  pageSnapshotSchema,
  goalPlanSchema,
  modelProposalSchema,
  journeySchema,
  savedTaskSchema,
  strategySchema,
  pendingNavigationSchema,
  routeFeedbackSchema,
} from "../page-model";

/** Ephemeral content binding after the background has joined the full proposal. */
export const navigationProposalBindingSchema = z
  .object({
    requestId: z.string().uuid(),
    activeTaskId: z.string().uuid(),
    journeyId: z.string().uuid(),
    pageRevision: z.number().int().nonnegative().safe(),
    viewportRevision: z.number().int().nonnegative().safe(),
    contextRevision: z.number().int().nonnegative().safe(),
    native: nativeBrowserReferenceSchema.refine(
      (native) => native.frameId === 0,
    ),
  })
  .strict();
export const navigationProposalMessageSchema = z
  .object({
    type: z.literal("APPLY_NAVIGATION_PROPOSAL"),
    sessionId: z.string().uuid(),
    binding: navigationProposalBindingSchema,
    decision: navigationProposalSchema,
    profile: navigationProcessingProfileSchema,
    evaluation: navigationEvaluationContextSchema.optional(),
    transportRequestId: z.string().uuid().optional(),
  })
  .strict();
export type NavigationProposalMessage = z.infer<
  typeof navigationProposalMessageSchema
>;
const risk = z.enum([
  "navigation",
  "preference",
  "consequential",
  "high-stakes",
  "unauthorized",
]);
const landmark = z
  .object({
    role: z.string().min(1),
    names: z.array(z.string().min(1)).min(1),
    anyName: z.boolean().default(false),
    required: z.boolean().default(true),
    selector: z.string().min(1).max(200).optional(),
    inViewport: z.boolean().optional(),
  })
  .strict();
export const targetSchema = landmark
  .extend({
    context: z.string().optional(),
    synonyms: z.array(z.string()).default([]),
    stableSelector: z.string().optional(),
    disallowedNearbyText: z.array(z.string()).default([]),
    minimumConfidence: z.number().min(0).max(1).default(0.8),
  })
  .strict();
const stateSchema = z
  .object({
    id: z.string().min(1),
    urlPatterns: z.array(z.string()).default([]),
    urlPrefixes: z.array(z.string().startsWith("/")).default([]),
    landmarks: z.array(landmark).min(1),
    absentLandmarks: z.array(landmark).default([]),
    modal: z.boolean().optional(),
    minimumConfidence: z.number().min(0).max(1).default(0.8),
    behavior: z
      .enum(["navigate", "checkpoint", "boundary", "success"])
      .default("navigate"),
  })
  .strict();
const transitionSchema = z
  .object({
    id: z.string(),
    from: z.string(),
    to: z.array(z.string()).min(1),
    actor: z.literal("user"),
    risk,
    target: targetSchema,
    instruction: z.string(),
    timeoutMs: z.number().positive().default(8000),
    onTimeout: z.literal("relocalize").default("relocalize"),
    onUnknown: z.literal("stop").default("stop"),
  })
  .strict();
export const routeSchema = z
  .object({
    id: z.string(),
    taskId: z.string(),
    title: z.string(),
    siteName: z.string().default("Supported website"),
    description: z.string().default(""),
    safetyNote: z
      .string()
      .default("You control website changes. Tholi never submits for you."),
    completionInstruction: z
      .string()
      .default(
        "You reached your destination. Visible route evidence verified.",
      ),
    boundaryInstruction: z
      .string()
      .default("Tholi stops here. The final action is yours to decide."),
    milestoneStates: z.record(z.number().int().nonnegative()).default({}),
    version: z.string(),
    lastVerified: z.string(),
    origins: z.array(z.string().url()).min(1),
    allowQuery: z.boolean().default(true),
    startStates: z.array(z.string()).min(1),
    states: z.array(stateSchema).min(1),
    transitions: z.array(transitionSchema),
    successStates: z.array(z.string()),
    milestones: z.array(z.string()),
  })
  .strict()
  .superRefine((route, ctx) => {
    for (const predicate of route.states.flatMap((s) => [
      ...s.landmarks,
      ...s.absentLandmarks,
    ]))
      if (
        predicate.anyName &&
        (predicate.role !== "heading" || !predicate.selector)
      )
        ctx.addIssue({
          code: "custom",
          message: "Any-name predicates require a heading role and selector",
        });
    if (route.transitions.some((t) => t.target.anyName))
      ctx.addIssue({
        code: "custom",
        message: "Targets require explicit semantic names",
      });
    const ids = route.states.map((s) => s.id);
    for (const [id, index] of Object.entries(route.milestoneStates)) {
      if (!ids.includes(id) || index >= route.milestones.length)
        ctx.addIssue({
          code: "custom",
          message: "Invalid milestone mapping: " + id,
        });
    }
    if (new Set(ids).size !== ids.length)
      ctx.addIssue({ code: "custom", message: "Duplicate state IDs" });
    if (
      new Set(route.transitions.map((t) => t.id)).size !==
      route.transitions.length
    )
      ctx.addIssue({ code: "custom", message: "Duplicate transition IDs" });
    for (const id of [
      ...route.startStates,
      ...route.successStates,
      ...route.transitions.flatMap((t) => [t.from, ...t.to]),
    ])
      if (!ids.includes(id))
        ctx.addIssue({ code: "custom", message: "Unknown state: " + id });
    for (const id of route.successStates)
      if (route.states.find((s) => s.id === id)?.behavior !== "success")
        ctx.addIssue({
          code: "custom",
          message: "Success state must declare success behavior",
        });
    for (const t of route.transitions)
      if (route.states.find((s) => s.id === t.from)?.behavior === "boundary")
        ctx.addIssue({
          code: "custom",
          message: "No transitions out of a hard-stop boundary",
        });
  });
export type Route = z.infer<typeof routeSchema>;
export type Target = z.infer<typeof targetSchema>;
export type RouteState = Route["states"][number];
export type Transition = Route["transitions"][number];
export const messageSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("GET_JOURNEYS") }).strict(),
  z
    .object({ type: z.literal("RESUME_JOURNEY"), id: z.string().uuid() })
    .strict(),
  z
    .object({ type: z.literal("DELETE_JOURNEY"), id: z.string().uuid() })
    .strict(),
  z.object({ type: z.literal("CHECK_ROUTE_ACTION") }).strict(),
  z.object({ type: z.literal("CHECK_VISUAL_ACTION") }).strict(),
  z.object({ type: z.literal("REQUEST_VISION") }).strict(),
  z.object({ type: z.literal("GET_VISION") }).strict(),
  z.object({ type: z.literal("SET_VISION"), backend: z.boolean() }).strict(),
  z
    .object({
      type: z.literal("NLP_SUGGEST"),
      text: z.string().min(1).max(1000),
      requestId: z.string().uuid(),
    })
    .strict(),
  z
    .object({ type: z.literal("CLARIFY"), choice: z.string().max(100) })
    .strict(),
  z.object({ type: z.literal("SKIP_TASK") }).strict(),
  z
    .object({
      type: z.literal("WORKFLOW_ACTION"),
      action: z.enum(["CONTINUE", "WAIT", "RETRY"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("WORKFLOW_ENTITY"),
      entity: z.enum([
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
    })
    .strict(),
  z.object({ type: z.literal("GET_BACKEND") }).strict(),
  z
    .object({
      type: z.literal("SET_BACKEND"),
      url: z.string().max(300),
      token: z.string().max(300),
      enabled: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("GET_PAGE"),
      regionObservation: regionObservationRequestSchema.optional(),
    })
    .strict(),
  z.object({ type: z.literal("GET_MEMORY") }).strict(),
  z.object({ type: z.literal("FORGET_SITE") }).strict(),
  z.object({ type: z.literal("CLEAR_MEMORY") }).strict(),
  z.object({ type: z.literal("GET_TASKS") }).strict(),
  z
    .object({ type: z.literal("DELETE_TASK"), id: z.string().max(100) })
    .strict(),
  z.object({ type: z.literal("CONTINUE_TASK") }).strict(),
  z
    .object({
      type: z.literal("SET_GOAL"),
      goal: z.string().min(1).max(1000),
      revision: z.number().int().nonnegative(),
      sessionId: z.string().uuid().optional(),
      documentId: z.string().min(1).max(200).optional(),
      proposal: modelProposalSchema.optional(),
      strategy: strategySchema.optional(),
      journeyId: z.string().uuid().optional(),
      savedRouteId: z.string().max(100).optional(),
    })
    .strict(),
  z.object({ type: z.literal("GET_SESSION") }).strict(),
  z.object({ type: z.literal("GET_CONTEXT") }).strict(),
  z
    .object({
      type: z.literal("START"),
      tabId: z.number().int().nonnegative().optional(),
      origin: z.string().url().max(300).optional(),
      routeId: z.string().min(1),
      routeVersion: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("PAUSE"),
      sessionId: z.string().uuid().optional(),
      documentId: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z.object({ type: z.literal("RESUME") }).strict(),
  z
    .object({
      type: z.literal("STOP"),
      sessionId: z.string().uuid().optional(),
      documentId: z.string().min(1).max(200).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("GUIDE_CONTROL"),
      controlId: z.string().regex(/^w[0-9a-f]{16}-[0-9]+$/),
    })
    .strict(),
]);

export const contentMessageSchema = z.discriminatedUnion("type", [
  navigationProposalMessageSchema,
  z
    .object({
      type: z.literal("ASSIST_STEP"),
      sessionId: z.string().uuid(),
      documentId: z.string().min(1).max(200),
      requestId: z.string().uuid(),
      controlId: z.string().regex(/^w[0-9a-f]{16}-[0-9]+$/),
      revision: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      type: z.literal("FRAME_ACCESS"),
      sessionId: z.string().uuid(),
      origins: z.array(z.string().url()).max(16),
      limit: z.number().int().min(1).max(5000),
      nonce: z.string().uuid(),
      omissions: perceptionOmissionsSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("FRAME_VISIBILITY_PARENT"),
      sessionId: z.string().uuid(),
      frameId: z.number().int(),
      documentId: z.string(),
      visible: z.boolean(),
      inViewport: z.boolean(),
      placement: z.enum(["above", "below", "left", "right", "viewport"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("FRAME_OBSERVATION_PARENT"),
      sessionId: z.string().uuid(),
      frameId: z.number().int(),
      documentId: z.string(),
      tabId: z.number().int(),
      parentFrameId: z.number().int().nonnegative(),
      page: pageSnapshotSchema,
      perception: discoveryPerceptionSchema.optional(),
      deferRefresh: z.boolean().optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("FRAME_INTERACTION_PARENT"),
      sessionId: z.string().uuid(),
      frameId: z.number().int(),
      documentId: z.string(),
      tabId: z.number().int(),
      controlId: z.string(),
      signature: z.string(),
      verified: z.boolean(),
    })
    .strict(),
  z
    .object({
      type: z.literal("WORKFLOW_ACTION"),
      sessionId: z.string().uuid(),
      action: z.enum(["CONTINUE", "WAIT", "RETRY"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("WORKFLOW_ENTITY"),
      sessionId: z.string().uuid(),
      entity: z.enum([
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
    })
    .strict(),
  z
    .object({ type: z.literal("SPA_CHANGED"), sessionId: z.string().uuid() })
    .strict(),
  z
    .object({
      type: z.literal("INSTALL_REQUEST"),
      sessionId: z.string().uuid(),
      result: resultSchema,
      strategy: strategySchema.optional(),
      savedRouteId: z.string().max(100).optional(),
    })
    .strict(),
  z
    .object({ type: z.literal("SKIP_TASK"), sessionId: z.string().uuid() })
    .strict(),
  z
    .object({
      type: z.literal("UPDATE_MEMORY"),
      sessionId: z.string().uuid(),
      memory: z.unknown(),
      savedTask: savedTaskSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("GET_PAGE"),
      sessionId: z.string().uuid(),
      regionObservation: regionObservationRequestSchema.optional(),
      query: z.string().max(1000).optional(),
      planningIntent: z
        .object({ id: z.string().uuid(), phase: z.enum(["begin", "end"]) })
        .strict()
        .optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("SET_GOAL"),
      sessionId: z.string().uuid(),
      documentId: z.string().min(1).max(200).optional(),
      goal: z.string().min(1).max(1000),
      revision: z.number().int().nonnegative(),
      proposal: modelProposalSchema.optional(),
      strategy: strategySchema.optional(),
      journeyId: z.string().uuid().optional(),
      savedRouteId: z.string().max(100).optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("BEGIN_SESSION"),
      sessionId: z.string().uuid(),
      presentationVisible: z.boolean().optional(),
      presentationRevision: z.number().int().nonnegative().optional(),
      routeId: z.string().min(1),
      routeVersion: z.string().min(1),
      verifiedSteps: z.number().int().nonnegative().optional(),
      memory: z.unknown().optional(),
      goalPlan: goalPlanSchema.optional(),
      journey: journeySchema.optional(),
      request: requestSchema.optional(),
      savedTask: savedTaskSchema.optional(),
      liveDiagnostics: liveDiagnosticsSchema.optional(),
      navigationVerified: z.boolean().optional(),
      navigationEvidence: pendingNavigationSchema.optional(),
    })
    .strict(),
  z
    .object({
      type: z.literal("CONTROL_SESSION"),
      sessionId: z.string().uuid(),
      action: z.enum(["PAUSE", "RESUME", "STOP"]),
    })
    .strict(),
  z
    .object({
      type: z.literal("GUIDE_CONTROL"),
      sessionId: z.string().uuid(),
      controlId: z.string().regex(/^w[0-9a-f]{16}-[0-9]+$/),
    })
    .strict(),
]);
const diagnosticReason = z.enum([
  "modal-mismatch",
  "required-landmark-missing",
  "path-mismatch",
  "forbidden-landmark-present",
  "selector-mismatch",
  "viewport-mismatch",
  "below-threshold",
  "hidden",
  "disabled",
  "role-mismatch",
  "name-mismatch",
  "context-mismatch",
  "contradiction",
]);
const scoreSchema = z
  .object({
    id: z.string().max(100),
    score: z.number().min(0).max(1),
    rejected: z.boolean(),
    reasons: z.array(diagnosticReason).max(10),
  })
  .strict();
const diagnosticsSchema = z
  .object({
    localization: z
      .object({
        stateId: z.string().max(100).optional(),
        confidence: z.number().min(0).max(1),
        reason: z.enum([
          "Unknown screen. No supported state has enough evidence.",
          "Ambiguous screen. More than one state matches.",
          "Verified semantic landmarks and URL.",
        ]),
        scores: z
          .array(
            scoreSchema.extend({ minimum: z.number().min(0).max(1) }).strict(),
          )
          .max(100),
      })
      .strict()
      .optional(),
    target: z
      .object({
        id: z
          .string()
          .regex(/^c[0-9]+$/)
          .optional(),
        confidence: z.number().min(0).max(1),
        reason: z.enum([
          "Target not found with enough confidence.",
          "Multiple controls match. Tholi will not guess.",
          "Role, accessible name and context verified.",
        ]),
        candidates: z
          .array(
            scoreSchema.extend({ id: z.string().regex(/^c[0-9]+$/) }).strict(),
          )
          .max(50),
      })
      .strict()
      .optional(),
    transitionId: z.string().max(100).optional(),
    expected: z.array(z.string().max(100)).max(100),
    transitions: z
      .array(
        z
          .object({
            transitionId: z.string().max(100),
            from: z.string().max(100),
            expected: z.array(z.string().max(100)).max(100),
            observed: z.string().max(100).optional(),
            outcome: z.enum(["waiting", "verified", "deviated", "timeout"]),
          })
          .strict(),
      )
      .max(30),
  })
  .strict();
export const sessionViewSchema = z
  .object({
    serviceNavigation: navigationServiceStateSchema.optional(),
    controls: z.array(controlSchema).max(600).optional(),
    page: pageSnapshotSchema.optional(),
    goalPlan: goalPlanSchema.optional(),
    journey: journeySchema.optional(),
    request: requestSchema.optional(),
    clarification: clarificationSchema.optional(),
    embeddingActivity: z
      .object({
        embedded: z.number().int().nonnegative(),
        cacheHits: z.number().int().nonnegative(),
        llmCalls: z.literal(0),
        modelRevision: z.string(),
      })
      .strict()
      .optional(),
    continuationOrigin: z.string().max(300).optional(),
    frameAccess: z.array(z.string().url()).max(16).optional(),
    liveDiagnostics: liveDiagnosticsSchema.optional(),
    memory: z
      .object({
        pages: z.number().int().nonnegative(),
        templates: z.number().int().nonnegative(),
        observedTransitions: z.number().int().nonnegative(),
        version: z.number().int().nonnegative(),
      })
      .strict()
      .optional(),
    memoryError: z.string().max(300).optional(),
    routeFeedback: routeFeedbackSchema.optional(),
    selectedControlId: z
      .string()
      .regex(/^w[0-9a-f]{16}-[0-9]+$/)
      .optional(),
    diagnostics: diagnosticsSchema.optional(),
    status: z.enum([
      "idle",
      "running",
      "waiting",
      "paused",
      "checkpoint",
      "rerouting",
      "stopped",
      "boundary",
      "completed",
    ]),
    stateId: z.string().max(100).optional(),
    instruction: z.string().max(500),
    verifiedSteps: z.number().int().nonnegative(),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(500).optional(),
    routeId: z.string().min(1),
    routeVersion: z.string().min(1),
    history: z.array(z.string().max(100)).max(30),
  })
  .strict();
