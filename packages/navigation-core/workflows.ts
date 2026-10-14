import {
  type PageControl,
  type PageSnapshot,
  type GoalPlan,
  type SiteMemory,
} from "../page-model";
import { beginJourney, planTask } from "../goal-planner/task-journey";
import type {
  NavigationRequest,
  PlanInput,
  PlanResult,
  TaskIntent,
} from "./contracts";
import type {
  WorkflowContext,
  WorkflowGuide,
  OutcomeEvidence,
} from "./workflow-contracts";
import { workflowGuides, platformFor } from "./guides";
import { words, type SemanticIndex } from "../nlp/retrieval";
import { sanitizeGoal, sanitizeText } from "../privacy-redaction";
import { signalIdentity } from "./evidence";

const norm = (s: string) =>
  s
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}.]+/gu, " ")
    .trim();
const exact = (a: string, b: string) => norm(a) === norm(b);
const matches = (text: string, query: string) =>
  words(query).length > 0 && words(query).every((w) => words(text).includes(w));
const entityValue = (w: WorkflowContext, type?: string) =>
  w.entities.find((e) => e.type === type)?.value;
const positiveText = (text: string) =>
  text.replace(
    /\b(?:but\s+)?(?:do not|don't|not|without|except|excluding|avoid)\s+(.+?)(?=,|\bbut\b|$)/gi,
    "",
  );
function initialEntities(
  task: TaskIntent,
  original: string,
  guide: WorkflowGuide,
): WorkflowContext["entities"] {
  original = positiveText(
    task.clause || original.split(/\b(?:actually|rather),?\s+/i).at(-1)!,
  );
  const entities: WorkflowContext["entities"] = [];
  const add = (
    type: WorkflowContext["entities"][number]["type"],
    value?: string,
  ) => {
    if (value)
      entities.push({ type, value: sanitizeGoal(value), source: "request" });
  };
  for (const type of [
    "account",
    "repository",
    "project",
    "issue",
    "branch",
    "plan",
  ] as const) {
    const synonyms = {
      account: "account|organization|owner",
      repository: "repository|repo",
      project: "project|space|site",
      issue: "issue|ticket|work item|bug",
      branch: "branch",
      plan: "plan",
    }[type];
    const quoted = original.match(
      new RegExp(
        `(?:${synonyms})\\s+(?:(?:called|named|titled)\\s+)?["“']([^"”']+)["”']`,
        "i",
      ),
    );
    const named = original.match(
      new RegExp(
        `(?:${synonyms})\\s+(?:called|named|titled)\\s+(.+?)(?=\\s+(?:in|on|using|with|and|then)\\b|[.!?]|$)`,
        "i",
      ),
    );
    const bare = original.match(
      new RegExp(
        `(?:${synonyms})\\s+([\\p{L}\\p{N}_][\\p{L}\\p{N}_./-]*)(?=\\s|[.!?]|$)`,
        "iu",
      ),
    );
    add(
      type,
      quoted?.[1] ||
        named?.[1] ||
        (bare &&
        !/^(?:to|in|on|for|from|with|using|settings|default|called|named|titled|and|please|that|this|same)$/i.test(
          bare[1],
        )
          ? bare[1].replace(/[.!?]+$/, "")
          : undefined),
    );
  }
  if (task.desiredValue) {
    const type = /captions|subtitle/.test(guide.id)
      ? "language"
      : guide.id.includes("speed")
        ? "speed"
        : guide.id.includes("branch")
          ? "branch"
          : guide.id.includes("plan")
            ? "plan"
            : undefined;
    if (type && !entities.some((e) => e.type === type))
      add(type, task.desiredValue);
  }
  const desiredType = /captions|subtitle/.test(guide.id)
    ? "language"
    : guide.id.includes("speed")
      ? "speed"
      : guide.id.includes("branch")
        ? "branch"
        : guide.id.includes("plan")
          ? "plan"
          : undefined;
  if (desiredType && !entities.some((e) => e.type === desiredType)) {
    const value =
      desiredType === "speed"
        ? original.match(/\b(\d+(?:\.\d+)?)\s*(?:x|times|speed)\b/i)?.[1]
        : original.match(/\b(?:to|in)\s+["“']?(.+?)["”']?(?:[.!?]|$)/i)?.[1];
    add(desiredType, value);
  }
  if (guide.platform === "cloudflare") {
    if (/\b(git|github|gitlab|repository|repo)\b/i.test(original))
      add("method", "git");
    else if (
      /\b(direct upload|prebuilt|zip|upload files|drag and drop)\b/i.test(
        original,
      )
    )
      add("method", "upload");
  }
  return entities;
}
export async function selectGuide(
  input: PlanInput,
  task: TaskIntent,
  index: SemanticIndex,
  signal?: AbortSignal,
) {
  const platform = platformFor(input.observation.origin);
  const candidates = workflowGuides.filter((g) => g.platform === platform);
  if (!candidates.length || task.operation === "search" || task.negatedOnly)
    return;
  const sentence = positiveText(
    (task.clause ||
      task.original.split(/\b(?:actually|rather),?\s+/i).at(-1)!) +
      " " +
      task.target,
  ).toLowerCase();
  if (
    platform === "cloudflare" &&
    /\bworkers?\b/.test(sentence) &&
    !/\bpages\b/.test(sentence)
  )
    return;
  const direct = candidates.filter((g) =>
    g.intents.some((i) => matches(sentence, i)),
  );
  if (direct.length === 1) return direct[0];
  if (direct.length > 1)
    return direct.sort(
      (a, b) =>
        Math.max(...b.intents.map((i) => words(i).length)) -
        Math.max(...a.intents.map((i) => words(i).length)),
    )[0];
  // Similarity narrows documented purposes, but still needs a compatible action
  // and object. It cannot invent an effect or unsupported workflow.
  const action =
    /\b(deploy|publish|host|launch|ship|create|make|start|set up|add|file|report|cancel|end|stop|unsubscribe|change|switch|set|upgrade|downgrade|configure)\b/i.test(
      sentence,
    );
  if (!action) return;
  const query = await index.vector(sentence, signal, false);
  const scores = await Promise.all(
    candidates.map(async (guide) => {
      const vector = await index.vector(guide.purpose, signal);
      return {
        guide,
        score: query.reduce((sum, v, i) => sum + v * vector[i], 0),
      };
    }),
  );
  scores.sort((a, b) => b.score - a.score);
  if (
    scores[0]?.score >= 0.67 &&
    (!scores[1] || scores[0].score - scores[1].score >= 0.08)
  )
    return scores[0].guide;
}
export function beginWorkflow(
  input: PlanInput,
  task: TaskIntent,
  guide: WorkflowGuide,
): WorkflowContext {
  const reviewOnly = task.exclusions.some((e) =>
    /deploy|publish|submit|confirm|cancel|save/i.test(e),
  );
  const locateOnly =
    /^(?:please\s+)?(?:where|find|locate|open|show me(?! how))/i.test(
      task.original,
    ) && !/\bhow\b/i.test(task.original);
  const entities = initialEntities(task, task.original, guide);
  for (const entity of input.workflow?.entities || []) {
    if (
      new RegExp(
        `\\b(?:that|this|same)\\s+(?:${entity.type}|${entity.type === "repository" ? "repo" : entity.type === "issue" ? "ticket" : "object"})\\b`,
        "i",
      ).test(positiveText(task.clause || task.original)) &&
      !entities.some((e) => e.type === entity.type)
    )
      entities.push({ ...entity, source: "request" });
  }
  return {
    id: crypto.randomUUID(),
    requestTaskId: task.id,
    guideId: guide.id,
    guideVersion: guide.version,
    original: task.original,
    objective: guide.purpose,
    outcome: reviewOnly ? "review" : locateOnly ? "locate" : "result",
    revision: 0,
    entities,
    exclusions: task.exclusions,
    activeMilestone: 0,
    verified: [],
    status: "active",
    reason: "Finding the next documented milestone in the current interface.",
  };
}
function allowed(w: WorkflowContext, c: PageControl) {
  return (
    c.visible &&
    c.enabled &&
    !c.occluded &&
    !w.exclusions.some((e) =>
      words(e).some((word) =>
        words(c.label + " " + (c.description || "")).includes(word),
      ),
    )
  );
}
function candidateScore(control: PageControl, target: string) {
  if (exact(control.label, target)) return 1;
  const label = control.label.replace(/^\d+(?:\.\d+)*\s*/, "");
  if (exact(label, target)) return 1;
  if (matches(label, target)) return 0.92;
  if (matches(control.context + " " + label, target)) return 0.7;
  return 0;
}
function subjectMatches(w: WorkflowContext, signal: OutcomeEvidence) {
  const subjectType =
    w.guideId === "github.repository.create"
      ? "repository"
      : w.guideId.includes("branch")
        ? "branch"
        : w.guideId.includes("work-item")
          ? "issue"
          : w.guideId.includes("plan")
            ? "plan"
            : w.guideId.includes("pages")
              ? "project"
              : undefined;
  const subject = entityValue(w, subjectType);
  if (subject) {
    const owner =
      w.guideId === "github.repository.create"
        ? entityValue(w, "account")
        : undefined;
    return (
      matches(signal.subject + " " + signal.text, subject) &&
      (!owner || matches(signal.subject + " " + signal.text, owner))
    );
  }
  // Without an object name, the signal must identify the actual workflow.
  if (w.guideId === "amazon.prime.cancel")
    return (
      /\bprime\b/i.test(signal.subject + " " + signal.text) ||
      (/^(membership|subscription)$/i.test(signal.subject.trim()) &&
        /^(?:your )?membership (?:was |is |has been )?(?:cancelled|canceled|ends|will end)/i.test(
          signal.text.trim(),
        ) &&
        w.verified.some(
          (v) => /\bprime\b/i.test(v.evidence.text) && v.milestone !== "result",
        ))
    );
  return w.guideId.includes("membership") || w.guideId.includes("prime")
    ? /membership|subscription|prime/i.test(signal.subject + " " + signal.text)
    : false;
}
const contextText = (c: PageControl) =>
  [
    c.label,
    c.context,
    c.description,
    ...(c.structure?.headings.map((h) => h.label) || []),
    ...(c.structure?.regions.map((r) => r.name) || []),
  ].join(" ");
const inMilestoneContext = (
  c: PageControl,
  m: WorkflowGuide["milestones"][number],
) => !m.context || m.context.some((ctx) => matches(contextText(c), ctx));
function scopeLive(
  w: WorkflowContext,
  page: PageSnapshot,
  type: string,
  value: string,
) {
  const entity = w.entities.find((e) => e.type === type);
  const aliases =
    type === "repository"
      ? ["repository", "repositories", "repo"]
      : type === "project"
        ? ["project", "space"]
        : ["account", "organization"];
  const fields = page.controls.filter(
    (c) =>
      c.visible &&
      c.kind === "select" &&
      aliases.some((a) => exact(c.label, a)) &&
      c.options?.some((o) => o.selected),
  );
  if (fields.length)
    return fields.some((c) =>
      c.options!.some((o) => o.selected && matches(o.label, value)),
    );
  if (
    entity?.binding &&
    entity.binding.origin === page.origin &&
    (page.path === entity.binding.path ||
      page.path.startsWith(entity.binding.path + "/"))
  )
    return true;
  if (type === "repository" && matches(page.path, value)) return true;
  return (
    page.controls.some(
      (c) =>
        c.visible &&
        (c.selected || c.kind === "section" || c.kind === "expand") &&
        matches(contextText(c), value) &&
        aliases.some((a) => matches(contextText(c), a)),
    ) ||
    !!page.signals?.some(
      (s) =>
        aliases.some((a) => matches(s.subject, a)) && matches(s.text, value),
    )
  );
}
export function verifyWorkflowOutcome(
  w: WorkflowContext,
  page: PageSnapshot,
  guide: WorkflowGuide,
): OutcomeEvidence | undefined {
  if (
    !w.pendingAction?.acted ||
    page.busy ||
    page.fingerprint === w.pendingAction.beforeFingerprint
  )
    return;
  if (
    guide.milestones.some((m) => m.kind === "review") &&
    !w.pendingAction.final
  )
    return;
  const review = guide.milestones.find((m) => m.kind === "review");
  if (
    review &&
    page.controls.some(
      (c) =>
        c.visible &&
        c.enabled &&
        norm(c.label) !== norm(w.pendingAction!.label) &&
        review.targets.some((t) => candidateScore(c, t) >= 0.9),
    )
  )
    return;
  const result = guide.milestones.find((m) => m.kind === "result");
  if (!result) return;
  const preference = ["language", "speed"].find((type) => entityValue(w, type));
  if (preference) {
    const value = entityValue(w, preference)!;
    const c = page.controls.find(
      (c) =>
        c.visible &&
        c.signature === w.pendingAction!.signature &&
        ((c.checked &&
          (exact(c.label, value) ||
            matches(c.label + " " + c.context, value))) ||
          (c.selected &&
            (exact(c.label, value) ||
              matches(c.label + " " + c.context, value))) ||
          c.options?.some((o) => o.selected && exact(o.label, value)) ||
          (preference === "speed" &&
            c.range?.current === Number.parseFloat(value))),
    );
    if (c)
      return {
        kind: "state",
        subject: preference,
        text: c.label,
        revision: page.revision,
      };
  }
  return page.signals?.find(
    (s) =>
      s.kind !== "failure" &&
      !/\b(?:not|never|cannot|could not|unable to|pending|processing|in progress)\b/i.test(
        s.text,
      ) &&
      (s.frameId || 0) === (w.pendingAction!.frameId || 0) &&
      !w.pendingAction!.beforeSignals?.includes(signalIdentity(s)) &&
      subjectMatches(w, s) &&
      (w.guideId.includes("work-item")
        ? s.kind === "created-item" || /\bcreated\b/i.test(s.text)
        : result.outcome?.some((pattern) =>
            matches(s.subject + " " + s.text, pattern),
          )),
  );
}
export function recordWorkflowAction(
  w: WorkflowContext,
  control: PageControl,
  verified = false,
  page?: PageSnapshot,
): WorkflowContext {
  if (!w.pendingAction || w.pendingAction.signature !== control.signature)
    return w;
  const next = structuredClone(w);
  next.pendingAction!.acted = true;
  next.pendingAction!.startedAt = Date.now();
  next.waitExpired = false;
  next.revision++;
  if (next.pendingAction!.milestone.startsWith("route:")) {
    if (verified) {
      next.verified = next.verified.slice(-63);
      next.verified.push({
        milestone: next.pendingAction!.milestone,
        revision: page?.revision || next.pendingAction!.beforeRevision,
        evidence: {
          kind: "arrival",
          subject: control.context,
          text: control.label,
          revision: page?.revision || next.pendingAction!.beforeRevision,
        },
      });
      next.pendingAction = undefined;
      next.status = "active";
    } else next.status = "waiting";
    return next;
  }
  if (next.pendingAction!.milestone.startsWith("entity:")) {
    const type = next.pendingAction!.milestone.slice(7),
      entity = next.entities.find((e) => e.type === type);
    if (
      verified &&
      entity &&
      matches(control.label, entity.value) &&
      control.destination
    )
      entity.binding = {
        origin: control.destination.origin,
        path: control.destination.path,
        frameId: control.reference?.frameId || 0,
      };
    if (!verified) {
      next.status = "waiting";
      return next;
    }
    next.pendingAction = undefined;
    next.status = "active";
    return next;
  }
  if (next.pendingAction!.milestone.startsWith("handoff:")) {
    if (verified) {
      next.pendingAction = undefined;
      next.status = "active";
    } else next.status = "verifying";
    return next;
  }
  if (verified && control.kind !== "focus") {
    const guide = workflowGuides.find((g) => g.id === next.guideId),
      milestone = guide?.milestones[next.activeMilestone];
    // Arriving at another screen after a review click is not the requested
    // outcome. Keep review active so retention/confirmation branches can bind.
    if (milestone?.kind === "review") {
      next.status = "verifying";
      return next;
    }
    const value = entityValue(next, milestone?.entity),
      fresh = page?.controls.find((c) => c.signature === control.signature);
    if (
      value &&
      milestone?.entity &&
      ["choose", "navigate"].includes(milestone.kind) &&
      !matches(control.label, value) &&
      !fresh?.options?.some((o) => o.selected && exact(o.label, value)) &&
      !(
        milestone.entity === "speed" &&
        fresh?.range?.current === Number.parseFloat(value)
      )
    ) {
      next.pendingAction = undefined;
      next.status = "active";
      return next;
    }
    next.verified = next.verified.slice(-63);
    next.verified.push({
      milestone: next.pendingAction!.milestone,
      revision: next.pendingAction!.beforeRevision,
      evidence: {
        kind: "state",
        subject: control.context,
        text: control.label,
        revision: next.pendingAction!.beforeRevision,
      },
    });
    next.activeMilestone++;
    if (guide?.milestones[next.activeMilestone]?.kind === "result")
      next.status = "verifying";
    else {
      next.pendingAction = undefined;
      next.status = "active";
    }
  } else next.status = w.status === "review" ? "verifying" : "waiting";
  return next;
}
export function continueWorkflow(
  w: WorkflowContext,
  guide: WorkflowGuide,
): WorkflowContext {
  const next = structuredClone(w);
  next.revision++;
  if (guide.milestones[next.activeMilestone]?.kind === "input") {
    // A manual handoff advances guidance, not verified input or task completion.
    next.activeMilestone++;
    next.pendingAction = undefined;
    next.status = "active";
  } else if (next.pendingAction) {
    next.pendingAction.acted = true;
    next.pendingAction.startedAt = Date.now();
    next.waitExpired = false;
    next.status = "verifying";
  } else next.status = "active";
  return next;
}
export async function planWorkflow(
  input: PlanInput,
  request: NavigationRequest,
  task: TaskIntent,
  index: SemanticIndex,
  signal?: AbortSignal,
  memory?: SiteMemory,
): Promise<
  | Omit<PlanResult, "requestId" | "documentId" | "revision" | "activity">
  | undefined
> {
  const existing = input.workflow;
  const sameTask = existing?.requestTaskId === task.id;
  const selected = sameTask
    ? workflowGuides.find((g) => g.id === existing!.guideId)
    : await selectGuide(input, task, index, signal);
  const correction =
    !!existing &&
    !sameTask &&
    /^(?:actually|instead|no[, ]|use .* instead)/i.test(task.original) &&
    task.operation !== "search" &&
    (selected?.id === existing.guideId ||
      (!selected &&
        /^(?:actually[, ]*|instead[, ]*|no[, ]*)?(?:use|choose|select)\b/i.test(
          task.original,
        )));
  const guide = correction
    ? workflowGuides.find((g) => g.id === existing!.guideId)
    : selected;
  if (!guide) return;
  let w =
    existing && existing.requestTaskId === task.id
      ? structuredClone(existing)
      : beginWorkflow(input, task, guide);
  if (correction && existing) {
    const changes = initialEntities(task, task.original, guide);
    w = {
      ...structuredClone(existing),
      requestTaskId: task.id,
      original: task.original,
      pendingAction: undefined,
      status: "active",
      revision: existing.revision + 1,
    };
    for (const entity of changes) {
      w.entities = w.entities.filter((e) => e.type !== entity.type);
      w.entities.push(entity);
      const stage = guide.milestones.findIndex((m) => m.entity === entity.type);
      if (stage >= 0) w.activeMilestone = Math.min(w.activeMilestone, stage);
    }
    w.verified = w.verified.filter(
      (v) =>
        guide.milestones.findIndex((m) => m.id === v.milestone) <
        w.activeMilestone,
    );
  }
  if (w.guideVersion !== guide.version) {
    w.guideVersion = guide.version;
    w.pendingAction = undefined;
    w.activeMilestone = 0;
    w.verified = [];
    w.status = "active";
    w.revision++;
  }
  if (input.choice?.startsWith("workflow:")) {
    const [, type, value] = input.choice.split(":");
    if (
      type === "method" &&
      ["git", "upload"].includes(value) &&
      guide.platform === "cloudflare"
    ) {
      w.entities = w.entities.filter((e) => e.type !== "method");
      w.entities.push({ type: "method", value, source: "clarification" });
      w.status = "active";
      w.revision++;
      request.status = "active";
      task.status = "active";
    }
  }
  const emit = (
    plan: GoalPlan,
    status: PlanResult["status"] = "plan",
    clarification?: PlanResult["clarification"],
  ) => ({
    status,
    request,
    plan,
    workflow: w,
    contextRevision: input.contextRevision || 0,
    canonicalGoal: task.target,
    reason: plan.reason,
    clarification,
  });
  const base: GoalPlan = {
    goal: task.original,
    status: "awaiting-choice",
    source: "semantics",
    confidence: 0,
    reason: w.reason,
    steps: [],
  };
  if (guide.platform === "amazon") {
    const accepted = new Set(
      words(
        [
          ...guide.intents,
          ...(guide.subjects || []),
          guide.platform,
          "account",
        ].join(" "),
      ),
    );
    const unknown = words(task.target).filter(
      (word) =>
        !accepted.has(word) &&
        !["please", "only", "current", "my", "the"].includes(word),
    );
    if (unknown.length)
      return {
        status: "unsupported",
        request,
        reason:
          "The named subscription is outside this guide; no Prime route is assumed.",
        plan: {
          ...base,
          status: "unresolved",
          reason:
            "The named subscription is outside this guide; no Prime route is assumed.",
          issue: "no-match",
        },
      };
    if (
      !/\bprime\b/i.test(positiveText(task.original)) &&
      !task.contextTarget &&
      !w.verified.length &&
      !["credentials", "two-factor"].includes(
        input.observation.screen?.kind || "",
      )
    ) {
      if (
        input.choice === "workflow:subscription:prime" ||
        input.observation.controls.some(
          (c) => c.visible && /\bprime\b/i.test(contextText(c)),
        )
      ) {
        task.contextTarget = "Prime membership";
        request.status = "active";
        w.status = "active";
      } else if (input.choice === "workflow:subscription:other") {
        w.status = "waiting";
        return emit(
          {
            ...base,
            reason:
              "Include the subscription’s name in your destination so I can find its own controls. I won’t use the Prime cancellation route.",
          },
          "unsupported",
        );
      } else {
        request.status = "clarification";
        w.status = "clarification";
        return emit(
          { ...base, reason: "Which subscription would you like to cancel?" },
          "clarification",
          {
            question: "Which subscription would you like to cancel?",
            choices: [
              {
                id: "workflow:subscription:prime",
                signature: "workflow:subscription:prime",
                target: "Prime membership",
                label: "Amazon Prime membership",
              },
              {
                id: "workflow:subscription:other",
                signature: "workflow:subscription:other",
                target: "Another subscription",
                label: "Another subscription",
              },
            ],
          },
        );
      }
    }
    const unavailable = input.observation.signals?.find(
      (s) =>
        subjectMatches(w, s) &&
        /\b(?:not (?:an? )?(?:active )?prime member|no (?:active )?(?:prime )?membership|(?:do not|don't) have (?:an? )?(?:active )?prime membership|(?:prime )?membership (?:is )?(?:unavailable|inactive))\b/i.test(
          s.text,
        ) &&
        !/\b(?:if|when|unless|would|could)\b/i.test(s.text),
    );
    if (
      unavailable &&
      !input.observation.busy &&
      !w.pendingAction &&
      !["credentials", "two-factor"].includes(
        input.observation.screen?.kind || "",
      )
    ) {
      w.status = "waiting";
      w.reason =
        "Amazon reports no active Prime membership. Your cancellation task remains unverified.";
      return emit({
        ...base,
        confidence: 1,
        recoveryStage: "waiting",
        reason: w.reason,
      });
    }
    const state = input.observation.signals?.find(
      (s) =>
        s.kind !== "failure" &&
        subjectMatches(w, s) &&
        /(?:membership (?:has |was |is )?cancel[le]+d|membership (?:has ended|will end|ends)|cancellation confirmed)/i.test(
          s.text,
        ) &&
        !/\b(?:not|unable|cannot|failed|pending|if|when|unless|would|could)\b/i.test(
          s.text,
        ),
    );
    if (
      state &&
      !task.desiredValue &&
      !task.qualifiers.length &&
      !w.pendingAction &&
      !input.observation.busy &&
      !["credentials", "two-factor"].includes(
        input.observation.screen?.kind || "",
      )
    ) {
      w.status = "completed";
      w.verified.push({
        milestone: "result",
        revision: input.revision,
        evidence: state,
      });
      return emit({
        ...base,
        status: "completed",
        confidence: 1,
        reason:
          "The current Prime membership status already confirms cancellation.",
      });
    }
  }
  const authentication = input.observation.controls.find(
    (c) => c.visible && c.enabled && c.form?.authentication,
  );
  const permission = input.observation.controls.filter(
    (c) =>
      c.visible &&
      c.enabled &&
      c.risk === "consequential" &&
      /authorize|approve access|allow access/i.test(c.label) &&
      matches(c.label + " " + c.context, guide.platform),
  );
  const authSubmit =
    authentication &&
    input.observation.controls.find(
      (c) =>
        c.visible &&
        c.enabled &&
        c.form?.key === authentication.form!.key &&
        c.risk === "consequential",
    );
  const handoff = authSubmit || (permission.length === 1 && permission[0]);
  const authScreen = ["credentials", "two-factor"].includes(
    input.observation.screen?.kind || "",
  );
  if (authScreen && !handoff) {
    w.status = "waiting";
    w.waitExpired = false;
    w.reason =
      input.observation.screen?.kind === "two-factor"
        ? "Complete verification on the website. I’ll continue your task afterward."
        : "Sign in on the website. I’ll continue your task afterward.";
    return emit({ ...base, reason: w.reason });
  }
  if (handoff) {
    const prior = w.pendingAction;
    w.status =
      prior?.signature === handoff.signature && prior.acted
        ? "verifying"
        : "review";
    w.pendingAction = {
      milestone: authentication
        ? "handoff:authentication"
        : "handoff:permission",
      controlId: handoff.id,
      signature: handoff.signature,
      label: handoff.label,
      beforeRevision: input.revision,
      beforeFingerprint: input.observation.fingerprint,
      acted: (prior?.signature === handoff.signature && prior.acted) || false,
      startedAt:
        prior?.signature === handoff.signature ? prior.startedAt : Date.now(),
      beforeControls: input.observation.controls
        .filter((c) => c.visible)
        .map((c) => c.signature),
      beforeSignals: input.observation.signals?.map(signalIdentity),
      beforeDocumentId: handoff.reference?.documentId || input.documentId,
    };
    w.reason = authentication
      ? input.observation.screen?.kind === "two-factor"
        ? "Complete verification on the website. I’ll continue your task afterward."
        : "Sign in on the website. I’ll continue your task afterward."
      : "Review this provider's access request on the website. Your original task will continue after the handoff.";
    return emit({ ...base, reason: w.reason });
  }
  if (
    w.pendingAction?.milestone.startsWith("handoff:") &&
    !authentication &&
    !authScreen
  ) {
    w.pendingAction = undefined;
    w.status = "active";
    w.revision++;
  }
  if (w.status === "waiting" && !w.pendingAction && !authScreen)
    w.status = "active";
  for (const type of guide.scopeEntities || []) {
    const value = entityValue(w, type);
    if (!value) continue;
    if (scopeLive(w, input.observation, type, value)) {
      const current = guide.milestones[w.activeMilestone];
      if (current?.entity === type && current.kind === "navigate") {
        w.verified = w.verified.slice(-63);
        w.verified.push({
          milestone: current.id,
          revision: input.revision,
          evidence: {
            kind: "state",
            subject: type,
            text: value,
            revision: input.revision,
          },
        });
        w.activeMilestone++;
        w.revision++;
        w.pendingAction = undefined;
      }
      continue;
    }
    const aliases =
      type === "repository"
        ? ["Repositories", "Repository"]
        : type === "project"
          ? ["Projects", "Spaces", "Project"]
          : ["Account", "Accounts", "Switch account"];
    const candidates = input.observation.controls
      .filter(
        (c) =>
          allowed(w, c) &&
          c.risk === "ordinary" &&
          ["navigation", "expand", "focus", "select", "choice"].includes(
            c.kind,
          ),
      )
      .map((c) => ({
        control: c,
        score: Math.max(
          candidateScore(c, value),
          ...aliases.map((a) => candidateScore(c, a)),
        ),
      }))
      .filter((c) => c.score >= 0.9)
      .sort((a, b) => b.score - a.score);
    const found = candidates[0];
    if (!found) {
      w.reason = `The requested ${type} is not established in the current context. Open it or use the website's search; your named destination is retained.`;
      return emit(
        { ...base, reason: w.reason, issue: "no-match" },
        "unsupported",
      );
    }
    w.status = "active";
    w.pendingAction = {
      milestone: "entity:" + type,
      signature: found.control.signature,
      controlId: found.control.id,
      label: found.control.label,
      beforeRevision: input.revision,
      beforeFingerprint: input.observation.fingerprint,
      acted: false,
      startedAt: Date.now(),
      frameId: found.control.reference?.frameId || 0,
      final: false,
    };
    return emit({
      ...base,
      status: "guiding",
      confidence: found.score,
      reason: `Open or choose the requested ${type}: “${value}”.`,
      steps: [
        {
          controlId: found.control.id,
          label: found.control.label,
          outcome: "The requested object's namespace is checked again.",
        },
      ],
    });
  }
  if (guide.platform === "cloudflare" && !entityValue(w, "method")) {
    w.status = "clarification";
    request.status = "clarification";
    return emit(
      {
        ...base,
        reason: "Do you have a Git repository or prebuilt website files?",
      },
      "clarification",
      {
        question: "How will you provide your Pages website?",
        choices: [
          {
            id: "workflow:method:git",
            signature: "workflow:method:git",
            target: "Git integration",
            label: "Connect a Git repository",
          },
          {
            id: "workflow:method:upload",
            signature: "workflow:method:upload",
            target: "Direct Upload",
            label: "Upload prebuilt files",
          },
        ],
      },
    );
  }
  if (["verifying", "waiting"].includes(w.status) && w.pendingAction?.acted) {
    const failure = input.observation.signals?.find(
      (s) =>
        s.kind === "failure" &&
        !w.pendingAction!.beforeSignals?.includes(signalIdentity(s)) &&
        subjectMatches(w, s),
    );
    if (failure) {
      w.status = "failed";
      w.reason =
        "The website reported a problem with the requested operation. Review the error and retry.";
      return emit({ ...base, reason: w.reason }, "unsupported");
    }
    const evidence = verifyWorkflowOutcome(w, input.observation, guide);
    if (evidence) {
      w.status = "completed";
      w.verified.push({
        milestone: "result",
        revision: input.revision,
        evidence,
      });
      w.revision++;
      return emit({
        ...base,
        status: "completed",
        confidence: 1,
        reason: "The requested outcome was verified on the website.",
      });
    }
    const current = guide.milestones[w.activeMilestone];
    const nextMilestone = guide.milestones
      .slice(w.activeMilestone + 1)
      .find((m) => !m.branch || m.branch === entityValue(w, "method"));
    if (
      current?.kind !== "review" &&
      current?.kind !== "input" &&
      !current?.entity &&
      nextMilestone &&
      input.observation.fingerprint !== w.pendingAction.beforeFingerprint
    ) {
      const arrival = input.observation.controls.find(
        (c) =>
          allowed(w, c) &&
          inMilestoneContext(c, nextMilestone) &&
          (c.reference?.frameId || 0) === (w.pendingAction!.frameId || 0) &&
          ((c.reference?.documentId || input.documentId) !==
            w.pendingAction!.beforeDocumentId ||
            !w.pendingAction!.beforeControls?.includes(c.signature)) &&
          nextMilestone.targets.some((t) => exact(c.label, t)),
      );
      if (arrival) {
        w.verified = w.verified.slice(-63);
        w.verified.push({
          milestone: current.id,
          revision: input.revision,
          evidence: {
            kind: "arrival",
            subject: arrival.context,
            text: arrival.label,
            revision: input.revision,
          },
        });
        w.activeMilestone = guide.milestones.indexOf(nextMilestone);
        w.pendingAction = undefined;
        w.status = "active";
        w.revision++;
      }
    }
    if (
      w.pendingAction &&
      guide.milestones[w.activeMilestone]?.kind === "review"
    ) {
      const furtherReview = guide.milestones[w.activeMilestone].targets.filter(
        (t) => !exact(t, w.pendingAction!.label),
      );
      const c = input.observation.controls.find(
        (c) =>
          allowed(w, c) &&
          norm(c.label) !== norm(w.pendingAction!.label) &&
          furtherReview.some((t) => candidateScore(c, t) >= 0.9) &&
          input.observation.fingerprint !== w.pendingAction!.beforeFingerprint,
      );
      if (c) {
        w.pendingAction = undefined;
        w.status = "active";
      } else {
        w.reason = input.observation.busy
          ? "The website is processing your action. Your task and context are retained."
          : "Waiting for evidence of the requested outcome. A click alone is not success.";
        return emit({ ...base, reason: w.reason });
      }
    }
  }
  const method = entityValue(w, "method");
  if (
    w.activeMilestone >= guide.milestones.length &&
    w.verified.length &&
    !guide.milestones.some((m) => m.kind === "result")
  ) {
    w.status = "completed";
    return emit({
      ...base,
      status: "completed",
      confidence: 1,
      reason: "The requested navigation destination was verified.",
    });
  }
  if (!w.pendingAction && !w.verified.length) {
    for (let i = guide.milestones.length - 1; i > w.activeMilestone; i--) {
      const m = guide.milestones[i];
      if (m.kind === "result" || (m.branch && m.branch !== method)) continue;
      const anchor = input.observation.controls.find(
        (c) =>
          allowed(w, c) &&
          inMilestoneContext(c, m) &&
          m.targets.some((t) => exact(c.label, t)) &&
          (matches(c.context + " " + c.label, m.purpose) ||
            c.selected ||
            (m.kind === "review" &&
              c.risk === "consequential" &&
              !guide.milestones
                .slice(0, i)
                .some((prior) =>
                  prior.targets.some((t) => exact(t, c.label)),
                ))),
      );
      if (anchor) {
        w.activeMilestone = i;
        w.revision++;
        break;
      }
    }
  }
  while (
    guide.milestones[w.activeMilestone]?.branch &&
    guide.milestones[w.activeMilestone].branch !== method
  )
    w.activeMilestone++;
  const milestone = guide.milestones[w.activeMilestone];
  if (!milestone || milestone.kind === "result") {
    w.reason =
      "The final outcome has not been verified. Review the current website state.";
    return emit({ ...base, reason: w.reason });
  }
  const value = entityValue(w, milestone.entity);
  const targets =
    value && milestone.kind !== "input"
      ? [value, ...milestone.targets]
      : milestone.targets;
  const usable = (c: PageControl) =>
    allowed(w, c) &&
    (milestone.kind !== "navigate" ||
      w.outcome !== "result" ||
      c.kind !== "section") &&
    (!milestone.context ||
      milestone.context.some((ctx) => matches(contextText(c), ctx))) &&
    (milestone.kind !== "choose" ||
      ["choice", "select", "toggle", "range", "expand", "focus"].includes(
        c.kind,
      ) ||
      ["repository", "project"].includes(milestone.entity || "")) &&
    (milestone.kind !== "reveal" || c.kind !== "section") &&
    !(
      milestone.entity === "speed" &&
      value &&
      c.range &&
      (Number.parseFloat(value) < c.range.min ||
        Number.parseFloat(value) > c.range.max)
    );
  const candidates = input.observation.controls
    .filter(usable)
    .map((control) => ({
      control,
      score: Math.max(...targets.map((t) => candidateScore(control, t))),
    }))
    .filter((c) => c.score >= 0.9)
    .sort(
      (a, b) =>
        b.score - a.score ||
        Number(b.control.inViewport) - Number(a.control.inViewport),
    );
  if (!candidates.length) {
    const ranked = await index.rank(
      input.observation,
      { ...task, target: targets[0], qualifiers: [], exclusions: w.exclusions },
      signal,
      { lexicalFirst: true },
    );
    const eligible = ranked.filter((c) => c.eligible && usable(c.control));
    if (
      eligible[0]?.semantic >= 0.68 &&
      eligible[0].score >= 0.64 &&
      (!eligible[1] || eligible[0].score - eligible[1].score >= 0.08)
    )
      candidates.push({
        control: eligible[0].control,
        score: eligible[0].score,
      });
  }
  const first = candidates[0];
  if (!first) {
    if (memory?.origin === input.observation.origin) {
      const known = planTask(
        input.observation,
        beginJourney(
          value || targets[0],
          input.observation.origin,
          input.strategy,
        ),
        memory,
      );
      const control = input.observation.controls.find(
        (c) => c.id === known.steps[0]?.controlId,
      );
      if (
        known.source === "memory" &&
        known.status === "guiding" &&
        control &&
        allowed(w, control) &&
        control.risk === "ordinary"
      ) {
        w.pendingAction = {
          milestone: "route:" + milestone.id,
          signature: control.signature,
          controlId: control.id,
          label: control.label,
          beforeRevision: input.revision,
          beforeFingerprint: input.observation.fingerprint,
          acted: false,
          startedAt: Date.now(),
          beforeDocumentId: input.documentId,
          frameId: control.reference?.frameId || 0,
          final: false,
        };
        w.status = "active";
        return emit({ ...known, goal: task.original });
      }
    }
    // A user may start inside a workflow. Skip only to a later *observed*
    // interface milestone, never an unseen documented step or result.
    for (let i = w.activeMilestone + 1; i < guide.milestones.length; i++) {
      const m = guide.milestones[i];
      if (
        m.kind === "result" ||
        m.kind === "review" ||
        (m.branch && m.branch !== method)
      )
        continue;
      const observedTargets = [
        ...(entityValue(w, m.entity) ? [entityValue(w, m.entity)!] : []),
        ...m.targets,
      ];
      if (
        input.observation.controls.some(
          (c) =>
            allowed(w, c) &&
            inMilestoneContext(c, m) &&
            observedTargets.some((t) => exact(c.label, t)),
        )
      ) {
        w.activeMilestone = i;
        w.revision++;
        return planWorkflow(
          { ...input, workflow: w },
          request,
          task,
          index,
          signal,
          memory,
        );
      }
    }
    const exploration = input.observation.controls.find(
      (c) =>
        allowed(w, c) &&
        c.risk === "ordinary" &&
        c.kind === "expand" &&
        !c.expanded &&
        /menu|navigation|create|applications|projects|account/i.test(c.label) &&
        !w.verified.some((v) => v.milestone === "route:explore:" + c.signature),
    );
    if (exploration) {
      w.pendingAction = {
        milestone: "route:explore:" + exploration.signature,
        signature: exploration.signature,
        controlId: exploration.id,
        label: exploration.label,
        beforeRevision: input.revision,
        beforeFingerprint: input.observation.fingerprint,
        beforeDocumentId: input.documentId,
        startedAt: Date.now(),
        acted: false,
        final: false,
      };
      return emit({
        ...base,
        status: "guiding",
        exploration: true,
        confidence: 0.6,
        action: {
          kind: "control",
          controlId: exploration.id,
          signature: exploration.signature,
        },
        reason:
          "Explore this observed navigation menu. Your destination is retained; this is not a complete route.",
        steps: [
          {
            controlId: exploration.id,
            label: exploration.label,
            outcome: "The menu becomes visible.",
          },
        ],
      });
    }
    w.reason =
      "Still finding the next step. The required milestone is not visible in the scanned interface; your destination and verified progress are retained.";
    return emit({ ...base, reason: w.reason, issue: "no-match" }, "plan");
  }
  const distinct = candidates.filter(
    (c, i, all) =>
      all.findIndex((x) => x.control.signature === c.control.signature) === i,
  );
  if (distinct[1] && first.score === distinct[1].score && !input.choice) {
    w.status = "clarification";
    request.status = "clarification";
    return emit(
      { ...base, reason: "Several live controls fit this milestone." },
      "clarification",
      {
        question: "Which control belongs to your task?",
        choices: distinct.slice(0, 3).map(({ control: c }) => ({
          id: c.signature,
          signature: c.signature,
          target: c.label,
          label: sanitizeText(c.label + " · " + c.context),
        })),
      },
    );
  }
  const chosen = input.choice
    ? candidates.find((c) => c.control.signature === input.choice)?.control ||
      first.control
    : first.control;
  if (
    input.choice &&
    candidates.some((c) => c.control.signature === input.choice)
  ) {
    request.status = "active";
    task.status = "active";
  }
  const desiredMissing =
    milestone.entity && ["choose", "input"].includes(milestone.kind) && !value;
  if (desiredMissing && milestone.kind === "choose") {
    w.reason = `Which ${milestone.entity} do you want? Include its name in your request or choose it on the website.`;
    return emit({ ...base, reason: w.reason }, "unsupported");
  }
  w.status =
    milestone.kind === "review" ||
    chosen.risk !== "ordinary" ||
    chosen.kind === "action"
      ? "review"
      : milestone.kind === "input"
        ? "waiting"
        : "active";
  w.reason = milestone.instruction;
  const prior = w.pendingAction;
  w.pendingAction = {
    milestone: milestone.id,
    signature: chosen.signature,
    controlId: chosen.id,
    label: chosen.label,
    beforeRevision: input.revision,
    beforeFingerprint: input.observation.fingerprint,
    acted: prior?.signature === chosen.signature ? prior.acted : false,
    startedAt:
      prior?.signature === chosen.signature ? prior.startedAt : Date.now(),
    beforeControls: input.observation.controls
      .filter((c) => c.visible)
      .map((c) => c.signature),
    beforeSignals: input.observation.signals?.map(signalIdentity),
    beforeDocumentId: chosen.reference?.documentId || input.documentId,
    frameId: chosen.reference?.frameId || 0,
    final: milestone.kind === "review",
  };
  if (w.outcome === "review" && w.status === "review") {
    // Reaching review fulfils only an explicit navigation/review destination.
    w.reason =
      "The requested review control is available. No change has been submitted.";
  }
  const predictions = guide.milestones
    .slice(w.activeMilestone + 1)
    .filter((m) => !m.branch || m.branch === method)
    .slice(0, 12)
    .map((m) => ({ label: m.purpose, evidence: "documented" as const }));
  return emit({
    ...base,
    status: w.status === "review" ? "awaiting-choice" : "guiding",
    confidence: first.score,
    reason:
      w.status === "review"
        ? "Review this action on the website. You make the click; Navigator will verify the result afterward."
        : w.reason,
    steps:
      w.status === "review"
        ? []
        : [
            {
              controlId: chosen.id,
              label: chosen.label,
              outcome:
                milestone.kind === "input"
                  ? "Manual input is required; field focus does not complete this task."
                  : milestone.purpose,
            },
          ],
    route: {
      strategy: input.strategy,
      clicks: 1 + predictions.length,
      minSeconds: 5,
      maxSeconds: (1 + predictions.length) * 15,
      complete: false,
      basis: "estimated",
      predictions,
    },
  });
}
