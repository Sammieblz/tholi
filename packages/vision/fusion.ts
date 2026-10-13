import type { PageSnapshot, GoalPlan } from "../page-model";
import { planGoal } from "../goal-planner";
import { words } from "../nlp/retrieval";
import type { VisualObservation } from "./contracts";
export function needsVision(plan?: GoalPlan, clarification = false) {
  return (
    !plan?.budgetPending &&
    !clarification &&
    !!plan &&
    plan.status !== "completed" &&
    ![
      "ambiguous",
      "consequential",
      "unknown-effect",
      "invalid-model",
      "missing-goal",
    ].includes(plan.issue || "") &&
    (plan.issue === "no-match" ||
      (plan.status === "guiding" && plan.confidence < 0.6))
  );
}
export function fuseVisual(
  page: PageSnapshot,
  observation: VisualObservation,
  target: string,
  goal: string,
  exclusions: string[] = [],
): GoalPlan | undefined {
  const wanted = words(target);
  if (!wanted.length) return;
  const matches = observation.regions.filter(
    (r) =>
      r.confidence >= 85 &&
      wanted.every((w) => words(r.text).includes(w)) &&
      !exclusions.some((e) => words(e).some((w) => words(r.text).includes(w))),
  );
  if (matches.length !== 1) return;
  const region = matches[0];
  // OCR cannot override the existing planner's scope or route eligibility.
  const bound = page.controls.filter(
    (c) =>
      c.visible &&
      c.enabled &&
      !c.occluded &&
      c.risk === "ordinary" &&
      words(c.label).length &&
      wanted.every((w) => words(c.label).includes(w)),
  );
  const grounded = bound.length === 1 ? planGoal(page, target) : undefined;
  if (
    grounded?.status === "guiding" &&
    grounded.steps[0]?.controlId === bound[0]?.id
  )
    return {
      goal,
      status: "guiding",
      source: "semantics",
      confidence: 0.8,
      action: {
        kind: "control",
        controlId: bound[0].id,
        signature: bound[0].signature,
      },
      steps: [
        {
          controlId: bound[0].id,
          label: bound[0].label,
          outcome: "The control's outcome is checked on the website.",
        },
      ],
      reason: "A visual label corroborates this freshly discovered control.",
    };
  return {
    goal,
    status: "awaiting-choice",
    source: "semantics",
    confidence: 0,
    steps: [],
    action: {
      kind: "visual",
      captureId: observation.captureId,
      viewportRevision: observation.viewportRevision,
      text: region.text,
      box: region.box,
      risk: "unknown",
    },
    reason: `Visual suggestion: “${region.text}”. Review it on the website; its effect and the requested outcome remain unverified.`,
  };
}
export async function semanticVisual(
  index: import("../nlp/retrieval").SemanticIndex,
  page: PageSnapshot,
  observation: VisualObservation,
  target: string,
  goal: string,
  exclusions: string[],
  qualifiers: string[],
  signal?: AbortSignal,
): Promise<GoalPlan | undefined> {
  observation = {
    ...observation,
    regions: observation.regions.filter((r) =>
      qualifiers.every((q) => words(q).every((w) => words(r.text).includes(w))),
    ),
  };
  const direct = fuseVisual(page, observation, target, goal, exclusions);
  if (direct) return direct;
  const query = await index.vector(target, signal, false);
  const candidates = [];
  for (const region of observation.regions
    .filter(
      (r) =>
        r.confidence >= 85 &&
        qualifiers.every((q) =>
          words(q).every((w) => words(r.text).includes(w)),
        ) &&
        !exclusions.some((e) =>
          words(e).some((w) => words(r.text).includes(w)),
        ),
    )
    .slice(0, 40)) {
    const vector = await index.vector(region.text, signal, false);
    const score = query.reduce((sum, v, i) => sum + v * vector[i], 0);
    candidates.push({ region, score });
  }
  candidates.sort((a, b) => b.score - a.score);
  if (
    !candidates[0] ||
    candidates[0].score < 0.75 ||
    (candidates[1] && candidates[0].score - candidates[1].score < 0.12)
  )
    return;
  const region = candidates[0].region;
  return {
    goal,
    status: "awaiting-choice",
    source: "semantics",
    confidence: 0,
    steps: [],
    action: {
      kind: "visual",
      captureId: observation.captureId,
      viewportRevision: observation.viewportRevision,
      text: region.text,
      box: region.box,
      risk: "unknown",
    },
    reason: `Visual suggestion: “${region.text}”. Its label is related to your current step; review it on the website. Its effect and the task outcome remain unverified.`,
  };
}
