import { z } from "zod";
import { navigationActionSchema } from "../navigation-core/navigation-actions";
import {
  coverageSchema,
  workflowContextSchema,
  outcomeEvidenceSchema,
  controlReferenceSchema,
} from "../navigation-core/workflow-contracts";
export const LIVE_ROUTE_ID = "navigator.live";
export const LIVE_VERSION = "1.0.0";
export const controlId = z.string().regex(/^w[0-9a-f]{16}-[0-9]+$/);
export const structureSchema = z
  .object({
    regions: z
      .array(
        z
          .object({ role: z.string().max(40), name: z.string().max(160) })
          .strict(),
      )
      .max(4),
    headings: z
      .array(
        z
          .object({
            level: z.number().int().min(1).max(6),
            label: z.string().max(160),
          })
          .strict(),
      )
      .max(6),
  })
  .strict();
export const intentSchema = z
  .object({
    target: z.string().min(1).max(80),
    context: z.string().max(80),
    scope: z.enum(["page", "section", "any"]),
    operation: z.enum(["focus", "reveal", "choose", "navigate", "locate"]),
  })
  .strict();
export const destinationSchema = z
  .object({
    origin: z.string().max(300),
    path: z.string().max(500),
    key: z.string().max(100),
  })
  .strict();
export const controlSchema = z
  .object({
    id: controlId,
    signature: z.string().max(100),
    role: z.string().max(40),
    label: z.string().min(1).max(160),
    description: z.string().max(160).optional(),
    context: z.string().max(160),
    group: z.string().max(160),
    scope: z.enum(["page", "section"]).optional(),
    structure: structureSchema.optional(),
    form: z
      .object({
        key: z.string().max(100),
        authentication: z.enum(["login", "register", "credentials"]).optional(),
        stage: z.enum(["credentials", "two-factor"]).optional(),
      })
      .strict()
      .optional(),
    placement: z
      .enum(["viewport", "above", "below", "left", "right"])
      .optional(),
    kind: z.enum([
      "focus",
      "toggle",
      "choice",
      "select",
      "section",
      "navigation",
      "expand",
      "action",
      "range",
    ]),
    visible: z.boolean(),
    enabled: z.boolean(),
    inViewport: z.boolean(),
    checked: z.boolean().optional(),
    expanded: z.boolean().optional(),
    popup: z.enum(["menu", "listbox", "tree", "grid", "dialog"]).optional(),
    selected: z.boolean().optional(),
    sectionVisible: z.boolean().optional(),
    sectionKey: z.string().max(100).optional(),
    revealIds: z.array(controlId).max(10),
    destination: destinationSchema.optional(),
    navigationKey: z.string().max(100).optional(),
    targetLanguage: z.string().max(20).optional(),
    options: z
      .array(
        z
          .object({
            label: z.string().max(160),
            selected: z.boolean(),
            enabled: z.boolean(),
          })
          .strict(),
      )
      .max(100)
      .optional(),
    risk: z.enum(["ordinary", "consequential"]),
    retention: z.enum(["interface", "session"]).optional(),
    surfaceId: z.string().max(100).optional(),
    occluded: z.boolean().optional(),
    reference: controlReferenceSchema.optional(),
    range: z
      .object({
        current: z.number().finite(),
        min: z.number().finite(),
        max: z.number().finite(),
        step: z.number().finite().positive().optional(),
      })
      .strict()
      .optional(),
    riskReason: z
      .enum(["commit", "form-submit", "unknown-edit-effect"])
      .optional(),
  })
  .strict();
export const pageSnapshotSchema = z
  .object({
    origin: z.string().max(300),
    pageKey: z.string().max(100),
    path: z.string().max(500),
    stateKey: z.string().max(100),
    templateKey: z.string().max(100),
    fingerprint: z.string().max(100),
    revision: z.number().int().nonnegative(),
    layout: z.enum(["compact", "wide"]),
    language: z.string().max(20),
    controls: z.array(controlSchema).max(600),
    partial: z.boolean(),
    coverage: z.array(coverageSchema).max(100).optional(),
    signals: z.array(outcomeEvidenceSchema).max(30).optional(),
    busy: z.boolean().optional(),
    indexedControls: z.number().int().nonnegative().max(5000).optional(),
    screen: z
      .object({
        kind: z.enum([
          "normal",
          "credentials",
          "two-factor",
          "authorization",
          "loading",
          "review",
          "outcome",
        ]),
        evidence: z.string().max(80),
      })
      .strict()
      .optional(),
  })
  .strict();
export const goalPlanSchema = z
  .object({
    goal: z.string().min(1).max(1000),
    source: z.enum(["semantics", "memory", "on-device"]),
    status: z.enum(["guiding", "completed", "unresolved", "awaiting-choice"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(500),
    issue: z
      .enum([
        "missing-goal",
        "ambiguous",
        "consequential",
        "unknown-effect",
        "hidden",
        "no-match",
        "invalid-model",
      ])
      .optional(),
    interpretation: intentSchema.optional(),
    action: navigationActionSchema.optional(),
    exploration: z.boolean().optional(),
    budgetPending: z.boolean().optional(),
    recoveryStage: z
      .enum([
        "priority",
        "retrieval",
        "structure",
        "vision",
        "waiting",
        "access",
      ])
      .optional(),
    route: z
      .object({
        strategy: z.enum(["fastest", "fewest-clicks"]),
        clicks: z.number().int().nonnegative(),
        minSeconds: z.number().nonnegative(),
        maxSeconds: z.number().nonnegative(),
        complete: z.boolean(),
        available: z.boolean().optional(),
        basis: z.enum(["estimated", "observed", "mixed"]),
        predictions: z
          .array(
            z
              .object({
                label: z.string().max(160),
                evidence: z.enum(["observed", "predicted", "documented"]),
              })
              .strict(),
          )
          .max(12),
      })
      .strict()
      .optional(),
    steps: z
      .array(
        z
          .object({
            controlId,
            label: z.string().max(160),
            outcome: z.string().max(200),
          })
          .strict(),
      )
      .max(12),
  })
  .strict();
export const modelProposalSchema = z
  .object({
    controlIds: z.array(controlId).max(12),
    confidence: z.number().min(0).max(1),
    intent: intentSchema.optional(),
  })
  .strict();
export type PageControl = z.infer<typeof controlSchema>;
export type PageSnapshot = z.infer<typeof pageSnapshotSchema>;
export type GoalPlan = z.infer<typeof goalPlanSchema>;
export type ModelProposal = z.infer<typeof modelProposalSchema>;
export type GoalIntent = z.infer<typeof intentSchema>;
export const strategySchema = z.enum(["fastest", "fewest-clicks"]);
export const objectiveSchema = z
  .object({
    purpose: z.string().min(1).max(160),
    value: z.string().max(1000).optional(),
    language: z.string().max(20).optional(),
    workflow: z.enum(["login", "register"]).optional(),
  })
  .strict();
export const progressSchema = z
  .object({
    origin: z.string().max(300),
    from: z.string().max(100),
    to: z.string().max(100),
    signature: z.string().max(100),
    label: z.string().max(160),
    kind: controlSchema.shape.kind,
    durationMs: z.number().nonnegative().max(300000),
    at: z.number().nonnegative(),
  })
  .strict();
export const journeySchema = z
  .object({
    id: z.string().uuid(),
    goal: z.string().min(1).max(1000),
    objective: objectiveSchema,
    origin: z.string().max(300),
    strategy: strategySchema,
    startedAt: z.number().nonnegative(),
    updatedAt: z.number().nonnegative(),
    status: z.enum(["active", "completed"]),
    progress: z.array(progressSchema).max(30),
    totalVerified: z.number().int().nonnegative().optional(),
    checkpoint: z
      .object({
        at: z.number(),
        count: z.number().int().nonnegative(),
        objective: objectiveSchema,
        goal: z.string().max(1000),
        milestones: z.array(z.string().max(100)).max(64),
        entities: workflowContextSchema.shape.entities,
        exclusions: z.array(z.string().max(1000)).max(256),
        breadcrumbs: z
          .array(z.object({ origin: z.string(), state: z.string() }))
          .max(30),
      })
      .strict()
      .optional(),
    reroutes: z.number().int().nonnegative(),
    savedRouteId: z.string().max(100).optional(),
    requestTaskId: z.string().uuid().optional(),
    canonicalGoal: z.string().max(1000).optional(),
    workflow: workflowContextSchema.optional(),
  })
  .strict();
export const savedTaskSchema = z
  .object({
    id: z.string().max(100),
    goal: z.string().min(1).max(1000),
    canonicalGoal: z.string().max(1000).optional(),
    objective: objectiveSchema,
    origin: z.string().max(300),
    strategy: strategySchema,
    updatedAt: z.number().nonnegative(),
    completed: z.boolean(),
    progress: z.array(progressSchema).max(30),
    planned: z
      .array(
        z
          .object({
            label: z.string().max(160),
            signature: z.string().max(100).optional(),
            evidence: z.enum(["live", "observed", "predicted", "documented"]),
          })
          .strict(),
      )
      .max(24)
      .optional(),
    estimate: goalPlanSchema.shape.route,
    guideId: z.string().max(100).optional(),
    guideVersion: z.string().max(40).optional(),
    parameters: z.array(z.string().max(40)).max(20).optional(),
    retention: z.enum(["interface", "session"]).optional(),
  })
  .strict();
export type TaskJourney = z.infer<typeof journeySchema>;
export type SavedTask = z.infer<typeof savedTaskSchema>;
export type RouteStrategy = z.infer<typeof strategySchema>;
export const pendingNavigationSchema = z
  .object({
    from: z.string().max(100),
    signature: z.string().max(100),
    label: z.string().max(160),
    destinationKey: z.string().max(100),
    navigationKey: z.string().max(100),
    origin: z.string().max(300),
    durationMs: z.number().nonnegative().max(300000).optional(),
    kind: z.literal("navigation").optional(),
    fromOrigin: z.string().max(300).optional(),
    redirected: z.boolean().optional(),
    newTab: z.boolean().optional(),
  })
  .strict();
export type PendingNavigation = z.infer<typeof pendingNavigationSchema>;
export interface MemoryControl extends Omit<
  PageControl,
  "id" | "revealIds" | "inViewport" | "placement" | "navigationKey"
> {
  lastSeen: number;
  active: boolean;
}
export interface MemoryPage {
  key: string;
  path: string;
  templateKey: string;
  fingerprint: string;
  version: number;
  lastSeen: number;
  controls: MemoryControl[];
  stateKey: string;
  language?: string;
}
export interface MemoryTransition {
  action?: { kind: "control"; signature: string };
  requiresFreshBinding?: boolean;
  from: string;
  to: string;
  signature: string;
  label: string;
  evidence: "observed" | "inferred";
  lastVerified: number;
  active: boolean;
  samples?: number;
  meanMs?: number;
}
export interface SiteMemory {
  schemaVersion: 1;
  origin: string;
  version: number;
  lastSeen: number;
  pages: MemoryPage[];
  templates: {
    key: string;
    fingerprint: string;
    version: number;
    lastSeen: number;
  }[];
  transitions: MemoryTransition[];
  states?: MemoryPage[];
}
export interface ObservedTransition {
  from: string;
  to: string;
  signature: string;
  label: string;
  durationMs?: number;
}
export const transitionEvidenceSchema = z
  .object({
    from: z.string().max(100),
    to: z.string().max(100),
    signature: z.string().max(100),
    label: z.string().max(160),
    durationMs: z.number().nonnegative().max(300000).optional(),
  })
  .strict();
export function hash(value: string): string {
  let result = 2166136261;
  for (let i = 0; i < value.length; i++) {
    result ^= value.charCodeAt(i);
    result = Math.imul(result, 16777619);
  }
  return (result >>> 0).toString(16).padStart(8, "0");
}
export function supportsLiveUrl(value: string): boolean {
  try {
    return ["http:", "https:"].includes(new URL(value).protocol);
  } catch {
    return false;
  }
}
export function livePreview(origin: string) {
  return {
    id: LIVE_ROUTE_ID,
    taskId: "live.navigation",
    title: "Navigate this website",
    siteName: new URL(origin).hostname,
    origins: [origin],
    description:
      "Discover the current page, describe your goal, or choose any available control.",
    safetyNote:
      "You make every click. Tholi verifies changes and stops before consequential actions.",
    version: LIVE_VERSION,
    lastVerified: "Live page observations",
    milestones: ["Discover page", "Choose a goal", "Verify the result"],
    milestoneStates: { choosing: 0, guiding: 1, verified: 2 },
  };
}
