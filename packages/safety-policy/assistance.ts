import type { PageControl } from "../page-model";
import type { TaskIntent } from "../navigation-core/contracts";
import { hasCommitLanguage } from "./action-language";
import { taskWords } from "../goal-planner/task-intent";

/** Assistance grants no authority to submit forms, navigate links or commit changes. */
export function assistanceKind(control: PageControl, task?: TaskIntent) {
  if (
    !task ||
    task.status !== "active" ||
    !control.visible ||
    !control.enabled ||
    !control.inViewport ||
    control.occluded ||
    control.reference?.frameId ||
    control.risk !== "ordinary" ||
    hasCommitLanguage(control.label) ||
    /\b(?:create|add|remove|cancel|approve|sign|log|register|upgrade|downgrade)\b/i.test(
      control.label,
    )
  )
    return;
  if (
    control.kind === "expand" &&
    control.expanded === false &&
    (!control.popup || ["menu", "listbox", "tree"].includes(control.popup))
  )
    return "reveal";
  if (task.operation !== "choose" || !task.desiredValue) return;
  const same = (text: string) =>
    taskWords(text).trim() === taskWords(task.desiredValue!).trim();
  if (
    control.kind === "choice" &&
    ["radio", "option", "tab"].includes(control.role) &&
    same(control.label) &&
    !control.checked &&
    !control.selected
  )
    return "choice";
  if (
    control.kind === "select" &&
    control.options?.filter((o) => o.enabled && same(o.label)).length === 1 &&
    !control.options.some((o) => o.selected && same(o.label))
  )
    return "select";
}
