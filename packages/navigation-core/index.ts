import { returnPlan } from "./continuity";
import { semanticVisual, needsVision } from "../vision/fusion";
import { workflowGuides } from "./guides";
export * from "./contracts";
export * from "./queue";
export * from "./storage";
export * from "./workflow-contracts";
export * from "./guides";
import {
  planInputSchema,
  resultSchema,
  type PlanInput,
  type PlanResult,
} from "./contracts";
import { interpretRequest, canonicalGoal } from "../nlp/interpret";
import { SemanticIndex, MODEL_REVISION, words } from "../nlp";
import { beginJourney, planTask } from "../goal-planner/task-journey";
import { planGoal } from "../goal-planner";
import type { SiteMemory } from "../page-model";
import { sanitizeText } from "../privacy-redaction";
import { shortestRoute } from "../goal-planner/route-graph";
import { hasCommitLanguage } from "../safety-policy/action-language";
import { authenticationIntent } from "../goal-planner/task-intent";
import { planWorkflow } from "./workflows";
import {
  compatibleSettingsScope,
  groundedSettingsTarget,
  exploreDestination,
  settingsDestination,
} from "./exploration";
export class NavigationCore {
  constructor(public index: SemanticIndex) {}
  async plan(
    raw: PlanInput,
    memory?: SiteMemory,
    signal?: AbortSignal,
  ): Promise<PlanResult> {
    signal?.throwIfAborted();
    const input = planInputSchema.parse(raw),
      { requestId, documentId, revision } = input;
    const activityBefore = { ...this.index.activity };
    const result = async (
      value: Omit<
        PlanResult,
        "requestId" | "documentId" | "revision" | "activity"
      >,
    ): Promise<PlanResult> => {
      const visual = input.visualObservation,
        task = value.request?.tasks[value.request.active];
      if (
        visual &&
        task &&
        input.journey &&
        needsVision(value.plan, !!value.clarification) &&
        value.workflow?.status !== "review" &&
        visual.requestId === requestId &&
        visual.journeyId === input.journey.id &&
        visual.contextRevision === (input.contextRevision || 0) &&
        visual.documentId === documentId &&
        visual.observationRevision === revision
      ) {
        const milestone =
          value.workflow &&
          workflowGuides.find((g) => g.id === value.workflow!.guideId)
            ?.milestones[value.workflow.activeMilestone];
        const target =
          milestone?.targets[0] ||
          [task.target, task.desiredValue].filter(Boolean).join(" ");
        const plan = await semanticVisual(
          this.index,
          input.observation,
          visual,
          target,
          input.text,
          task.exclusions,
          task.qualifiers,
          signal,
        );
        if (plan)
          value = { ...value, plan, reason: plan.reason, status: "plan" };
      }
      if (value.plan?.budgetPending && value.plan.status === "unresolved")
        value = { ...value, status: "pending-indexing" };
      if (
        !value.plan?.budgetPending &&
        value.plan?.issue === "no-match" &&
        ["unresolved", "awaiting-choice"].includes(value.plan.status) &&
        !value.plan.steps.length &&
        !value.clarification &&
        input.navigationLedger &&
        input.tabId !== undefined
      ) {
        const task = value.request?.tasks[value.request.active];
        const back = returnPlan(
          input.observation,
          input.text,
          input.navigationLedger,
          input.tabId,
          task?.exclusions,
        );
        if (back)
          value = { ...value, plan: back, reason: back.reason, status: "plan" };
      }
      return resultSchema.parse({
        ...value,
        requestId,
        documentId,
        revision,
        ...(input.protocolVersion === 2
          ? {
              protocolVersion: 2,
              contextRevision: input.contextRevision || 0,
              targetReference: value.workflow?.pendingAction
                ? input.observation.controls.find(
                    (c) => c.id === value.workflow!.pendingAction!.controlId,
                  )?.reference || {
                    tabId: input.tabId ?? -1,
                    frameId: input.frameId || 0,
                    documentId,
                    controlId: value.workflow.pendingAction.controlId,
                  }
                : undefined,
            }
          : {}),
        activity: {
          embedded: this.index.activity.embedded - activityBefore.embedded,
          cacheHits: this.index.activity.cacheHits - activityBefore.cacheHits,
          llmCalls: 0,
          modelRevision: MODEL_REVISION,
        },
      });
    };
    let request;
    try {
      request = input.request
        ? structuredClone(input.request)
        : interpretRequest(input.text, input.context, {
            clauses: input.protocolVersion === 2,
          });
    } catch (error) {
      return result({
        status: "unsupported",
        reason:
          error instanceof Error
            ? error.message
            : "Could not interpret the request.",
      });
    }
    if (!input.request) request.id = requestId;
    const task = request.tasks[request.active];
    if (!task)
      return result({
        status: "unsupported",
        request,
        reason: "All tasks have finished.",
      });
    if (task.needsReference)
      return result({
        status: "unsupported",
        request,
        reason: "What does “it” refer to? Name the control or setting.",
      });
    if (task.negatedOnly)
      return result({
        status: "unsupported",
        request,
        reason:
          "I retained your exclusion. Describe the action you would like to take.",
      });
    if (input.protocolVersion === 2) {
      const workflow = await planWorkflow(
        input,
        request,
        task,
        this.index,
        signal,
        memory,
      );
      if (workflow) return result(workflow);
      if (
        input.observation.screen?.kind === "two-factor" ||
        (input.observation.screen?.kind === "credentials" &&
          !authenticationIntent(input.text))
      )
        return result({
          status: "plan",
          request,
          reason:
            "Complete sign-in or verification on the website. Your destination is retained.",
          plan: {
            goal: input.text,
            status: "awaiting-choice",
            source: "semantics",
            confidence: 0,
            steps: [],
            reason:
              "Complete sign-in or verification on the website. Your destination is retained.",
          },
        });
    }
    // Revealing a picker does not imply that the user wants its search field.
    // Keep the verified menu handoff until a choice/value is supplied. Require
    // the same task and fresh expanded-state evidence; a closed/stale menu
    // must still be replanned rather than treated as an observed outcome.
    const revealed = input.journey?.progress.at(-1);
    const revealedOpener = input.observation.controls.find(
      (c) => c.signature === revealed?.signature,
    );
    const openPicker =
      ["reveal", "choose"].includes(task.operation) &&
      !task.desiredValue &&
      !input.choice &&
      input.journey?.requestTaskId === task.id &&
      revealed?.kind === "expand" &&
      input.observation.controls.find(
        (c) =>
          ((c.signature === revealed.signature && c.kind === "expand") ||
            // Large active dialogs can fill the bounded projection and omit
            // their opener. Preserve only a matching live expanded combobox;
            // its named dialog plus the verified same-task reveal is evidence
            // to wait for a choice, never to select or complete that choice.
            (input.observation.partial &&
              !revealedOpener &&
              c.kind === "focus" &&
              c.role === "combobox" &&
              c.visible &&
              !c.occluded &&
              c.structure?.regions.some(
                (region) =>
                  region.role === "dialog" &&
                  words(task.target).every((word) =>
                    words(region.name).includes(word),
                  ),
              ))) &&
          c.expanded === true &&
          c.enabled &&
          c.risk === "ordinary" &&
          revealed.origin === input.observation.origin &&
          (task.scope === "any" || !c.scope || task.scope === c.scope) &&
          !task.exclusions.some((exclusion) =>
            words(exclusion).some((word) =>
              words([c.label, c.description, c.context].join(" ")).includes(
                word,
              ),
            ),
          ) &&
          task.qualifiers.every((qualifier) =>
            words(qualifier).every((word) =>
              words([c.label, c.description, c.context].join(" ")).includes(
                word,
              ),
            ),
          ) &&
          words(task.target).length > 0 &&
          words(task.target).every((word) => words(c.label).includes(word)),
      );
    if (openPicker)
      return result({
        status: "plan",
        request,
        canonicalGoal: input.journey!.canonicalGoal || canonicalGoal(task),
        plan: {
          goal: task.original,
          source: "semantics",
          status:
            task.operation === "reveal" &&
            request.active < request.tasks.length - 1
              ? "completed"
              : "awaiting-choice",
          confidence: 1,
          steps: [],
          reason:
            task.operation === "reveal" &&
            request.active < request.tasks.length - 1
              ? "The requested menu opened and its current expanded state was verified."
              : "Menu opened. Choose an option on the website, or describe the option you want.",
        },
        reason: "The menu's current expanded state was verified.",
      });
    if (input.choice) {
      const choice = input.observation.controls.find(
        (c) => c.signature === input.choice,
      );
      if (!choice)
        return result({
          status: "unsupported",
          request,
          reason:
            "That choice changed. Please choose from the current controls.",
        });
      task.contextTarget ||= task.target;
      task.target = choice.label;
      task.boundSignature = choice.signature;
      request.status = "active";
    }
    // A declared, relevant menu can be explored without waiting to embed a
    // dense dashboard. Exact destinations, scope conflicts and known routes
    // still take priority over exploration.
    if (
      !input.choice &&
      !task.boundSignature &&
      !task.desiredValue &&
      !input.journey?.objective.workflow &&
      !input.journey?.workflow
    ) {
      const preliminary = planGoal(
        {
          ...input.observation,
          controls: input.observation.controls.filter((c) =>
            compatibleSettingsScope(task, c),
          ),
        },
        canonicalGoal(task),
        memory,
      );
      if (
        preliminary.status === "unresolved" &&
        preliminary.issue === "no-match" &&
        !input.observation.controls.some((c) => groundedSettingsTarget(task, c))
      ) {
        const exploration = exploreDestination(
          input.observation,
          task,
          input.journey,
        );
        if (exploration)
          return result({
            status: "plan",
            request,
            plan: exploration,
            canonicalGoal: canonicalGoal(task),
            reason: exploration.reason,
          });
      }
    }
    const candidates = await this.index.rank(input.observation, task, signal, {
      lexicalFirst:
        input.protocolVersion === 2 && input.observation.controls.length > 100,
    });
    if (
      ["locate", "choose"].includes(task.operation) &&
      hasCommitLanguage(task.target)
    ) {
      request.status = "blocked";
      task.status = "blocked";
      return result({
        status: "unsupported",
        request,
        reason:
          "Review this consequential action on the website. Reaching its control or heading cannot verify that it succeeded.",
        canonicalGoal: canonicalGoal(task),
        plan: {
          goal: task.original,
          source: "semantics",
          status: "unresolved",
          confidence: 0,
          issue: "consequential",
          steps: [],
          reason:
            "Review this consequential action on the website. Tholi stops before submission.",
        },
      });
    }
    const eligible = candidates.filter(
      (c) =>
        c.eligible &&
        c.control.enabled &&
        compatibleSettingsScope(task, c.control),
    );
    const workflowGoal = authenticationIntent(task.contextTarget || task.target)
      ? task.contextTarget || task.target
      : undefined;
    let goal = workflowGoal || settingsDestination(task) || canonicalGoal(task);
    if (goal.length > 1000)
      return result({
        status: "unsupported",
        request,
        reason:
          "That action description is too long. Shorten this task while keeping its requested value.",
      });
    const journey =
      (input.journey?.canonicalGoal || input.journey?.goal) === goal &&
      input.journey?.requestTaskId === task.id
        ? { ...input.journey, goal }
        : beginJourney(goal, input.observation.origin, input.strategy);
    let plan = planTask(
      input.observation,
      journey,
      memory,
      undefined,
      input.savedRoute
        ? {
            ...input.savedRoute,
            goal: input.savedRoute.canonicalGoal || input.savedRoute.goal,
          }
        : undefined,
    );
    // Explicit exclusions are hard constraints, including the first revealed step.
    if (
      plan.steps.some((step) => {
        const control = input.observation.controls.find(
          (c) => c.id === step.controlId,
        );
        return (
          !control ||
          !compatibleSettingsScope(task, control) ||
          task.exclusions.some((e) =>
            words(e).some((w) =>
              words(control.label + " " + (control.description || "")).includes(
                w,
              ),
            ),
          )
        );
      })
    )
      plan = {
        ...plan,
        status: "unresolved",
        steps: [],
        issue: "no-match",
        confidence: 0,
        reason: "The route conflicts with the requested scope or exclusion.",
      };
    eligible.sort(
      (a, b) =>
        Number(groundedSettingsTarget(task, b.control)) -
          Number(groundedSettingsTarget(task, a.control)) || b.score - a.score,
    );
    const best = eligible[0],
      second = eligible[1];
    const strong =
      !!best &&
      (best.direct ||
        groundedSettingsTarget(task, best.control) ||
        (best.semantic >= 0.64 && best.score >= 0.64));
    const ambiguous =
      strong &&
      second &&
      groundedSettingsTarget(task, best.control) ===
        groundedSettingsTarget(task, second.control) &&
      best.score - second.score < 0.07 &&
      best.control.signature !== second.control.signature &&
      !(
        best.control.destination &&
        best.control.destination.key === second.control.destination?.key
      );
    if (
      (plan.issue === "ambiguous" ||
        (plan.status === "unresolved" &&
          plan.issue === "no-match" &&
          ambiguous)) &&
      !task.boundSignature
    ) {
      const choices = eligible
        .filter((c) => c.score >= (best?.score || 0) - 0.12)
        .filter(
          (c, i, all) =>
            all.findIndex(
              (v) => v.control.signature === c.control.signature,
            ) === i,
        )
        .slice(0, 3);
      if (choices.length >= 2) {
        request.status = "clarification";
        return result({
          status: "clarification",
          request,
          clarification: {
            question: `Which “${sanitizeText(task.target)}” do you mean?`,
            choices: choices.map((c) => ({
              id: c.control.signature,
              signature: c.control.signature,
              target: c.control.label,
              label: sanitizeText(
                [c.control.label, c.control.context]
                  .filter(Boolean)
                  .join(" · "),
              ),
            })),
          },
          reason: "Several scanned controls fit this request.",
        });
      }
    }
    if (
      plan.status === "unresolved" &&
      plan.issue === "no-match" &&
      strong &&
      !ambiguous &&
      best.control.risk === "ordinary" &&
      !journey.objective.workflow &&
      !task.desiredValue
    ) {
      goal = best.control.label;
      // The selected semantic target is still checked by the existing grounded
      // planner. Hidden controls need a verified reveal relationship or route.
      plan = planGoal(
        {
          ...input.observation,
          controls: input.observation.controls.filter((c) =>
            compatibleSettingsScope(task, c),
          ),
        },
        goal,
        memory,
      );
      if (plan.steps.length) {
        task.contextTarget ||= task.target;
        task.target = goal;
        task.boundSignature = best.control.signature;
      }
    }
    if (task.boundSignature) {
      const bound = input.observation.controls.find(
        (c) => c.signature === task.boundSignature,
      );
      if (
        bound &&
        !task.desiredValue &&
        (!journey.objective.workflow ||
          ["navigation", "expand"].includes(bound.kind)) &&
        candidates.find((c) => c.control.signature === bound.signature)
          ?.eligible
      ) {
        if (!journey.objective.workflow) goal = bound.label;
        plan = planGoal(
          {
            ...input.observation,
            controls: input.observation.controls.filter(
              (c) =>
                c.signature === bound.signature ||
                bound.revealIds.includes(c.id),
            ),
          },
          bound.label,
          memory,
        );
      }
    }
    if (
      plan.status === "unresolved" &&
      plan.issue === "no-match" &&
      !task.desiredValue &&
      !journey.objective.workflow &&
      memory?.origin === input.observation.origin
    ) {
      // Remembered controls need an observed path whose first edge binds to a
      // fresh ordinary control. Historical IDs never become DOM targets.
      const reachable = (memory.states || memory.pages).filter((p) =>
        shortestRoute(
          input.observation,
          memory,
          new Set([p.stateKey]),
          input.strategy,
        ),
      );
      const seen = new Set(input.observation.controls.map((c) => c.signature));
      const controls = reachable
        .flatMap((p) => p.controls)
        .filter((c) => {
          if (
            !c.active ||
            !c.enabled ||
            c.risk !== "ordinary" ||
            seen.has(c.signature)
          )
            return false;
          seen.add(c.signature);
          return true;
        })
        .slice(0, 600)
        .map((c, i) => ({
          ...c,
          id: `wffffffffffffffff-${i}`,
          revealIds: [],
          inViewport: false,
        }));
      if (controls.length) {
        const historical = await this.index.rank(
          { ...input.observation, controls },
          task,
          signal,
        );
        const candidates = historical.filter(
            (c) => c.eligible && compatibleSettingsScope(task, c.control),
          ),
          first = candidates[0],
          next = candidates[1];
        if (
          first &&
          (first.direct || (first.semantic >= 0.68 && first.score >= 0.68)) &&
          (!next || first.score - next.score >= 0.08)
        ) {
          const grounded = planTask(
            input.observation,
            beginJourney(
              first.control.label,
              input.observation.origin,
              input.strategy,
            ),
            memory,
          );
          if (
            grounded.source === "memory" &&
            grounded.status === "guiding" &&
            grounded.steps.every((step) =>
              input.observation.controls.some((c) => c.id === step.controlId),
            )
          ) {
            plan = grounded;
            goal = first.control.label;
            task.contextTarget ||= task.target;
            task.target = goal;
            task.boundSignature = first.control.signature;
          }
        }
      }
    }
    if (
      plan.status === "unresolved" &&
      plan.issue === "no-match" &&
      !journey.objective.workflow
    )
      plan = exploreDestination(input.observation, task, input.journey) || plan;
    // A search destination requires manual entry + a newly observed matching
    // result + arrival. Finding or focusing a textbox is only an intermediate step.
    if (task.operation === "search" && task.desiredValue) {
      const desired = task.desiredValue.toLowerCase();
      const arrived = input.observation.controls.some(
        (c) =>
          c.kind === "section" &&
          c.label.toLowerCase() === desired &&
          c.sectionVisible,
      );
      const link = input.observation.controls.find(
        (c) =>
          c.kind === "navigation" &&
          c.label.toLowerCase() === desired &&
          c.visible &&
          c.enabled &&
          c.risk === "ordinary",
      );
      const field = input.observation.controls.find(
        (c) =>
          c.kind === "focus" &&
          /search/i.test(c.label + " " + c.role) &&
          c.visible &&
          c.enabled,
      );
      const target = link || (task.searchPhase ? undefined : field);
      goal = target?.label || "Search";
      plan = target
        ? planGoal(input.observation, goal, memory)
        : {
            ...plan,
            status: "awaiting-choice",
            steps: [],
            reason: `Enter “${task.desiredValue.slice(0, 160)}” in the website search, then choose a matching result.`,
          };
      if (
        arrived &&
        input.context?.verifiedDestination?.toLowerCase() === desired
      )
        plan = {
          ...plan,
          status: "completed",
          steps: [],
          reason:
            "The requested search destination is visible after a verified navigation.",
        };
      else if (plan.status === "completed")
        plan = {
          ...plan,
          status: "awaiting-choice",
          steps: [],
          reason: `Enter “${task.desiredValue.slice(0, 160)}” manually and select its result. Focusing Search does not finish this task.`,
        };
      if (link) {
        task.boundSignature = link.signature;
        task.searchPhase = "destination";
      }
    }
    if (plan.issue === "consequential" || plan.issue === "unknown-effect") {
      request.status = "blocked";
      task.status = "blocked";
    }
    return result({
      status: plan.status === "unresolved" ? "unsupported" : "plan",
      request,
      plan: { ...plan, goal: task.original },
      canonicalGoal: settingsDestination(task) || goal,
      reason: plan.reason,
    });
  }
  async suggestions(
    input: PlanInput,
    memory?: SiteMemory,
    signal?: AbortSignal,
  ) {
    const parsed = planInputSchema.parse(input),
      request = interpretRequest(parsed.text, parsed.context);
    const ranked = await this.index.rank(
      parsed.observation,
      request.tasks[0],
      signal,
    );
    return ranked
      .filter(
        (c) =>
          c.eligible &&
          compatibleSettingsScope(request.tasks[0], c.control) &&
          c.control.risk === "ordinary" &&
          c.control.enabled &&
          (c.control.visible ||
            parsed.observation.controls.some(
              (o) => o.visible && o.revealIds.includes(c.control.id),
            ) ||
            memory?.transitions.some(
              (t) =>
                t.active &&
                t.evidence === "observed" &&
                t.signature === c.control.signature,
            )),
      )
      .slice(0, 3)
      .map((c) => ({ label: c.control.label, signature: c.control.signature }));
  }
}
