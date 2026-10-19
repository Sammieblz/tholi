import type { TaskIntent } from "./contracts";
import type {
  GoalPlan,
  PageControl,
  PageSnapshot,
  TaskJourney,
} from "../page-model";
import { words } from "../nlp/retrieval";
import { hasCommitLanguage } from "../safety-policy/action-language";
import { authenticationIntent } from "../goal-planner/task-intent";

const textOf = (c: PageControl) =>
  [
    c.label,
    c.description,
    c.context,
    ...(c.structure?.regions.map((r) => r.name) || []),
  ]
    .filter(Boolean)
    .join(" ");
const subject = (text: string) => {
  const qualified =
    /\b(account|profile|user|personal|repository|repo|project|workspace|organization|organisation|team)\s+(?:settings?|preferences?)\b/i.exec(
      text,
    );
  const terms = qualified ? [qualified[1].toLowerCase()] : words(text);
  if (terms.some((w) => ["account", "profile", "user", "personal"].includes(w)))
    return "account";
  if (terms.some((w) => ["repository", "repo"].includes(w)))
    return "repository";
  if (terms.includes("project")) return "project";
  if (
    terms.some((w) =>
      ["workspace", "organization", "organisation", "team"].includes(w),
    )
  )
    return "workspace";
};

export function settingsDestination(task: TaskIntent) {
  const target = task.contextTarget || task.target;
  return subject(target) && /\b(settings?|preferences?)\b/i.test(target)
    ? target
    : undefined;
}

// An explicit settings namespace must not be replaced by another namespace.
export function compatibleSettingsScope(
  task: TaskIntent,
  control: PageControl,
) {
  const target = task.contextTarget || task.target;
  if (!/\b(settings?|preferences?)\b/i.test(target)) return true;
  const requested = subject(target);
  const namedScope = subject(control.label);
  const prefix = /^(.*?)\bsettings?\b/i.exec(control.label)?.[1];
  const qualifiedScope =
    prefix &&
    words(prefix)
      .filter(
        (w) =>
          ![
            "open",
            "manage",
            "the",
            "your",
            "my",
            "general",
            "advanced",
            "all",
          ].includes(w),
      )
      .join(" ");
  const declared =
    namedScope ||
    qualifiedScope ||
    subject(control.description || "") ||
    subject(control.context) ||
    subject(textOf(control));
  return !requested || !declared || requested === declared;
}

export function groundedSettingsTarget(task: TaskIntent, control: PageControl) {
  const target = task.contextTarget || task.target;
  const requested = subject(target);
  return (
    !!requested &&
    /\b(settings?|preferences?)\b/i.test(target) &&
    /\b(settings?|preferences?)\b/i.test(control.label) &&
    (subject(control.label) ||
      subject(control.description || "") ||
      subject(control.context) ||
      subject(textOf(control))) === requested &&
    compatibleSettingsScope(task, control)
  );
}

/** Explore only fresh, named, ordinary navigation surfaces. This is not an outcome. */
export function exploreDestination(
  page: PageSnapshot,
  task: TaskIntent,
  journey?: TaskJourney,
): GoalPlan | undefined {
  if (
    task.desiredValue ||
    hasCommitLanguage(task.target) ||
    !["locate", "navigate", "reveal"].includes(task.operation)
  )
    return;
  const target = task.contextTarget || task.target;
  const requested = words(target),
    area = subject(target);
  const purposeTerms = requested.filter(
    (w) => !["settings", "preferences", "menu"].includes(w),
  );
  const progress = journey?.requestTaskId === task.id ? journey.progress : [];
  // Settings are reached through account/profile/navigation menus, even when
  // the destination itself is not mounted yet. No site, URL or selector table.
  const settings = /\b(settings?|preferences?)\b/i.test(target);
  const authentication = authenticationIntent(target);
  const candidates = page.controls
    .filter((c) => {
      const text = textOf(c);
      return (
        c.visible &&
        c.enabled &&
        !c.occluded &&
        c.risk === "ordinary" &&
        (task.scope === "any" || !c.scope || task.scope === c.scope) &&
        c.kind === "expand" &&
        c.expanded !== true &&
        compatibleSettingsScope(task, c) &&
        task.qualifiers.every(
          (q) =>
            words(q).every((w) => words(text).includes(w)) ||
            (!!subject(q) && subject(q) === area),
        ) &&
        !task.exclusions.some((e) =>
          words(e).some((w) => words(text).includes(w)),
        ) &&
        !progress.some(
          (p) => p.origin === page.origin && p.signature === c.signature,
        ) &&
        // Purpose must come from the current control's name/description, not an
        // unrelated enclosing dashboard heading.
        (authentication
          ? /\b(account|profile|user|navigation|menu)\b/i.test(
              c.label + " " + (c.description || ""),
            )
          : settings && area
            ? subject(c.label + " " + (c.description || "")) === area
            : purposeTerms.length > 0 &&
              purposeTerms.every((w) =>
                words(c.label + " " + (c.description || "")).includes(w),
              ))
      );
    })
    .map((c) => ({
      c,
      score:
        requested.filter((w) =>
          words(c.label + " " + (c.description || "")).includes(w),
        ).length +
        Number(/\b(manage|settings|preferences)\b/i.test(c.label)) * 0.5 -
        Number(/\b(switch|switcher|select|choose)\b/i.test(c.label)) * 0.75,
    }))
    .sort((a, b) => b.score - a.score);
  const first = candidates[0];
  if (!first || (candidates[1] && first.score - candidates[1].score < 0.25))
    return;
  return {
    goal: task.original,
    status: "guiding",
    source: "semantics",
    confidence: 0.6,
    exploration: true,
    reason: `Open “${first.c.label}” to look for ${target.slice(0, 160)}. I’ll keep your destination and check the menu's controls next.`,
    steps: [
      {
        controlId: first.c.id,
        label: first.c.label,
        outcome:
          "The menu's expanded state or owned controls change; the destination remains unverified.",
      },
    ],
  };
}
