import { z } from "zod";
import {
  controlId,
  controlSchema,
  hash,
  LIVE_ROUTE_ID,
  LIVE_VERSION,
} from "../page-model";
import type { PageSnapshot, SiteMemory } from "../page-model";
import type { SessionView } from "../shared-types";

const digest = z.string().regex(/^[0-9a-f]{8}$/);
const count = z.number().int().nonnegative().max(100000);
export const matchEvidenceSchema = z
  .object({
    requested: count,
    label: count,
    description: count,
    context: count,
    weighted: z.number().min(0).max(100000),
    specificity: z.number().min(0).max(0.4),
    adjustment: z.number().min(-0.32).max(0.2),
    qualified: z.boolean(),
    preference: z.boolean(),
  })
  .strict();
const candidateReason = z.enum([
  "label-match",
  "description-match",
  "context-match",
  "qualifier-mismatch",
  "opposite-preference",
  "disabled",
  "consequential",
  "hidden-unreachable",
  "reveal-ambiguous",
  "below-threshold",
  "reveal-step",
  "selected",
  "tied",
  "equivalent-destination",
]);
export const planningDiagnosticsSchema = z
  .object({
    goalKey: digest,
    revision: count,
    source: z.enum(["semantics", "memory", "on-device"]),
    decision: z.enum(["guiding", "completed", "unresolved", "awaiting-choice"]),
    totalCandidates: count,
    truncated: z.boolean(),
    candidates: z
      .array(
        z
          .object({
            id: controlId,
            signature: digest,
            identity: digest,
            role: z.enum([
              "button",
              "link",
              "heading",
              "checkbox",
              "radio",
              "textbox",
              "searchbox",
              "combobox",
              "menuitem",
              "switch",
              "tab",
              "option",
              "unknown",
            ]),
            kind: controlSchema.shape.kind,
            score: z.number().min(0).max(1),
            visible: z.boolean(),
            enabled: z.boolean(),
            eligible: z.boolean(),
            revealIds: z.array(controlId).max(10),
            reasons: z.array(candidateReason).max(16),
            evidence: matchEvidenceSchema,
          })
          .strict(),
      )
      .max(50),
    memory: z
      .object({
        version: count,
        pageVersion: count,
        ageSeconds: z.number().int().min(0).max(7776000),
        inferred: count,
        observed: count,
        path: z
          .array(
            z
              .object({
                from: digest,
                to: digest,
                signature: digest,
                evidence: z.enum(["observed", "inferred"]),
                ageSeconds: z.number().int().min(0).max(7776000),
                active: z.boolean(),
              })
              .strict(),
          )
          .max(8),
      })
      .strict()
      .optional(),
  })
  .strict();
export const verificationEventSchema = z
  .object({
    sequence: count,
    signature: digest,
    kind: controlSchema.shape.kind,
    beforeRevision: count,
    revision: count,
    from: digest,
    to: digest,
    outcome: z.enum(["waiting", "verified", "stale", "timeout", "canceled"]),
    evidence: z.enum([
      "user-interaction",
      "checked-change",
      "field-focus",
      "section-arrival",
      "selection-change",
      "expanded-change",
      "related-controls-added",
      "related-controls-removed",
      "owned-region-visibility",
      "destination-arrival",
      "target-changed",
      "deadline-expired",
      "guidance-cleared",
    ]),
  })
  .strict();
export const liveDiagnosticsSchema = z
  .object({
    revision: count,
    structure: digest,
    state: digest,
    partial: z.boolean(),
    controlCount: count,
    planning: planningDiagnosticsSchema.optional(),
    sequence: count,
    events: z.array(verificationEventSchema).max(30),
  })
  .strict();
export type MatchEvidence = z.infer<typeof matchEvidenceSchema>;
export type PlanningDiagnostics = z.infer<typeof planningDiagnosticsSchema>;
export type LiveDiagnostics = z.infer<typeof liveDiagnosticsSchema>;
export type VerificationEvent = z.infer<typeof verificationEventSchema>;

export function updateObservation(
  page: PageSnapshot,
  previous?: LiveDiagnostics,
): LiveDiagnostics {
  return {
    revision: page.revision,
    structure: hash(page.fingerprint),
    state: hash(page.stateKey),
    partial: page.partial,
    controlCount: page.controls.length,
    planning: previous?.planning,
    sequence: previous?.sequence || 0,
    events: previous?.events || [],
  };
}
export function appendVerification(
  diagnostics: LiveDiagnostics,
  event: Omit<VerificationEvent, "sequence">,
) {
  const sequence = diagnostics.sequence + 1;
  return {
    ...diagnostics,
    sequence,
    events: [
      ...diagnostics.events,
      verificationEventSchema.parse({ ...event, sequence }),
    ].slice(-30),
  };
}
export function memoryDiagnostics(
  memory: SiteMemory,
  page: PageSnapshot,
  path: SiteMemory["transitions"] = [],
  now = Date.now(),
): NonNullable<PlanningDiagnostics["memory"]> {
  // Ages are bounded to ninety days; no timestamps or site paths are exported.
  const age = (time: number) =>
    Math.min(7776000, Math.max(0, Math.floor((now - time) / 1000)));
  return {
    version: memory.version,
    pageVersion: memory.pages.find((p) => p.key === page.pageKey)?.version || 0,
    ageSeconds: age(memory.lastSeen),
    inferred: memory.transitions.filter(
      (t) => t.active && t.evidence === "inferred",
    ).length,
    observed: memory.transitions.filter(
      (t) => t.active && t.evidence === "observed",
    ).length,
    path: path.slice(0, 8).map((t) => ({
      from: hash(t.from),
      to: hash(t.to),
      signature: hash(t.signature),
      evidence: t.evidence,
      ageSeconds: age(t.lastVerified),
      active: t.active,
    })),
  };
}
export const liveReportSchema = z
  .object({
    format: z.literal("navigator-live-debug-v1"),
    category: z.enum([
      "diagnostics",
      "target-missing",
      "wrong-screen",
      "instruction-unclear",
      "route-outdated",
    ]),
    routeId: z.literal(LIVE_ROUTE_ID),
    routeVersion: z.literal(LIVE_VERSION),
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
    verifiedSteps: count,
    diagnostics: liveDiagnosticsSchema.optional(),
  })
  .strict();
export function liveReport(view: SessionView, category: string) {
  // Construct from an allowlist, rather than copying page/goal/model fields.
  return liveReportSchema.parse({
    format: "navigator-live-debug-v1",
    category,
    routeId: view.routeId,
    routeVersion: view.routeVersion,
    status: view.status,
    verifiedSteps: view.verifiedSteps,
    diagnostics: view.liveDiagnostics,
  });
}
