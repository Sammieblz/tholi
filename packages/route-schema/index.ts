import { z } from "zod";
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
    required: z.boolean().default(true),
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
    landmarks: z.array(landmark).min(1),
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
      .default("You make every click. Navigator never submits for you."),
    completionInstruction: z
      .string()
      .default(
        "You reached your destination. Visible route evidence verified.",
      ),
    boundaryInstruction: z
      .string()
      .default("Navigator stops here. The final action is yours to decide."),
    milestoneStates: z.record(z.number().int().nonnegative()).default({}),
    version: z.string(),
    lastVerified: z.string(),
    origins: z.array(z.string().url()).min(1),
    startStates: z.array(z.string()).min(1),
    states: z.array(stateSchema).min(1),
    transitions: z.array(transitionSchema),
    successStates: z.array(z.string()),
    milestones: z.array(z.string()),
  })
  .strict()
  .superRefine((route, ctx) => {
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
  z.object({ type: z.literal("GET_SESSION") }).strict(),
  z.object({ type: z.literal("GET_CONTEXT") }).strict(),
  z
    .object({
      type: z.literal("START"),
      routeId: z.string().min(1),
      routeVersion: z.string().min(1),
    })
    .strict(),
  z.object({ type: z.literal("PAUSE") }).strict(),
  z.object({ type: z.literal("RESUME") }).strict(),
  z.object({ type: z.literal("STOP") }).strict(),
]);

export const contentMessageSchema = z.discriminatedUnion("type", [
  z
    .object({
      type: z.literal("BEGIN_SESSION"),
      sessionId: z.string().uuid(),
      routeId: z.string().min(1),
      routeVersion: z.string().min(1),
    })
    .strict(),
  z
    .object({
      type: z.literal("CONTROL_SESSION"),
      sessionId: z.string().uuid(),
      action: z.enum(["PAUSE", "RESUME", "STOP"]),
    })
    .strict(),
]);
const diagnosticReason = z.enum([
  "modal-mismatch",
  "required-landmark-missing",
  "path-mismatch",
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
          "Multiple controls match. Navigator will not guess.",
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
