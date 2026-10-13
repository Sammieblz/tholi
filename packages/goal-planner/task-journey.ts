import type {
  TaskJourney,
  PageSnapshot,
  PageControl,
  GoalPlan,
  SiteMemory,
  ModelProposal,
  SavedTask,
  RouteStrategy,
} from "../page-model";
import { hash } from "../page-model";
import { sanitizeText, sanitizeGoal } from "../privacy-redaction";
import { planGoal, goalScore, targetIdentity } from "./index";
import { shortestRoute, edgeCost } from "./route-graph";
import { authenticationIntent } from "./task-intent";
import { planAuthentication } from "./authentication";

const normalize = (v: string) =>
  v
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
function booleanValue(value: string) {
  if (/^(on|enabled|enable|yes|true)$/i.test(value)) return true;
  if (/^(off|disabled|disable|no|false)$/i.test(value)) return false;
  return undefined;
}
let languageNames: Map<string, string> | undefined;
export function languageCode(value: string) {
  if (!languageNames) {
    languageNames = new Map();
    const english = new Intl.DisplayNames(["en"], {
      type: "language",
      fallback: "none",
    });
    // ISO language names come from the browser's locale data, not a website table.
    for (let a = 97; a <= 122; a++)
      for (let b = 97; b <= 122; b++) {
        const code = String.fromCharCode(a, b),
          name = english.of(code);
        if (!name) continue;
        languageNames.set(normalize(name), code);
        try {
          const native = new Intl.DisplayNames([code], {
            type: "language",
            fallback: "none",
          }).of(code);
          if (native) languageNames.set(normalize(native), code);
        } catch {}
      }
  }
  return languageNames.get(normalize(value));
}
export function beginJourney(
  goal: string,
  origin: string,
  strategy: RouteStrategy = "fastest",
  now = Date.now(),
): TaskJourney {
  goal = sanitizeGoal(goal);
  const split = goal.match(
    /^(?:.*?\b)?(?:change|switch|set|choose|select)\s+(?:the\s+)?(.+?)\s+(?:to|into)\s+(.+?)[.!?]?$/i,
  );
  const objective = split
    ? {
        purpose: sanitizeText(split[1]),
        value: sanitizeGoal(split[2]),
        language: /\blanguages?\b/i.test(split[1])
          ? languageCode(split[2])
          : undefined,
      }
    : { purpose: sanitizeText(goal), workflow: authenticationIntent(goal) };
  return {
    id: crypto.randomUUID(),
    goal,
    origin,
    objective,
    strategy,
    startedAt: now,
    updatedAt: now,
    status: "active",
    progress: [],
    reroutes: 0,
  };
}
export function contextualTask(task?: TaskJourney) {
  return !!(
    task?.objective.value ||
    task?.objective.workflow ||
    task?.workflow
  );
}
export function resumeJourney(task: TaskJourney): TaskJourney {
  if (task.objective.value || task.objective.workflow) return task;
  const workflow = authenticationIntent(task.goal);
  return workflow
    ? { ...task, objective: { ...task.objective, workflow }, status: "active" }
    : task;
}
export function taskKey(
  task: Pick<TaskJourney, "origin" | "goal" | "strategy">,
) {
  return hash(task.origin + "|" + normalize(task.goal) + "|" + task.strategy);
}
export function saveTask(
  task: TaskJourney,
  page?: PageSnapshot,
  plan?: GoalPlan,
): SavedTask {
  return {
    id: taskKey(task),
    origin: task.origin,
    goal: sanitizeGoal(task.workflow?.objective || task.goal),
    canonicalGoal: task.workflow?.objective || task.canonicalGoal,
    objective: task.workflow
      ? { purpose: task.workflow.objective }
      : task.objective,
    guideId: task.workflow?.guideId,
    guideVersion: task.workflow?.guideVersion,
    parameters: task.workflow?.entities.map((e) => e.type),
    retention:
      page?.controls.some(
        (c) => c.reference?.frameId || c.retention === "session",
      ) || task.workflow?.entities.length
        ? "session"
        : undefined,
    strategy: task.strategy,
    updatedAt: task.updatedAt,
    completed: task.status === "completed",
    progress: task.progress,
    planned: plan
      ? [
          ...plan.steps.map((s) => ({
            label: s.label,
            signature: page?.controls.find((c) => c.id === s.controlId)
              ?.signature,
            evidence: "live" as const,
          })),
          ...(plan.route?.predictions || []),
        ].slice(0, 24)
      : undefined,
    estimate: plan?.route,
  };
}
function valueScore(
  task: TaskJourney,
  c: Pick<
    PageControl,
    | "label"
    | "description"
    | "context"
    | "kind"
    | "scope"
    | "structure"
    | "targetLanguage"
    | "options"
    | "range"
  >,
) {
  const { value, language, purpose } = task.objective;
  if (!value) return goalScore(task.goal, c);
  const exactLanguage =
    language && c.targetLanguage?.split("-")[0].toLowerCase() === language;
  const requested = normalize(value),
    label = normalize(c.label);
  const context = normalize(
    [
      c.context,
      c.description,
      ...(c.structure?.regions.map((r) => r.name) || []),
      ...(c.structure?.headings.map((h) => h.label) || []),
    ].join(" "),
  );
  const purposeWords = normalize(purpose)
    .split(" ")
    .filter((w) => w !== "the");
  const groundedPurpose = purposeWords.every((w) =>
    (label + " " + context).includes(w.replace(/s$/, "")),
  );
  if (
    c.kind === "toggle" &&
    groundedPurpose &&
    booleanValue(value) !== undefined
  )
    return 1;
  if (
    c.kind === "select" &&
    groundedPurpose &&
    c.options?.some((o) => o.enabled && normalize(o.label) === requested)
  )
    return 1;
  if (
    c.kind === "range" &&
    groundedPurpose &&
    c.range &&
    Number.isFinite(Number(value)) &&
    Number(value) >= c.range.min &&
    Number(value) <= c.range.max
  )
    return 1;
  if (
    exactLanguage &&
    (/^(?:(?:page|site|website|display|interface|ui) )?languages?$/i.test(
      purpose,
    ) ||
      groundedPurpose)
  )
    return 1;
  // Option labels may include their setting name; every requested value word
  // must still match directly. Nearby unrelated links do not inherit intent.
  const words = requested.split(" ");
  return groundedPurpose && words.every((w) => label.split(" ").includes(w))
    ? 0.95
    : 0;
}
export function objectiveReached(task: TaskJourney, page: PageSnapshot) {
  if (task.workflow) return task.workflow.status === "completed";
  if (
    task.objective.language &&
    /^(?:(?:page|site|website|display|interface|ui) )?languages?$/i.test(
      task.objective.purpose,
    ) &&
    page.language.split("-")[0].toLowerCase() === task.objective.language
  )
    return true;
  return (
    !!task.objective.value &&
    page.controls.some(
      (c) =>
        c.visible &&
        c.enabled &&
        c.risk === "ordinary" &&
        valueScore(task, c) >= 0.9 &&
        ((c.kind === "choice" && c.checked === true) ||
          (c.kind === "toggle" &&
            c.checked === booleanValue(task.objective.value!)) ||
          c.selected === true ||
          (c.kind === "range" &&
            c.range?.current === Number(task.objective.value)) ||
          (c.kind === "select" &&
            c.options?.some(
              (o) =>
                o.selected &&
                normalize(o.label) === normalize(task.objective.value!),
            ))),
    )
  );
}
export function advanceJourney(
  task: TaskJourney,
  page: PageSnapshot,
  control: PageControl,
  from: string,
  durationMs: number,
  now = Date.now(),
  fromOrigin = page.origin,
) {
  const progress = [
    ...task.progress,
    {
      origin: fromOrigin,
      from,
      to: page.stateKey,
      signature: control.signature,
      label: control.label,
      kind: control.kind,
      durationMs: Math.min(300000, Math.max(0, durationMs)),
      at: now,
    },
  ].slice(-30);
  const complete = task.objective.value
    ? objectiveReached(task, page)
    : task.status === "completed";
  return {
    ...task,
    progress,
    updatedAt: now,
    status: complete ? ("completed" as const) : ("active" as const),
  };
}
export function planTask(
  page: PageSnapshot,
  task: TaskJourney,
  memory?: SiteMemory,
  proposal?: ModelProposal,
  saved?: SavedTask,
  base?: GoalPlan,
): GoalPlan {
  task = resumeJourney(task);
  if (saved && taskKey(saved) !== taskKey(task)) saved = undefined;
  let plan: GoalPlan;
  let path: SiteMemory["transitions"] | undefined;
  let pathEndsAtDestination = false;
  if (
    (!contextualTask(task) && task.status === "completed") ||
    objectiveReached(task, page)
  ) {
    plan = {
      goal: task.goal,
      status: "completed",
      source: "semantics",
      confidence: 1,
      steps: [],
      reason: "The requested destination state was observed.",
    };
  } else if (task.objective.workflow) {
    plan = planAuthentication(page, task, memory, proposal, base);
  } else if (!task.objective.value) {
    plan = base || planGoal(page, task.goal, memory, proposal);
    if (memory && plan.source === "memory") {
      const desired = new Set(
        (memory.states || memory.pages)
          .filter((p) =>
            p.controls.some(
              (c) =>
                c.active &&
                c.risk === "ordinary" &&
                goalScore(task.goal, c) >= 0.7,
            ),
          )
          .map((p) => p.stateKey),
      );
      path = shortestRoute(page, memory, desired, task.strategy);
      if (path?.length) {
        const first = page.controls.find(
          (c) =>
            c.signature === path![0].signature &&
            c.visible &&
            c.enabled &&
            c.risk === "ordinary",
        )!;
        const candidate = planGoal(page, first.label);
        if (candidate.steps[0]?.controlId === first.id)
          plan = { ...candidate, goal: task.goal, source: "memory" };
      }
    }
  } else {
    const candidates = page.controls.filter(
      (c) =>
        c.enabled &&
        c.risk === "ordinary" &&
        valueScore(task, c) >= 0.9 &&
        (c.visible ||
          c.revealIds.some((id) =>
            page.controls.some(
              (r) =>
                r.id === id && r.visible && r.enabled && r.risk === "ordinary",
            ),
          )),
    );
    const identities = new Set(candidates.map(targetIdentity));
    if (identities.size > 1)
      plan = {
        goal: task.goal,
        source: "semantics",
        status: "unresolved",
        confidence: 0,
        steps: [],
        issue: "ambiguous",
        reason:
          "Several options match the destination. Choose the intended control or add context.",
      };
    else if (candidates.length) {
      const c = candidates.find((c) => c.visible) || candidates[0];
      plan = planGoal(page, c.label);
      // Identical destinations can have differing visible labels; retain only
      // a route whose final live control is the intended option.
      if (plan.steps.at(-1)?.controlId !== c.id && plan.status !== "completed")
        plan = {
          ...plan,
          status: "unresolved",
          steps: [],
          issue: "ambiguous",
          reason:
            "The destination option needs a clearer opening relationship.",
        };
      if (c.kind === "select" && plan.status === "guiding")
        plan.steps.at(-1)!.outcome =
          `Choose “${task.objective.value}” in this field; its actual selected option is checked.`;
    } else {
      const desired = new Set(
        (memory?.states || memory?.pages || [])
          .filter((p) =>
            p.controls.some(
              (c) =>
                c.active && c.risk === "ordinary" && valueScore(task, c) >= 0.9,
            ),
          )
          .map((p) => p.stateKey),
      );
      if (memory) path = shortestRoute(page, memory, desired, task.strategy);
      if (path?.length) {
        const first = page.controls.find(
          (c) =>
            c.signature === path![0].signature &&
            c.visible &&
            c.enabled &&
            c.risk === "ordinary",
        )!;
        plan = planGoal(page, first.label);
        plan.source = "memory";
      } else {
        plan = planGoal(page, task.objective.purpose, memory, proposal);
        if (plan.status === "awaiting-choice" || plan.issue === "no-match") {
          const visited = new Set(task.progress.map((p) => p.signature));
          const opened = new Set(
            page.controls
              .filter((c) => visited.has(c.signature) && c.kind === "expand")
              .map((c) => c.id),
          );
          const intermediates = page.controls
            .filter(
              (c) =>
                c.visible &&
                c.enabled &&
                c.risk === "ordinary" &&
                ["navigation", "expand", "select", "focus"].includes(c.kind) &&
                !visited.has(c.signature) &&
                c.revealIds.some((id) => opened.has(id)),
            )
            .map((c) => ({ c, score: goalScore(task.objective.purpose, c) }))
            .filter((r) => r.score >= 0.4)
            .sort((a, b) => b.score - a.score);
          if (
            intermediates.length &&
            (intermediates.length === 1 ||
              intermediates[0].score - intermediates[1].score >= 0.08)
          ) {
            const candidate = planGoal(page, intermediates[0].c.label);
            if (candidate.steps.at(-1)?.controlId === intermediates[0].c.id)
              plan = candidate;
          }
        }
        if (plan.status === "completed" || plan.status === "awaiting-choice")
          plan = {
            ...plan,
            status: "unresolved",
            steps: [],
            issue: "no-match",
            reason: `Still looking for “${task.objective.value}”. The menu is open; reveal more options on the website. Your destination is retained.`,
          };
        const intermediate = page.controls.find(
          (c) => c.id === plan.steps.at(-1)?.controlId,
        );
        if (
          plan.status === "guiding" &&
          intermediate &&
          (["toggle", "choice", "select", "action"].includes(
            intermediate.kind,
          ) ||
            task.progress.some(
              (p) =>
                p.origin === page.origin &&
                p.signature === intermediate.signature &&
                p.to === page.stateKey,
            ))
        ) {
          plan = {
            ...plan,
            status: "unresolved",
            confidence: 0,
            steps: [],
            issue: "no-match",
            reason: `The requested option “${task.objective.value}” is not available yet. Your destination is retained; reveal another screen or option on the website.`,
          };
        }
      }
    }
    plan = { ...plan, goal: task.goal };
    // Compare a directly available option with previously completed routes.
    // A faster observed detour can beat a slow direct control; click preference
    // still favors the shortest interaction count.
    if (memory && plan.status === "guiding") {
      const states = memory.states || memory.pages;
      const terminal = new Set(
        states
          .filter((p) =>
            objectiveReached(task, {
              ...page,
              language: p.language || "und",
              controls: p.controls.map((c, i) => ({
                ...c,
                id: `w0000000000000000-${i}`,
                revealIds: [],
                inViewport: false,
              })),
            }),
          )
          .map((p) => p.stateKey),
      );
      const alternative = shortestRoute(page, memory, terminal, task.strategy);
      const current = page.controls.find(
        (c) => c.id === plan.steps[0]?.controlId,
      );
      if (alternative?.length && current) {
        const direct = memory.transitions.find(
          (e) =>
            e.active &&
            e.evidence === "observed" &&
            e.from === page.stateKey &&
            e.signature === current.signature,
        );
        const currentCost =
          task.strategy === "fewest-clicks"
            ? plan.steps.length
            : (direct ? edgeCost(direct, task.strategy) : 5000) +
              (plan.steps.length - 1) * 5000;
        const alternativeCost = alternative.reduce(
          (sum, e) => sum + edgeCost(e, task.strategy),
          0,
        );
        if (
          alternativeCost < currentCost ||
          (plan.source === "memory" && alternativeCost <= currentCost)
        ) {
          const first = page.controls.find(
            (c) => c.visible && c.signature === alternative[0].signature,
          )!;
          const candidate = planGoal(page, first.label);
          if (candidate.steps[0]?.controlId === first.id) {
            plan = {
              ...candidate,
              goal: task.goal,
              source: "memory",
              reason:
                "Calculated the best known observed route for your preference. Every next screen is checked again.",
            };
            path = alternative;
            pathEndsAtDestination = true;
          }
        }
      }
    }
  }
  const next = page.controls.find((c) => c.id === plan.steps[0]?.controlId);
  const finalLive = page.controls.find(
    (c) => c.id === plan.steps.at(-1)?.controlId,
  );
  const savedIndex =
    saved?.progress.findIndex(
      (p) =>
        p.origin === page.origin &&
        p.from === page.stateKey &&
        p.signature === next?.signature,
    ) ?? -1;
  const savedSteps =
    savedIndex >= 0 && saved?.completed ? saved.progress.slice(savedIndex) : [];
  const observations = path || [];
  const predictions: NonNullable<GoalPlan["route"]>["predictions"] =
    observations
      .slice(1)
      .map((e) => ({ label: e.label, evidence: "observed" }));
  if (!predictions.length && savedSteps.length > 1)
    predictions.push(
      ...savedSteps
        .slice(1, 13)
        .map((p) => ({ label: p.label, evidence: "observed" as const })),
    );
  if (
    !predictions.length &&
    !pathEndsAtDestination &&
    task.objective.value &&
    plan.status === "guiding" &&
    finalLive &&
    valueScore(task, finalLive) < 0.9
  )
    predictions.push({ label: task.objective.value, evidence: "predicted" });
  const clicks =
    plan.status === "completed"
      ? 0
      : Math.max(
          plan.steps.length,
          observations.length
            ? observations.length +
                Number(!!task.objective.value && !pathEndsAtDestination)
            : 0,
          savedSteps.length,
          plan.steps.length +
            predictions.filter((p) => p.evidence === "predicted").length,
        );
  const complete =
    plan.status === "completed" ||
    pathEndsAtDestination ||
    !!savedSteps.length ||
    (!!plan.steps.length &&
      ((!contextualTask(task) && plan.source !== "memory") ||
        !!page.controls.find(
          (c) =>
            task.objective.value &&
            c.id === plan.steps.at(-1)?.controlId &&
            valueScore(task, c) >= 0.9,
        )));
  const timings = observations.length
    ? observations.map((e) => e.meanMs || 5000)
    : savedSteps.map((e) => e.durationMs);
  const ms = timings.length
    ? timings.reduce((a, b) => a + b, 0) +
      Math.max(0, clicks - timings.length) * 5000
    : clicks * 5000;
  plan.route = {
    strategy: task.strategy,
    clicks,
    minSeconds: Math.floor((ms * 0.5) / 1000),
    maxSeconds: Math.ceil((ms * 2) / 1000),
    complete,
    available:
      plan.status === "completed" ||
      (plan.status === "guiding" && !!plan.steps.length),
    basis: timings.length
      ? timings.length >= clicks
        ? "observed"
        : "mixed"
      : "estimated",
    predictions: predictions.slice(0, 12),
  };
  return plan;
}
