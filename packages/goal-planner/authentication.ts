import type {
  GoalPlan,
  PageSnapshot,
  TaskJourney,
  SiteMemory,
  ModelProposal,
} from "../page-model";
import { planGoal, actionBoundary, goalScore, expectedOutcome } from "./index";

function uncertain(
  task: TaskJourney,
  reason: string,
  issue: GoalPlan["issue"] = "no-match",
): GoalPlan {
  return {
    goal: task.goal,
    source: "semantics",
    status: "unresolved",
    confidence: 0,
    steps: [],
    issue,
    reason,
  };
}

export function planAuthentication(
  page: PageSnapshot,
  task: TaskJourney,
  memory?: SiteMemory,
  proposal?: ModelProposal,
  base?: GoalPlan,
): GoalPlan {
  const workflow = task.objective.workflow!;
  const controls = page.controls.filter((c) => c.visible && c.enabled);
  const forms = new Set(
    controls
      .filter(
        (c) =>
          c.form?.authentication === workflow &&
          goalScore(task.goal, {
            ...c,
            label: workflow === "login" ? "Log in" : "Create account",
          }) >= 0.6,
      )
      .map((c) => c.form!.key),
  );
  if (forms.size > 1)
    return uncertain(
      task,
      "Several authentication forms match this task. Choose the intended form on the website.",
      "ambiguous",
    );
  if (forms.size === 1) {
    const key = [...forms][0];
    const lastNavigation = task.progress
      .map((p) => p.kind)
      .lastIndexOf("navigation");
    const focused = new Set(
      task.progress
        .slice(lastNavigation + 1)
        .filter((p) => p.origin === page.origin && p.kind === "focus")
        .map((p) => p.signature),
    );
    const field = controls.find(
      (c) =>
        c.form?.key === key &&
        c.kind === "focus" &&
        c.risk === "ordinary" &&
        !focused.has(c.signature),
    );
    if (field) {
      const plan = planGoal(page, field.label);
      if (plan.steps.at(-1)?.controlId !== field.id)
        return uncertain(
          task,
          "The next field has an ambiguous label. Choose it in the intended authentication form.",
          "ambiguous",
        );
      return {
        ...plan,
        goal: task.goal,
        reason:
          "Continue the original task in this authentication form. Enter any information yourself; focusing a field does not verify its contents or finish the task.",
      };
    }
    const commit = controls.find(
      (c) => c.form?.key === key && c.risk === "consequential",
    );
    return {
      ...(commit
        ? actionBoundary(commit, task.goal)
        : uncertain(
            task,
            "Review the authentication form on the website before continuing.",
            "consequential",
          )),
      reason:
        "You reached the authentication form. Complete private credentials and review submission on the website yourself. Tholi cannot verify login or account creation from field focus or a submission click.",
    };
  }
  const plan = base || planGoal(page, task.goal, memory, proposal);
  if (plan.status === "unresolved" && plan.issue === "no-match") {
    const openers = controls.filter(
      (c) =>
        c.kind === "expand" &&
        c.risk === "ordinary" &&
        c.expanded !== true &&
        /\b(account|profile|user|personal)\b/i.test(
          c.label + " " + (c.description || ""),
        ) &&
        !task.progress.some(
          (p) => p.origin === page.origin && p.signature === c.signature,
        ),
    );
    if (openers.length === 1)
      return {
        goal: task.goal,
        source: "semantics",
        status: "guiding",
        confidence: 0.6,
        reason:
          "This declared account menu may reveal an entry for your task. Its contents will be checked after you open it; the destination is retained.",
        steps: [
          {
            controlId: openers[0].id,
            label: openers[0].label,
            outcome: expectedOutcome(openers[0]),
          },
        ],
      };
  }
  // A heading is useful context, but its visibility is not evidence of an
  // authentication result. Nor is returning to the entry link after arrival.
  const final = page.controls.find(
    (c) => c.id === plan.steps.at(-1)?.controlId,
  );
  if (
    plan.status === "completed" ||
    final?.kind === "section" ||
    final?.kind === "focus"
  )
    return uncertain(
      task,
      "The authentication destination is not yet clear. Open the relevant form on the website; the original task is retained.",
    );
  if (
    final &&
    task.progress.some(
      (p) => p.origin === page.origin && p.signature === final.signature,
    )
  )
    return uncertain(
      task,
      "That entry control was already used. The task is retained while you reveal the next screen or form; Tholi will not send you back through the same entry.",
    );
  return { ...plan, goal: task.goal };
}
