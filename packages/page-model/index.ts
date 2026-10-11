import { z } from "zod";
export const LIVE_ROUTE_ID = "navigator.live";
export const LIVE_VERSION = "1.0.0";
export const controlId = z.string().regex(/^w[0-9a-f]{16}-[0-9]+$/);
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
    kind: z.enum([
      "focus",
      "toggle",
      "choice",
      "select",
      "section",
      "navigation",
      "expand",
      "action",
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
    risk: z.enum(["ordinary", "consequential"]),
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
  })
  .strict();
export const goalPlanSchema = z
  .object({
    goal: z.string().min(1).max(160),
    source: z.enum(["semantics", "memory", "on-device"]),
    status: z.enum(["guiding", "completed", "unresolved", "awaiting-choice"]),
    confidence: z.number().min(0).max(1),
    reason: z.string().max(500),
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
  })
  .strict();
export type PageControl = z.infer<typeof controlSchema>;
export type PageSnapshot = z.infer<typeof pageSnapshotSchema>;
export type GoalPlan = z.infer<typeof goalPlanSchema>;
export type ModelProposal = z.infer<typeof modelProposalSchema>;
export interface MemoryControl extends Omit<
  PageControl,
  "id" | "revealIds" | "inViewport" | "navigationKey"
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
}
export interface MemoryTransition {
  from: string;
  to: string;
  signature: string;
  label: string;
  evidence: "observed" | "inferred";
  lastVerified: number;
  active: boolean;
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
}
export interface ObservedTransition {
  from: string;
  to: string;
  signature: string;
  label: string;
}
export const transitionEvidenceSchema = z
  .object({
    from: z.string().max(100),
    to: z.string().max(100),
    signature: z.string().max(100),
    label: z.string().max(160),
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
      "You make every click. Navigator verifies changes and stops before consequential actions.",
    version: LIVE_VERSION,
    lastVerified: "Live page observations",
    milestones: ["Discover page", "Choose a goal", "Verify the result"],
    milestoneStates: { choosing: 0, guiding: 1, verified: 2 },
  };
}
