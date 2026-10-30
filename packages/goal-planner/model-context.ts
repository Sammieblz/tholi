import type { PageSnapshot, TaskJourney } from "../page-model";
import { goalScore } from "./index";
import { sanitizeGoal, sanitizeText } from "../privacy-redaction";
import type { NavigationContext } from "../navigation-core/contracts-navigation";

// Only the user's goal and independently verified step summaries leave the
// journey owner. Checkpoints, field values and browsing paths stay local.
export function buildNavigationContext(
  rawGoal: string,
  task?: Pick<TaskJourney, "progress">,
): NavigationContext {
  return {
    goal: sanitizeGoal(rawGoal),
    verifiedProgress: (task?.progress || [])
      .map((step) => ({ label: sanitizeText(step.label), kind: step.kind }))
      .filter((step) => step.label.length > 0)
      .slice(-8),
  };
}

const MAX_CONTROLS = 96;
const MAX_CHARACTERS = 24000;
// Retrieval is generic: purpose matches first, then interface controls and
// their opening relationships. DOM order is only a tie breaker.
export function modelContext(
  page: PageSnapshot,
  rawGoal: string,
  task?: TaskJourney,
) {
  const context = buildNavigationContext(rawGoal, task);
  const { goal } = context;
  const terms = goal.toLowerCase().match(/[\p{L}\p{N}]{3,}/gu) || [];
  const byId = new Map(page.controls.map((c) => [c.id, c]));
  const ranked = page.controls
    .filter((c) => c.enabled)
    .map((c, index) => {
      const text = [
        c.label,
        c.description,
        c.context,
        ...(c.structure?.headings.map((h) => h.label) || []),
        ...(c.structure?.regions.map((r) => r.name) || []),
      ]
        .join(" ")
        .toLowerCase();
      return {
        c,
        index,
        score:
          goalScore(goal, c) * 100 +
          terms.filter((t) => text.includes(t)).length * 3 +
          Number(c.kind !== "navigation" && c.kind !== "section") * 5 +
          Number(c.scope === "page") * 4 +
          Number(!!c.popup) * 3 +
          Number(c.inViewport),
      };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index);
  const selected = new Map<string, ReturnType<typeof pack>>();
  function pack(c: PageSnapshot["controls"][number]) {
    return {
      id: c.id,
      label: c.label,
      description: c.description,
      role: c.role,
      context: c.context,
      scope: c.scope,
      structure: c.structure,
      form: c.form,
      kind: c.kind,
      popup: c.popup,
      visible: c.visible,
      placement: c.placement,
      checked: c.checked,
      selected: c.selected,
      expanded: c.expanded,
      revealIds: c.revealIds,
      risk: c.risk,
      riskReason: c.riskReason,
      targetLanguage: c.targetLanguage,
      options: c.options,
      destination: c.destination
        ? {
            sameOrigin: c.destination.origin === page.origin,
            path: c.destination.path,
          }
        : undefined,
    };
  }
  let size = 0;
  for (const { c } of ranked) {
    const related = [
      c,
      ...c.revealIds
        .map((id) => byId.get(id))
        .filter((r): r is typeof c => !!r && r.enabled),
    ];
    const added = related.filter((r) => !selected.has(r.id)).map(pack);
    const length = JSON.stringify(added).length;
    if (
      selected.size + added.length > MAX_CONTROLS ||
      size + length > MAX_CHARACTERS
    )
      continue;
    for (const item of added) selected.set(item.id, item);
    size += length;
  }
  const controls = [...selected.values()].map((c) => ({
    ...c,
    revealIds: c.revealIds.filter((id) => selected.has(id)),
  }));
  return {
    goal,
    task: task
      ? {
          id: task.id,
          strategy: task.strategy,
          status: task.status,
          reroutes: task.reroutes,
          verifiedProgress: context.verifiedProgress,
        }
      : undefined,
    page: {
      origin: page.origin,
      language: page.language,
      layout: page.layout,
      revision: page.revision,
      partialScan: page.partial,
      discoveredControls: page.controls.length,
      omittedControls: page.controls.length - controls.length,
    },
    controls,
  };
}
