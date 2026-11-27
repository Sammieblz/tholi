import { z } from "zod";
import { hash } from "../page-model";
import type { SessionView } from "../shared-types";
import { sanitizeSavedText } from "../privacy-redaction";
import { navigationKnowledgeOriginSchema } from "./contracts-navigation-knowledge";
import { workflowGuideSchema } from "./workflow-contracts";
import { semanticHash } from "../nlp/retrieval";

const label = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine((s) => sanitizeSavedText(s, 160) === s);
export const capturedMilestoneSchema = z
  .object({
    label,
    kind: z.enum(["navigate", "reveal", "input", "choose", "review"]),
    context: z.array(label).max(4),
  })
  .strict();
export const workflowCaptureSchema = z
  .object({
    kind: z.literal("organization-workflow-capture"),
    schemaVersion: z.literal(1),
    origin: navigationKnowledgeOriginSchema,
    purpose: label,
    platform: z.enum(["github", "jira"]),
    steps: z.array(capturedMilestoneSchema).min(1).max(64),
    evidence: z.literal("author-draft"),
  })
  .strict();
export type WorkflowCapture = z.infer<typeof workflowCaptureSchema>;
export type CapturedMilestone = z.infer<typeof capturedMilestoneSchema>;

/** Capture uses a current diagnostic binding, never a page-provided exported DTO. */
export function currentCaptureMilestone(
  view: SessionView,
): CapturedMilestone | undefined {
  const page = view.page,
    planning = view.liveDiagnostics?.planning;
  if (
    !page ||
    !planning ||
    planning.revision !== page.revision ||
    view.liveDiagnostics?.revision !== page.revision ||
    view.goalPlan?.status !== "guiding"
  )
    return;
  const id = view.goalPlan.steps[0]?.controlId;
  const control = page.controls.find((c) => c.id === id);
  if (
    !control ||
    control.retention === "session" ||
    !control.visible ||
    !control.enabled ||
    control.occluded ||
    control.reference?.frameId
  )
    return;
  if (
    !planning.candidates.some(
      (c) =>
        c.id === control.id &&
        c.signature === hash(control.signature) &&
        c.reasons.includes("selected"),
    )
  )
    return;
  const kind =
    control.risk !== "ordinary"
      ? "review"
      : control.kind === "focus"
        ? "input"
        : ["expand"].includes(control.kind)
          ? "reveal"
          : ["choice", "toggle", "select", "range"].includes(control.kind)
            ? "choose"
            : "navigate";
  const result = capturedMilestoneSchema.safeParse({
    label: control.label,
    kind,
    context: (
      control.structure?.regions.map((r) => r.name).filter(Boolean) || []
    ).slice(-4),
  });
  return result.success ? result.data : undefined;
}

/** Captures are authored hints. They never become verified edges or arrival evidence. */
export async function capturedWorkflowGuide(raw: unknown) {
  const capture = workflowCaptureSchema.parse(raw);
  return workflowGuideSchema.parse({
    id: `${capture.platform}.team.${crypto.randomUUID()}`,
    version: "1.0.0",
    platform: capture.platform,
    purpose: capture.purpose,
    intents: [capture.purpose],
    sources: [
      {
        url: capture.origin,
        sha256: await semanticHash(JSON.stringify(capture)),
        reviewedAt: new Date().toISOString().slice(0, 10),
      },
    ],
    milestones: capture.steps.map((step, index) => ({
      id: `captured-${index + 1}`,
      purpose: step.label,
      targets: [step.label],
      kind: step.kind,
      context: step.context,
      instruction:
        step.kind === "review"
          ? `Review ${step.label} yourself. Tholi does not confirm or perform the submission.`
          : `Follow the highlighted ${step.label} control. The website is checked again afterwards.`,
    })),
  });
}
