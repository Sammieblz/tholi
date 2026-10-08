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
  z.object({ type: z.literal("START") }).strict(),
  z.object({ type: z.literal("PAUSE") }).strict(),
  z.object({ type: z.literal("RESUME") }).strict(),
  z.object({ type: z.literal("STOP") }).strict(),
]);
