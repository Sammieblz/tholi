import {
  type PageControl,
  type PageSnapshot,
  type GoalPlan,
  type ModelProposal,
  type SiteMemory,
  type GoalIntent,
  hash,
} from "../page-model";
import { sanitizeText, sanitizeGoal } from "../privacy-redaction";
import { searchRoute } from "./route-graph";
import { taskWords } from "./task-intent";
import {
  memoryDiagnostics,
  type MatchEvidence,
  type PlanningDiagnostics,
} from "../live-diagnostics";
const stop = new Set(
  "a an the to of on in this that my me please find go navigate show open make change switch set turn use get article page section mode website it i want can you for into how do does would could like choose select".split(
    " ",
  ),
);
function tokens(text: string) {
  return taskWords(text)
    .replace(/\bhelp\s+me\b/g, "")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .split(" ")
    .filter((t) => t && !stop.has(t));
}
// Compare regular English inflections symmetrically, without deleting suffixes
// indiscriminately (for example, "address" must not become "addres").
function plural(term: string) {
  if (!/^[a-z]{3,}$/.test(term)) return term;
  if (/[^aeiou]y$/.test(term)) return term.slice(0, -1) + "ies";
  if (/(?:s|x|z|ch|sh)$/.test(term)) return term + "es";
  return term + "s";
}
function matches(term: string, words: string[]) {
  return words.some(
    (word) => word === term || plural(term) === word || plural(word) === term,
  );
}
const aliases: Record<string, string[]> = {
  larger: ["large", "text", "size", "font"],
  bigger: ["large", "text", "size", "font"],
  smaller: ["small", "text", "size", "font"],
  dark: ["dark", "color", "theme"],
  light: ["light", "color", "theme"],
  references: ["references", "citations", "sources"],
  contents: ["contents", "sections"],
  search: ["search", "find"],
};
export function goalMatch(
  goal: string,
  control: Pick<
    PageControl,
    "label" | "description" | "context" | "kind" | "scope" | "structure"
  >,
): MatchEvidence & { score: number } {
  const requested = [...new Set(tokens(goal))],
    label = tokens(control.label),
    description = tokens(control.description || ""),
    context = tokens(
      [
        control.context,
        ...(control.structure?.headings.map((h) => h.label) || []),
        ...(control.structure?.regions.map((r) => r.name) || []),
      ].join(" "),
    );
  const evidence: MatchEvidence = {
    requested: requested.length,
    label: 0,
    description: 0,
    context: 0,
    weighted: 0,
    specificity: 0,
    adjustment: 0,
    qualified: true,
    preference: true,
  };
  if (!requested.length) return { ...evidence, score: 0 };
  let score = 0;
  for (const term of requested) {
    const equivalents = aliases[term] || [term];
    const direct =
      matches(term, label) ||
      (equivalents[0] && matches(equivalents[0], label));
    const labelAlias = equivalents.some((t) => matches(t, label));
    const descriptionMatch = equivalents.some((t) => matches(t, description));
    const contextMatch = equivalents.some((t) => matches(t, context));
    if (direct || labelAlias) evidence.label++;
    else if (descriptionMatch) evidence.description++;
    else if (contextMatch) evidence.context++;
    score += direct
      ? 1
      : equivalents.some((t) => matches(t, label))
        ? 0.8
        : equivalents.some((t) => matches(t, description))
          ? 0.85
          : equivalents.some((t) => matches(t, context))
            ? 0.45
            : 0;
  }
  evidence.weighted = score;
  const wanted = requested.filter(
    (t) =>
      ![
        "text",
        "size",
        "font",
        "color",
        "theme",
        "larger",
        "smaller",
        "bigger",
      ].includes(t),
  );
  if (
    wanted.length &&
    (!wanted.some((t) =>
      [t, ...(aliases[t] || [])].some((v) =>
        matches(v, [...label, ...description]),
      ),
    ) ||
      !wanted.every((t) =>
        [t, ...(aliases[t] || [])].some((v) =>
          matches(v, [...label, ...description, ...context]),
        ),
      ))
  )
    return { ...evidence, qualified: false, score: 0 };
  if (
    (requested.some((t) => ["larger", "bigger"].includes(t)) &&
      !label.some((t) => ["large", "larger", "bigger"].includes(t))) ||
    (requested.includes("smaller") &&
      !label.some((t) => ["small", "smaller"].includes(t)))
  )
    return { ...evidence, preference: false, score: 0 };
  const vocabulary = requested.flatMap((t) => [t, ...(aliases[t] || [])]);
  // Decorative counts and section numbering are not semantic qualifiers.
  const extras = requested.some(
    (t) =>
      matches(t, label) || (aliases[t] || []).some((v) => matches(v, label)),
  )
    ? label.filter(
        (t) => !/^\d+$/.test(t) && !vocabulary.some((v) => matches(v, [t])),
      )
    : [];
  const contextual = wanted.filter(
    (t) =>
      !matches(t, label) && !(aliases[t] || []).some((v) => matches(v, label)),
  );
  const nearestContext = tokens(
    control.structure?.headings.at(-1)?.label || control.context,
  );
  const contextExtras = contextual.some((t) => matches(t, nearestContext))
    ? nearestContext.filter((t) => !vocabulary.some((v) => matches(v, [t])))
        .length
    : contextual.length && control.structure?.headings.length
      ? 1
      : 0;
  const specificity = Math.min(0.4, (extras.length + contextExtras) * 0.12);
  evidence.specificity = specificity;
  evidence.adjustment =
    (requested.includes("search")
      ? control.kind === "focus"
        ? 0.2
        : -0.2
      : 0) -
    (/\b(change|switch|set|select|choose)\b/i.test(goal) &&
    ["section", "navigation"].includes(control.kind)
      ? 0.12
      : 0);
  // An unqualified goal addresses the page-level control before a repeated
  // section control. Explicit context (e.g. "Edit Plot") keeps that section eligible.
  if (
    control.scope === "section" &&
    !requested.some((t) => !matches(t, label) && matches(t, context))
  )
    evidence.adjustment -= 0.12;
  return {
    ...evidence,
    score: Math.max(
      0,
      Math.min(1, score / requested.length - specificity + evidence.adjustment),
    ),
  };
}
export function goalScore(
  goal: string,
  control: Pick<
    PageControl,
    "label" | "description" | "context" | "kind" | "scope" | "structure"
  >,
) {
  return goalMatch(goal, control).score;
}
export function expectedOutcome(control: PageControl) {
  switch (control.kind) {
    case "focus":
      return "The field receives focus; you enter any text yourself.";
    case "toggle":
      return "The checked state changes.";
    case "choice":
      return "This option becomes selected.";
    case "select":
      return "The selected option changes.";
    case "section":
      return "The destination section becomes visible.";
    case "navigation":
      return "The linked page loads in this tab.";
    case "expand":
      return "The expanded state or available controls change.";
    default:
      return "Review the website's result yourself; this control declares no verifiable outcome.";
  }
}
export function targetIdentity(control: PageControl) {
  if (control.kind === "section")
    return "section:" + (control.sectionKey || control.id);
  if (control.kind === "navigation" && control.navigationKey)
    return "navigation:" + control.navigationKey;
  // Equal labels/signatures do not prove that two distinct buttons have the same effect.
  return "control:" + control.id;
}
function unresolved(
  goal: string,
  reason: string,
  issue: GoalPlan["issue"] = "no-match",
): GoalPlan {
  return {
    goal,
    source: "semantics",
    status: "unresolved",
    confidence: 0,
    reason,
    issue,
    steps: [],
  };
}
export function actionBoundary(
  control: PageControl,
  goal = control.label,
): GoalPlan {
  return unresolved(
    goal,
    control.riskReason === "unknown-edit-effect"
      ? "This edit control does not declare whether it opens an editor or changes data immediately. Review its effect on the website before continuing."
      : "The matching control may submit or commit a change. Navigator stops before this consequential action; review it on the website.",
    control.riskReason === "unknown-edit-effect"
      ? "unknown-effect"
      : "consequential",
  );
}
function intentQuery(intent: GoalIntent) {
  return [
    sanitizeText(intent.target).slice(0, 80),
    sanitizeText(intent.context).slice(0, 80),
  ]
    .filter(Boolean)
    .join(" ");
}
function inScope(
  control: Pick<PageControl, "scope">,
  scope?: GoalIntent["scope"],
) {
  return (
    !scope ||
    scope === "any" ||
    (scope === "page"
      ? control.scope !== "section"
      : control.scope === "section")
  );
}
function operationMatches(intent: GoalIntent, control: PageControl) {
  return (
    intent.operation === "locate" ||
    (
      {
        focus: ["focus"],
        reveal: ["expand"],
        choose: ["choice", "toggle", "select", "range"],
        navigate: ["navigation", "section"],
      } as Record<string, string[]>
    )[intent.operation]?.includes(control.kind)
  );
}
function planGoalInternal(
  page: PageSnapshot,
  rawGoal: string,
  memory?: SiteMemory,
  proposal?: ModelProposal,
  trace: { path?: SiteMemory["transitions"] } = {},
  targetScope?: GoalIntent["scope"],
): GoalPlan {
  const goal = sanitizeGoal(rawGoal);
  if (!goal)
    return unresolved(
      "Choose a goal",
      "Describe what you want to find or change.",
      "missing-goal",
    );
  const usable = page.controls.filter(
    (c) => c.enabled && c.risk === "ordinary",
  );
  const revealersFor = (control: PageControl) =>
    control.revealIds
      .map((id) =>
        usable.find(
          (c) =>
            c.id === id && c.visible && ["expand", "toggle"].includes(c.kind),
        ),
      )
      .filter((c): c is PageControl => !!c);
  let target: PageControl | undefined,
    source: GoalPlan["source"] = "semantics",
    confidence = 0;
  if (proposal) {
    const grounded = planGoalInternal(page, goal, memory, undefined, trace);
    const fallback = (reason: string): GoalPlan =>
      grounded.issue !== "no-match"
        ? grounded
        : unresolved(goal, reason, "invalid-model");
    // A paraphrase is interpretation, never authority to cross an action boundary.
    if (["consequential", "unknown-effect"].includes(grounded.issue || ""))
      return grounded;
    const proposed = proposal.controlIds.map((id) =>
      usable.find((c) => c.id === id),
    );
    if (
      !proposed.length ||
      proposed.some((c) => !c) ||
      proposal.confidence < 0.6
    )
      return fallback(
        "The model did not identify a grounded control. Choose a control or clarify your goal.",
      );
    const first = proposed[0]!;
    if (!first.visible)
      return fallback(
        "The model selected a hidden control without its opening step.",
      );
    if (
      new Set(proposal.controlIds).size !== proposal.controlIds.length ||
      proposed.some(
        (c, i) =>
          !c!.visible && !c!.revealIds.includes(proposed[i - 1]?.id || ""),
      )
    )
      return fallback(
        "The model's steps do not form a route through the discovered controls.",
      );
    const groundedTarget = page.controls.find(
      (c) => c.id === grounded.steps.at(-1)?.controlId,
    );
    if (
      grounded.status === "completed" ||
      grounded.status === "awaiting-choice"
    )
      return grounded;
    if (
      grounded.status === "guiding" &&
      groundedTarget &&
      (groundedTarget.id !== proposed.at(-1)!.id ||
        goalScore(goal, groundedTarget) - goalScore(goal, proposed.at(-1)!) >
          0.08 ||
        (grounded.steps.length === 1 &&
          proposed[0]!.id !== groundedTarget.id &&
          goalScore(goal, groundedTarget) - goalScore(goal, proposed[0]!) >
            0.08))
    )
      return {
        ...grounded,
        reason:
          "The model's suggestion conflicted with a clearer live control match. Using the page's labels and accessibility evidence.",
      };
    const intent = proposal.intent;
    if (intent) {
      // Context qualifiers must come from the user's request. The model may
      // translate a task into a control purpose, but cannot invent a section.
      const contextTerms = tokens(intent.context);
      if (
        contextTerms.some((t) => !matches(t, tokens(goal))) ||
        (intent.scope === "section" && !contextTerms.length) ||
        !operationMatches(intent, proposed.at(-1)!)
      )
        return fallback(
          "The model's interpretation did not preserve the requested context or control effect.",
        );
      const interpreted = planGoalInternal(
        page,
        intentQuery(intent),
        memory,
        undefined,
        trace,
        intent.scope,
      );
      const targetId = interpreted.steps.at(-1)?.controlId;
      if (
        interpreted.status !== "guiding" ||
        targetId !== proposed.at(-1)!.id ||
        interpreted.steps.length !== proposed.length ||
        interpreted.steps.some((s, i) => s.controlId !== proposed[i]!.id)
      )
        return fallback(
          "The model's intent was not supported by an unambiguous live route.",
        );
      return {
        ...interpreted,
        goal,
        source: "on-device",
        confidence: Math.min(interpreted.confidence, proposal.confidence),
        interpretation: {
          ...intent,
          target: sanitizeText(intent.target).slice(0, 80),
          context: sanitizeText(intent.context).slice(0, 80),
        },
        reason:
          "Interpreted your goal using the current page structure; each control result is checked on the website.",
      };
    }
    if (
      grounded.status !== "guiding" ||
      grounded.steps.length !== proposed.length ||
      grounded.steps.some((s, i) => s.controlId !== proposed[i]!.id)
    )
      return fallback(
        "The model selected controls without a grounded interpretation of the goal.",
      );
    // Outcomes and eligibility always come from live observations.
    return {
      goal,
      source: "on-device",
      status: "guiding",
      confidence: proposal.confidence,
      reason:
        "On-device interpretation; each step is checked against the current page.",
      steps: proposed.map((c) => ({
        controlId: c!.id,
        label: c!.label,
        outcome: expectedOutcome(c!),
      })),
    };
  }
  const ranked = usable
    .filter((c) => inScope(c, targetScope))
    // Unreachable responsive/sticky duplicates cannot displace a usable control.
    .filter((c) => c.visible || revealersFor(c).length === 1)
    .map((c) => ({ c, score: goalScore(goal, c) - (c.visible ? 0 : 0.06) }))
    .filter((c) => c.score >= 0.6)
    .sort(
      (a, b) => b.score - a.score || Number(b.c.visible) - Number(a.c.visible),
    );
  if (ranked.length) {
    const best = ranked[0];
    const tied = ranked.filter((r) => best.score - r.score < 0.08);
    // Duplicate links are interchangeable only if their actual destination is identical.
    const identities = new Set(tied.map((r) => targetIdentity(r.c)));
    if (identities.size > 1)
      return unresolved(
        goal,
        "Several controls match this goal. Add context or choose one explicitly.",
        "ambiguous",
      );
    target = tied.find((r) => r.c.visible)?.c || best.c;
    confidence = Math.min(0.95, best.score);
  }
  const blocked = page.controls.find(
    (c) =>
      c.visible &&
      c.enabled &&
      c.risk !== "ordinary" &&
      inScope(c, targetScope) &&
      goalScore(goal, c) >= 0.6,
  );
  if (!target && blocked) return actionBoundary(blocked, goal);
  if (!target && memory) {
    const desired = new Set(
      (memory.states || memory.pages).flatMap((p) =>
        p.controls
          .filter(
            (c) =>
              c.active &&
              c.risk === "ordinary" &&
              inScope(c, targetScope) &&
              goalScore(goal, c) >= 0.7,
          )
          .map(() => p.stateKey),
      ),
    );
    const search = searchRoute(page, memory, desired);
    if (search.status === "pending")
      return {
        ...unresolved(
          goal,
          "Still finding the next step. Your destination and verified progress are retained.",
        ),
        budgetPending: true,
      };
    const path = search.path;
    if (path?.length) {
      target = usable.find(
        (c) => c.visible && c.signature === path[0].signature,
      );
      if (target) {
        source = "memory";
        trace.path = path;
        confidence = 0.85;
      }
    }
  }
  if (!target)
    return unresolved(
      goal,
      page.partial
        ? "This large page was partially scanned. Use the control filter, navigate closer, or describe a more specific goal."
        : "I could not identify a reliable next step from the controls scanned so far. Your destination is retained; reveal a navigation menu or use visual assistance.",
    );
  if (target.kind === "expand" && target.expanded === true)
    return {
      goal,
      source,
      status: "awaiting-choice",
      confidence,
      reason:
        "This menu is already open. Choose an option on the website, or describe the option you want.",
      steps: [],
    };
  if (
    (target.checked === true && target.kind === "choice") ||
    (target.kind === "section" && target.sectionVisible)
  )
    return {
      goal,
      source,
      status: "completed",
      confidence: 1,
      reason: "The requested state is already visible.",
      steps: [],
    };
  const steps: GoalPlan["steps"] = [];
  if (!target.visible) {
    const revealers = revealersFor(target);
    if (revealers.length !== 1)
      return unresolved(
        goal,
        "The target is hidden and its opening control is uncertain. Open the relevant menu and try again.",
        "hidden",
      );
    steps.push({
      controlId: revealers[0].id,
      label: revealers[0].label,
      outcome: expectedOutcome(revealers[0]),
    });
  }
  steps.push({
    controlId: target.id,
    label: target.label,
    outcome: expectedOutcome(target),
  });
  return {
    goal,
    source,
    status: "guiding",
    confidence,
    reason:
      source === "memory"
        ? "Following a previously observed transition; the next page will be checked again."
        : "Matched live control labels, accessibility descriptions, roles, and context. The page is checked after every step.",
    steps,
  };
}

export function inspectGoal(
  page: PageSnapshot,
  rawGoal: string,
  memory?: SiteMemory,
  proposal?: ModelProposal,
  interpretation?: GoalIntent,
) {
  const trace: { path?: SiteMemory["transitions"] } = {};
  const plan =
    proposal || !interpretation
      ? planGoalInternal(page, rawGoal, memory, proposal, trace)
      : replanIntent(page, rawGoal, interpretation, memory, trace);
  const goal = sanitizeGoal(rawGoal);
  const selected = new Set(plan.steps.map((s) => s.controlId));
  const roles = new Set([
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
  ]);
  const candidates: PlanningDiagnostics["candidates"] = page.controls
    .map((c) => {
      const { score: semanticScore, ...evidence } = goalMatch(goal, c);
      const revealers = c.revealIds.filter((id) =>
        page.controls.some(
          (r) =>
            r.id === id &&
            r.visible &&
            r.enabled &&
            r.risk === "ordinary" &&
            ["expand", "toggle"].includes(r.kind),
        ),
      );
      const score = Math.max(0, semanticScore - (c.visible ? 0 : 0.06));
      const reasons: PlanningDiagnostics["candidates"][number]["reasons"] = [];
      if (evidence.label) reasons.push("label-match");
      if (evidence.description) reasons.push("description-match");
      if (evidence.context) reasons.push("context-match");
      if (!evidence.qualified) reasons.push("qualifier-mismatch");
      if (!evidence.preference) reasons.push("opposite-preference");
      if (!c.enabled) reasons.push("disabled");
      if (c.risk !== "ordinary") reasons.push("consequential");
      if (!c.visible && !revealers.length) reasons.push("hidden-unreachable");
      if (!c.visible && revealers.length > 1) reasons.push("reveal-ambiguous");
      if (score < 0.6) reasons.push("below-threshold");
      if (selected.has(c.id))
        reasons.push(
          plan.steps.at(-1)?.controlId === c.id ? "selected" : "reveal-step",
        );
      return {
        id: c.id,
        signature: hash(c.signature),
        identity: hash(targetIdentity(c)),
        role: (roles.has(c.role)
          ? c.role
          : "unknown") as PlanningDiagnostics["candidates"][number]["role"],
        kind: c.kind,
        score,
        visible: c.visible,
        enabled: c.enabled,
        eligible:
          c.enabled &&
          c.risk === "ordinary" &&
          (c.visible || revealers.length === 1) &&
          score >= 0.6,
        revealIds: c.revealIds,
        reasons,
        evidence,
      };
    })
    .sort(
      (a, b) =>
        Number(selected.has(b.id)) - Number(selected.has(a.id)) ||
        b.score - a.score,
    );
  const eligible = candidates.filter((c) => c.eligible);
  const best = Math.max(...eligible.map((c) => c.score), 0);
  const tied = eligible.filter((c) => best - c.score < 0.08);
  for (const c of tied)
    if (tied.length > 1)
      c.reasons.push(
        plan.status === "unresolved" ? "tied" : "equivalent-destination",
      );
  const diagnostics: PlanningDiagnostics = {
    goalKey: hash(goal),
    revision: page.revision,
    source: plan.source,
    decision: plan.status,
    totalCandidates: page.controls.length,
    truncated: candidates.length > 50,
    candidates: candidates.slice(0, 50),
    memory: memory
      ? memoryDiagnostics(
          memory,
          page,
          plan.source === "memory" ? trace.path : [],
        )
      : undefined,
  };
  return { plan, diagnostics };
}
export function planGoal(
  page: PageSnapshot,
  rawGoal: string,
  memory?: SiteMemory,
  proposal?: ModelProposal,
) {
  return planGoalInternal(page, rawGoal, memory, proposal);
}
function replanIntent(
  page: PageSnapshot,
  rawGoal: string,
  intent: GoalIntent,
  memory?: SiteMemory,
  trace: { path?: SiteMemory["transitions"] } = {},
): GoalPlan {
  const original = planGoalInternal(page, rawGoal, memory, undefined, trace);
  if (original.status !== "unresolved" || original.issue !== "no-match")
    return original;
  const plan = planGoalInternal(
    page,
    intentQuery(intent),
    memory,
    undefined,
    trace,
    intent.scope,
  );
  const target = page.controls.find(
    (c) => c.id === plan.steps.at(-1)?.controlId,
  );
  if (plan.status === "guiding" && target && !operationMatches(intent, target))
    return original;
  return {
    ...plan,
    goal: sanitizeGoal(rawGoal),
    source: "on-device",
    interpretation: intent,
  };
}
