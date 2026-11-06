import { interpretRequest } from "../nlp/interpret";
import { hasCommitLanguage } from "../safety-policy/action-language";
import { goalMatch } from "./index";
import { authenticationIntent, taskWords } from "./task-intent";
import {
  navigationObservationSchema,
  navigationProposalSchema,
  type NavigationObservation,
  type NavigationProposal,
} from "../navigation-core/contracts-navigation";
import {
  NAVIGATION_KNOWLEDGE_LIMITS,
  retrievedNavigationKnowledgeSchema,
  serializeNavigationKnowledge,
  navigationKnowledgeSnapshotDigest,
  type RetrievedNavigationKnowledge,
} from "../navigation-core/contracts-navigation-knowledge";
import {
  navigationKnowledgeQueryFromObservation,
  navigationKnowledgeOperationForControl,
} from "../navigation-core/navigation-knowledge-projection";

/** A known route can suggest one fresh target. It cannot establish arrival. */
export async function reuseNavigationKnowledge(
  rawObservation: NavigationObservation,
  origin: string,
  rawKnowledge: RetrievedNavigationKnowledge,
  now = Date.now(),
): Promise<NavigationProposal | undefined> {
  const observed = navigationObservationSchema.safeParse(rawObservation);
  const retrieved = retrievedNavigationKnowledgeSchema.safeParse(rawKnowledge);
  if (!observed.success || !retrieved.success) return;
  const observation = observed.data,
    knowledge = retrieved.data;
  if (
    !knowledge.context ||
    !knowledge.siteSettings ||
    !knowledge.sources.length ||
    knowledge.siteSettings.origin !== origin ||
    now < observation.observedAtMs ||
    now > observation.deadlineAtMs ||
    observation.omissions.frames ||
    observation.omissions.controls ||
    observation.omissions.reasons.length
  )
    return;
  const goal = observation.context.goal;
  if (authenticationIntent(goal) || hasCommitLanguage(goal)) return;
  try {
    const interpreted = interpretRequest(goal);
    if (interpreted.tasks.length !== 1) return;
    const task = interpreted.tasks[0];
    if (
      task.exclusions.length ||
      task.negatedOnly ||
      task.needsReference ||
      task.desiredValue ||
      !["locate", "navigate", "reveal"].includes(task.operation)
    )
      return;
    const query = navigationKnowledgeQueryFromObservation(observation, origin);
    if (!query.controls.length) return;
    const serialized = await serializeNavigationKnowledge(knowledge.context);
    if (
      serialized.digest !== knowledge.contextDigest ||
      (await navigationKnowledgeSnapshotDigest(query, knowledge)) !==
        knowledge.snapshotDigest
    )
      return;
    const candidates = knowledge.context.facts.filter((fact) => {
      const date = Date.parse(fact.observedAt);
      if (
        !Number.isFinite(date) ||
        date > now + NAVIGATION_KNOWLEDGE_LIMITS.clockSkewMs ||
        date < now - NAVIGATION_KNOWLEDGE_LIMITS.freshMs ||
        fact.failures >= fact.successes ||
        fact.steps.some(
          (step) =>
            authenticationIntent(step.label) || hasCommitLanguage(step.label),
        )
      )
        return false;
      const terminal = fact.steps.at(-1)!;
      const match = goalMatch(goal, {
        label: terminal.label,
        kind: terminal.kind === "navigation" ? "navigation" : "expand",
        description: "",
        context: "",
      });
      return (
        match.requested > 0 &&
        match.label === match.requested &&
        match.qualified &&
        match.preference &&
        match.score >= 0.88
      );
    });
    if (candidates.length !== 1) return;
    const first = candidates[0].steps[0];
    const matches = observation.controls.filter(
      (control) =>
        control.role === first.role &&
        taskWords(control.label) === taskWords(first.label) &&
        (control.kind === "navigation" ? "navigation" : "control") ===
          first.kind &&
        navigationKnowledgeOperationForControl(control) === first.operation,
    );
    if (matches.length !== 1) return;
    const control = matches[0];
    if (
      !control.eligible ||
      !control.visible ||
      !control.enabled ||
      control.occluded ||
      !control.inViewport ||
      control.risk !== "ordinary"
    )
      return;
    return navigationProposalSchema.parse({
      kind: "guide",
      reference: { ...control.reference },
      message: "Follow the highlighted control. Tholi will check the result.",
    });
  } catch {
    return;
  }
}
