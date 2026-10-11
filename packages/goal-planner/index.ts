import {
  type PageControl,
  type PageSnapshot,
  type GoalPlan,
  type ModelProposal,
  type SiteMemory,
} from "../page-model";
import { sanitizeText } from "../privacy-redaction";
const stop = new Set(
  "a an the to of on in this that my me please find go navigate show open make change switch set turn use get article page mode website it i want can you for into how do does would could like choose select".split(
    " ",
  ),
);
function tokens(text: string) {
  return text
    .toLowerCase()
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
export function goalScore(
  goal: string,
  control: Pick<PageControl, "label" | "description" | "context" | "kind">,
) {
  const requested = [...new Set(tokens(goal))],
    label = tokens(control.label),
    description = tokens(control.description || ""),
    context = tokens(control.context);
  if (!requested.length) return 0;
  let score = 0;
  for (const term of requested) {
    const equivalents = aliases[term] || [term];
    const direct =
      matches(term, label) ||
      (equivalents[0] && matches(equivalents[0], label));
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
    return 0;
  if (
    (requested.some((t) => ["larger", "bigger"].includes(t)) &&
      !label.some((t) => ["large", "larger", "bigger"].includes(t))) ||
    (requested.includes("smaller") &&
      !label.some((t) => ["small", "smaller"].includes(t)))
  )
    return 0;
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
  const specificity = Math.min(0.4, extras.length * 0.12);
  return Math.max(
    0,
    Math.min(
      1,
      score / requested.length -
        specificity +
        (requested.includes("search")
          ? control.kind === "focus"
            ? 0.2
            : -0.2
          : 0) -
        (/\b(change|switch|set|select|choose)\b/i.test(goal) &&
        ["section", "navigation"].includes(control.kind)
          ? 0.12
          : 0),
    ),
  );
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
      return "A related page state or available controls change.";
  }
}
function unresolved(goal: string, reason: string): GoalPlan {
  return {
    goal,
    source: "semantics",
    status: "unresolved",
    confidence: 0,
    reason,
    steps: [],
  };
}
export function planGoal(
  page: PageSnapshot,
  rawGoal: string,
  memory?: SiteMemory,
  proposal?: ModelProposal,
): GoalPlan {
  const goal = sanitizeText(rawGoal);
  if (!goal)
    return unresolved(
      "Choose a goal",
      "Describe what you want to find or change.",
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
    const proposed = proposal.controlIds.map((id) =>
      usable.find((c) => c.id === id),
    );
    if (
      !proposed.length ||
      proposed.some((c) => !c) ||
      proposal.confidence < 0.6
    )
      return unresolved(
        goal,
        "The model did not identify a valid, safe control. Choose a control or clarify your goal.",
      );
    const first = proposed[0]!;
    if (!first.visible)
      return unresolved(
        goal,
        "The model selected a hidden control. Open its menu first.",
      );
    if (
      new Set(proposal.controlIds).size !== proposal.controlIds.length ||
      proposed.some(
        (c, i) =>
          !c!.visible && !c!.revealIds.includes(proposed[i - 1]?.id || ""),
      )
    )
      return unresolved(
        goal,
        "The model's steps do not form a valid route through the discovered controls.",
      );
    const grounded = planGoal(page, goal, memory);
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
      grounded.confidence >= 0.85 &&
      groundedTarget &&
      (goalScore(goal, groundedTarget) - goalScore(goal, proposed.at(-1)!) >
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
    // The model may choose controls, but outcomes and eligibility always come from live observations.
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
    const identities = new Set(
      tied.map((r) =>
        r.c.kind === "section"
          ? "section:" + (r.c.sectionKey || r.c.signature)
          : r.c.kind === "navigation" && r.c.navigationKey
            ? "navigation:" + r.c.navigationKey
            : r.c.signature,
      ),
    );
    if (identities.size > 1)
      return unresolved(
        goal,
        "Several controls match this goal. Add context or choose one explicitly.",
      );
    target = tied.find((r) => r.c.visible)?.c || best.c;
    confidence = Math.min(0.95, best.score);
  }
  if (!target && memory) {
    const desired = new Set(
      memory.pages.flatMap((p) =>
        p.controls
          .filter(
            (c) =>
              c.active && c.risk === "ordinary" && goalScore(goal, c) >= 0.7,
          )
          .map((c) => p.stateKey),
      ),
    );
    const queue = [
        { state: page.stateKey, path: [] as typeof memory.transitions },
      ],
      seen = new Set<string>();
    while (queue.length) {
      const current = queue.shift()!;
      if (seen.has(current.state) || current.path.length > 8) continue;
      seen.add(current.state);
      if (desired.has(current.state) && current.path.length) {
        target = usable.find(
          (c) => c.visible && c.signature === current.path[0].signature,
        );
        if (target) {
          source = "memory";
          confidence = 0.85;
          break;
        }
      }
      for (const edge of memory.transitions.filter(
        (t) =>
          t.active && t.evidence === "observed" && t.from === current.state,
      ))
        queue.push({ state: edge.to, path: [...current.path, edge] });
    }
  }
  if (!target)
    return unresolved(
      goal,
      page.partial
        ? "This large page was partially scanned. Use the control filter, navigate closer, or describe a more specific goal."
        : "No sufficiently clear route is known yet. Choose a control, reveal a menu, or enable on-device AI for interpretation.",
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
