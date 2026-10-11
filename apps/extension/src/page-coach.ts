import { BrowserAdapter } from "../../../packages/browser-adapter";
import { GuidanceOverlay } from "../../../packages/overlay-ui";
import {
  PageDiscovery,
  type BoundControl,
  presented,
} from "../../../packages/page-discovery";
import {
  LIVE_ROUTE_ID,
  LIVE_VERSION,
  type PageSnapshot,
  type GoalPlan,
  type SiteMemory,
  type ModelProposal,
  type ObservedTransition,
  hash,
  type TaskJourney,
  type SavedTask,
  type RouteStrategy,
  type PendingNavigation,
} from "../../../packages/page-model";
import {
  beginJourney,
  advanceJourney,
  planTask,
  objectiveReached,
  contextualTask,
  resumeJourney,
} from "../../../packages/goal-planner/task-journey";
import { inspectGoal, actionBoundary } from "../../../packages/goal-planner";
import {
  updateObservation,
  appendVerification,
  type LiveDiagnostics,
  type VerificationEvent,
} from "../../../packages/live-diagnostics";
import type { SessionView } from "../../../packages/shared-types";
export class PageCoach {
  view: SessionView;
  private discovery = new PageDiscovery();
  private overlay = new GuidanceOverlay();
  private adapter = new BrowserAdapter();
  private cleanup?: () => void;
  private selected?: BoundControl;
  private before?: PageSnapshot;
  private pending = false;
  private deadline?: ReturnType<typeof setTimeout>;
  private expectedChecked?: boolean;
  private initialSelection?: number;
  private eventTick?: ReturnType<typeof setTimeout>;
  private ownedRegions: { element: HTMLElement; visible: boolean }[] = [];
  private expectedNavigation?: string;
  private beforeUrl?: string;
  private selectedAt = 0;
  constructor(
    private publish: (
      view: SessionView,
      observed?: ObservedTransition,
      navigation?: PendingNavigation,
    ) => void,
    verifiedSteps = 0,
    private memory?: SiteMemory,
    restoredPlan?: GoalPlan,
    restoredDiagnostics?: LiveDiagnostics,
    private navigationVerified = false,
    restoredJourney?: TaskJourney,
    private savedTask?: SavedTask,
    private restoredNavigation?: PendingNavigation,
  ) {
    this.view = {
      routeId: LIVE_ROUTE_ID,
      routeVersion: LIVE_VERSION,
      status: "running",
      stateId: "choosing",
      instruction: "Describe your goal or choose a page control to highlight.",
      verifiedSteps,
      confidence: 0,
      history: ["choosing"],
      controls: [],
      goalPlan: restoredPlan,
      journey: restoredJourney && resumeJourney(restoredJourney),
      liveDiagnostics: restoredDiagnostics,
    };
  }
  start() {
    this.observe();
    if (this.view.goalPlan?.status === "completed")
      this.view.instruction =
        "Goal reached. The expected destination was verified.";
    this.refresh();
    if (
      this.view.journey &&
      contextualTask(this.view.journey) &&
      !objectiveReached(this.view.journey, this.view.page!)
    )
      this.view.journey.status = "active";
    if (
      this.view.goalPlan?.status === "guiding" ||
      this.view.journey?.status === "active"
    )
      this.replan();
    return this.view;
  }
  private observe() {
    this.cleanup = this.adapter.observe(() => this.refresh());
    document.addEventListener("click", this.clicked, true);
    document.addEventListener("focusin", this.focused, true);
    document.addEventListener("change", this.changed, true);
  }
  private clearTarget() {
    if (this.view.status === "waiting") this.view.status = "running";
    this.selected = undefined;
    this.before = undefined;
    this.ownedRegions = [];
    this.pending = false;
    clearTimeout(this.deadline);
    this.deadline = undefined;
    this.view.selectedControlId = undefined;
    this.overlay.clear();
  }
  private teardown() {
    this.cleanup?.();
    this.cleanup = undefined;
    document.removeEventListener("click", this.clicked, true);
    document.removeEventListener("focusin", this.focused, true);
    document.removeEventListener("change", this.changed, true);
    clearTimeout(this.eventTick);
    this.clearTarget();
  }
  private state(id: "choosing" | "guiding" | "verified") {
    this.view.stateId = id;
    if (this.view.history.at(-1) !== id)
      this.view.history = [...this.view.history, id].slice(-30);
  }
  private refresh() {
    if (!["running", "waiting"].includes(this.view.status)) return;
    const previousPage = this.view.page;
    const page = this.discovery.snapshot();
    this.view.page = page;
    this.view.liveDiagnostics = updateObservation(
      page,
      this.view.liveDiagnostics,
    );
    if (this.navigationVerified) {
      this.navigationVerified = false;
      if (this.restoredNavigation && this.view.journey) {
        const nav = this.restoredNavigation;
        this.view.journey = advanceJourney(
          this.view.journey,
          page,
          {
            ...page.controls[0],
            label: nav.label,
            signature: nav.signature,
            kind: "navigation",
          },
          nav.from,
          nav.durationMs || 0,
          Date.now(),
          nav.fromOrigin,
        );
        if (this.view.goalPlan?.status === "completed")
          this.view.journey.status = "completed";
        this.restoredNavigation = undefined;
      }
      const last = this.view.liveDiagnostics.events.at(-1);
      if (last?.kind === "navigation" && last.outcome === "waiting")
        this.view.liveDiagnostics = appendVerification(
          this.view.liveDiagnostics,
          {
            ...last,
            revision: page.revision,
            to: hash(page.stateKey),
            outcome: "verified",
            evidence: "destination-arrival",
          },
        );
    }
    this.view.controls = page.controls.filter((c) => c.visible && c.enabled);
    this.view.confidence = page.controls.length ? 1 : 0;
    if (this.selected && this.before) {
      const chosen = this.selected,
        c = chosen.control,
        fresh = this.discovery.bindings.get(c.id);
      const destination =
        chosen.destination &&
        presented(chosen.destination) &&
        chosen.destination.getBoundingClientRect();
      const sectionVisible =
        !!destination &&
        destination.top >= 0 &&
        destination.bottom <= innerHeight &&
        destination.left >= 0 &&
        destination.right <= innerWidth;
      const added = page.controls.some(
        (current) =>
          current.visible &&
          this.before!.controls.some(
            (old) =>
              old.signature === current.signature &&
              !old.visible &&
              old.revealIds.includes(c.id),
          ),
      );
      const removed = this.before.controls.some(
        (old) =>
          old.visible &&
          old.revealIds.includes(c.id) &&
          !page.controls.some(
            (current) => current.signature === old.signature && current.visible,
          ),
      );
      const changed =
        c.kind === "choice" || c.kind === "toggle"
          ? !!fresh &&
            fresh.control.checked === this.expectedChecked &&
            fresh.control.checked !== c.checked
          : c.kind === "focus"
            ? (() => {
                let active = document.activeElement;
                while (active?.shadowRoot?.activeElement)
                  active = active.shadowRoot.activeElement;
                return active === chosen.element;
              })()
            : c.kind === "section"
              ? sectionVisible
              : c.kind === "select"
                ? (chosen.element as HTMLSelectElement).selectedIndex !==
                    this.initialSelection &&
                  (!this.view.journey?.objective.value ||
                    objectiveReached(this.view.journey, page))
                : c.kind === "expand"
                  ? (!!fresh &&
                      typeof fresh.control.expanded === "boolean" &&
                      fresh.control.expanded !== c.expanded) ||
                    added ||
                    removed ||
                    this.ownedRegions.some(
                      (region) =>
                        region.element.isConnected &&
                        !!presented(region.element) !== region.visible,
                    )
                  : c.kind === "action"
                    ? false
                    : c.kind === "navigation"
                      ? this.expectedNavigation ===
                          hash(
                            location.origin +
                              location.pathname +
                              location.search,
                          ) && this.expectedNavigation !== this.beforeUrl
                      : false;
      if (
        (this.pending || c.kind === "section") &&
        changed &&
        (chosen.element.isConnected ||
          (c.kind === "expand" &&
            this.ownedRegions.some(
              (r) =>
                r.element.isConnected && !!presented(r.element) !== r.visible,
            )) ||
          c.kind === "action" ||
          c.kind === "navigation")
      ) {
        this.record(
          "verified",
          c.kind === "choice" || c.kind === "toggle"
            ? "checked-change"
            : c.kind === "focus"
              ? "field-focus"
              : c.kind === "section"
                ? "section-arrival"
                : c.kind === "select"
                  ? "selection-change"
                  : c.kind === "navigation"
                    ? "destination-arrival"
                    : fresh &&
                        typeof fresh.control.expanded === "boolean" &&
                        fresh.control.expanded !== c.expanded
                      ? "expanded-change"
                      : added
                        ? "related-controls-added"
                        : removed
                          ? "related-controls-removed"
                          : "owned-region-visibility",
        );
        this.verified(page);
        return;
      }
      if (this.pending && c.kind === "navigation" && this.expectedNavigation) {
        // Menus often close or remove their link while its destination loads.
        // Preserve the clicked destination until arrival or the existing deadline;
        // visibility changes alone cannot cancel the task's navigation evidence.
        if (!fresh?.control.visible || !fresh.control.enabled)
          this.view.selectedControlId = undefined;
        this.publish(this.view);
        return;
      }
      if (
        !fresh ||
        !fresh.control.visible ||
        !fresh.control.enabled ||
        fresh.control.signature !== c.signature ||
        fresh.control.label !== c.label ||
        fresh.control.role !== c.role ||
        fresh.control.kind !== c.kind ||
        fresh.control.risk !== c.risk ||
        fresh.control.context !== c.context ||
        fresh.control.description !== c.description
      ) {
        this.record("stale", "target-changed");
        if (this.view.journey?.status === "active")
          this.view.journey.reroutes++;
        this.clearTarget();
        this.state("choosing");
        this.view.instruction =
          "The control changed or is hidden. The page was rescanned; choose a current control.";
        if (this.view.goalPlan?.status === "guiding") {
          this.replan();
          return;
        }
      } else if (!this.pending)
        this.overlay.show(fresh.geometry, this.view.instruction);
    } else if (
      this.view.goalPlan?.status === "unresolved" ||
      (this.view.goalPlan?.status === "awaiting-choice" &&
        this.view.journey?.progress.length &&
        this.view.goalPlan.interpretation)
    ) {
      const plan = this.plan(this.view.goalPlan.goal);
      if (plan.status !== "unresolved") {
        this.installPlan(plan);
        return;
      }
    }
    if (
      !this.pending &&
      this.view.journey?.status === "active" &&
      previousPage &&
      previousPage.stateKey !== page.stateKey
    ) {
      this.view.journey.reroutes++;
      this.clearTarget();
      this.replan();
      return;
    }
    this.publish(this.view);
  }
  private verified(page: PageSnapshot) {
    const selected = this.selected!,
      before = this.before!;
    const evidence =
      before.stateKey !== page.stateKey
        ? {
            from: before.stateKey,
            to: page.stateKey,
            signature: selected.control.signature,
            label: selected.control.label,
            durationMs: Math.min(300000, Date.now() - this.selectedAt),
          }
        : undefined;
    const plan = this.view.goalPlan;
    if (this.view.journey) {
      this.view.journey = advanceJourney(
        this.view.journey,
        page,
        selected.control,
        before.stateKey,
        Date.now() - this.selectedAt,
      );
      if (contextualTask(this.view.journey)) {
        this.view.verifiedSteps++;
        this.clearTarget();
        this.publish(this.view, evidence);
        this.replan();
        return;
      }
    }
    this.view.verifiedSteps++;
    this.clearTarget();
    this.state("verified");
    this.view.instruction =
      "Control interaction verified. Choose another control or goal.";
    if (plan?.status === "guiding") {
      const remaining = plan.steps.slice(1);
      if (
        remaining.length &&
        remaining.every((step) =>
          page.controls.some((c) => c.id === step.controlId && c.enabled),
        ) &&
        page.controls.some((c) => c.id === remaining[0].controlId && c.visible)
      ) {
        this.view.goalPlan = { ...plan, steps: remaining };
        this.publish(this.view, evidence);
        this.select(remaining[0].controlId);
        return;
      }
      if (remaining.length || plan.source === "memory") {
        this.publish(this.view, evidence);
        this.replan();
        return;
      }
      if (selected.control.kind === "expand") {
        this.view.goalPlan = {
          ...plan,
          status: "awaiting-choice",
          steps: [],
          reason:
            "Menu opened. Choose an option on the website, or describe the option you want.",
        };
        this.view.instruction = this.view.goalPlan.reason;
        if (this.view.liveDiagnostics?.planning)
          this.view.liveDiagnostics.planning.decision = "awaiting-choice";
        this.publish(this.view, evidence);
        return;
      }
      this.view.goalPlan = {
        ...plan,
        status: "completed",
        steps: [],
        reason: "The final step's expected result was observed.",
      };
      if (this.view.journey) this.view.journey.status = "completed";
      this.view.instruction =
        "Goal reached. The expected control result was verified.";
      if (this.view.liveDiagnostics?.planning)
        this.view.liveDiagnostics.planning.decision = "completed";
    }
    this.publish(this.view, evidence);
  }
  getPage() {
    this.refresh();
    return this.view.page;
  }
  goal(
    goal: string,
    revision: number,
    proposal?: ModelProposal,
    options: {
      strategy?: RouteStrategy;
      journeyId?: string;
      savedRouteId?: string;
    } = {},
  ) {
    this.refresh();
    if (this.view.status !== "running" || this.view.page?.revision !== revision)
      return {
        error:
          "The page changed while planning. Try the goal again using the current controls.",
      };
    if (options.journeyId) {
      if (
        this.view.journey?.id !== options.journeyId ||
        this.view.journey.goal !== goal ||
        this.view.journey.status !== "active"
      )
        return { error: "This task changed while planning." };
    }
    this.clearTarget();
    if (!options.journeyId) {
      this.view.journey = beginJourney(
        goal,
        this.view.page.origin,
        options.strategy,
      );
      this.view.journey.savedRouteId = options.savedRouteId;
    }
    this.installPlan(this.plan(goal, proposal));
    return { view: this.view };
  }
  private replan() {
    if (this.view.page && this.view.goalPlan)
      this.installPlan(this.plan(this.view.goalPlan.goal));
  }
  private plan(goal: string, proposal?: ModelProposal) {
    let result = inspectGoal(
      this.view.page!,
      goal,
      this.memory,
      proposal,
      !proposal && this.view.goalPlan?.goal === goal
        ? this.view.goalPlan.interpretation
        : undefined,
    );
    if (
      proposal &&
      result.plan.issue === "invalid-model" &&
      this.view.goalPlan?.goal === goal &&
      this.view.goalPlan.interpretation
    )
      result = inspectGoal(
        this.view.page!,
        goal,
        this.memory,
        undefined,
        this.view.goalPlan.interpretation,
      );
    this.view.liveDiagnostics!.planning = result.diagnostics;
    if (!this.view.journey) return result.plan;
    const plan = planTask(
      this.view.page!,
      this.view.journey,
      this.memory,
      proposal,
      this.savedTask,
      result.plan,
    );
    if (contextualTask(this.view.journey) && plan.steps.length) {
      const target = this.view.page!.controls.find(
        (c) => c.id === plan.steps.at(-1)?.controlId,
      );
      if (target) {
        const current = inspectGoal(this.view.page!, target.label, this.memory);
        this.view.liveDiagnostics!.planning = {
          ...current.diagnostics,
          goalKey: hash(goal),
        };
      }
    }
    if (plan.status === "completed") this.view.journey.status = "completed";
    this.view.liveDiagnostics!.planning.decision = plan.status;
    this.view.liveDiagnostics!.planning.source = plan.source;
    return plan;
  }
  private record(
    outcome: VerificationEvent["outcome"],
    evidence: VerificationEvent["evidence"],
  ) {
    if (!this.selected || !this.before || !this.view.liveDiagnostics) return;
    const page = this.view.page || this.before;
    this.view.liveDiagnostics = appendVerification(this.view.liveDiagnostics, {
      signature: hash(this.selected.control.signature),
      kind: this.selected.control.kind,
      beforeRevision: this.before.revision,
      revision: page.revision,
      from: hash(this.before.stateKey),
      to: hash(page.stateKey),
      outcome,
      evidence,
    });
  }
  private installPlan(plan: GoalPlan) {
    this.view.goalPlan = plan;
    this.view.instruction = plan.reason;
    if (plan.status === "guiding") this.select(plan.steps[0].controlId);
    else {
      this.clearTarget();
      this.state(plan.status === "completed" ? "verified" : "choosing");
      this.publish(this.view);
    }
  }
  guide(id: string) {
    this.view.goalPlan = undefined;
    this.view.journey = undefined;
    if (this.view.liveDiagnostics)
      this.view.liveDiagnostics.planning = undefined;
    this.refresh();
    return this.select(id);
  }
  private select(id: string) {
    if (this.view.status !== "running")
      return { error: "Resume navigation before choosing a control." };
    const target = this.discovery.bindings.get(id);
    if (
      !target ||
      !target.control.visible ||
      !target.control.enabled ||
      !presented(target.element)
    )
      return {
        error:
          "This control is stale or hidden. Choose a current page control.",
      };
    this.clearTarget();
    if (target.control.risk === "consequential") {
      this.view.goalPlan = actionBoundary(target.control);
      this.view.instruction = this.view.goalPlan.reason;
      this.state("choosing");
      this.publish(this.view);
      return { view: this.view };
    }
    this.selected = target;
    this.selectedAt = Date.now();
    this.before = this.view.page;
    this.beforeUrl = hash(
      location.origin + location.pathname + location.search,
    );
    if (target.control.kind === "navigation") {
      const url = new URL(target.element.getAttribute("href")!, location.href);
      this.expectedNavigation = hash(url.origin + url.pathname + url.search);
    } else this.expectedNavigation = undefined;
    this.view.selectedControlId = id;
    this.state("guiding");
    const root = target.element.getRootNode() as Document | ShadowRoot;
    this.ownedRegions = ["aria-controls", "aria-owns", "popovertarget"]
      .flatMap((attribute) =>
        (target.element.getAttribute(attribute) || "").split(/\s+/),
      )
      .filter(Boolean)
      .map((id) => root.getElementById(id))
      .filter(
        (element): element is HTMLElement => element instanceof HTMLElement,
      )
      .map((element) => ({ element, visible: !!presented(element) }));
    this.expectedChecked =
      target.control.kind === "choice" ? true : !target.control.checked;
    if (target.control.kind === "select")
      this.initialSelection = (
        target.element as HTMLSelectElement
      ).selectedIndex;
    this.view.instruction =
      target.control.kind === "select" && this.view.journey?.objective.value
        ? "Open the highlighted “" +
          target.control.label +
          "” field and choose “" +
          this.view.journey.objective.value +
          "”. The selected option is checked."
        : target.control.kind === "focus"
          ? "Click the highlighted “" +
            target.control.label +
            "” field. Enter text yourself, then use the website's controls."
          : target.control.kind === "section" &&
              target.destination === target.element
            ? "Scroll to the highlighted “" +
              target.control.label +
              "” section."
            : target.control.kind === "navigation"
              ? "Follow the highlighted “" +
                target.control.label +
                "” link to open its destination."
              : target.control.kind === "expand"
                ? "Open the highlighted “" +
                  target.control.label +
                  "” control, then choose an option on the website."
                : "Use the highlighted “" + target.control.label + "” control.";
    this.overlay.show(target.geometry, this.view.instruction);
    this.publish(this.view);
    return { view: this.view };
  }
  private interacted() {
    if (!this.selected || this.pending) return;
    this.pending = true;
    this.record("waiting", "user-interaction");
    this.overlay.clear();
    if (this.selected.control.kind === "action") {
      this.clearTarget();
      this.state("choosing");
      this.view.instruction =
        "Review the website's result yourself. This control does not declare an outcome Navigator can verify.";
      if (this.view.goalPlan)
        this.view.goalPlan = {
          ...this.view.goalPlan,
          status: "unresolved",
          steps: [],
          reason: this.view.instruction,
        };
      this.publish(this.view);
      return;
    }
    this.view.status = "waiting";
    this.view.instruction = "Waiting for the website's expected result…";
    let navigation: PendingNavigation | undefined;
    if (
      this.selected.control.kind === "navigation" &&
      this.selected.control.destination
    ) {
      const url = new URL(
        this.selected.element.getAttribute("href")!,
        location.href,
      );
      if (
        !(this.selected.element as HTMLAnchorElement).target ||
        (this.selected.element as HTMLAnchorElement).target === "_self" ||
        (contextualTask(this.view.journey) &&
          (this.selected.element as HTMLAnchorElement).target === "_blank")
      )
        navigation = {
          from: this.before!.stateKey,
          signature: this.selected.control.signature,
          label: this.selected.control.label,
          destinationKey: this.selected.control.destination.key,
          navigationKey: hash(url.origin + url.pathname + url.search),
          origin: url.origin,
          durationMs: Math.min(300000, Date.now() - this.selectedAt),
          kind: "navigation",
          fromOrigin: this.before!.origin,
        };
    }
    this.publish(this.view, undefined, navigation);
    this.deadline = setTimeout(() => {
      this.record("timeout", "deadline-expired");
      this.clearTarget();
      this.state("choosing");
      this.view.instruction =
        "The expected result was not observed. Check the page and choose a control again.";
      if (this.view.goalPlan)
        this.view.goalPlan = {
          ...this.view.goalPlan,
          status: "unresolved",
          reason: this.view.instruction,
          steps: [],
        };
      this.publish(this.view);
    }, 8000);
    this.eventTick = setTimeout(() => this.refresh(), 0);
  }
  private clicked = (event: MouseEvent) => {
    if (
      this.selected &&
      (event.composedPath().includes(this.selected.element) ||
        event.composedPath().includes(this.selected.geometry) ||
        (event.target instanceof Node &&
          (this.selected.element.contains(event.target) ||
            this.selected.geometry.contains(event.target))))
    )
      this.interacted();
  };
  private focused = (event: FocusEvent) => {
    if (
      this.selected &&
      ["focus", "select"].includes(this.selected.control.kind) &&
      (event.target === this.selected.element ||
        event.composedPath().includes(this.selected.element))
    )
      this.interacted();
  };
  private changed = (event: Event) => {
    if (this.selected && event.target === this.selected.element) {
      this.interacted();
      this.refresh();
    }
  };
  updateMemory(memory: SiteMemory, savedTask?: SavedTask) {
    this.memory = memory;
    this.savedTask = savedTask;
  }
  pause() {
    this.record("canceled", "guidance-cleared");
    this.teardown();
    this.view.status = "paused";
    this.view.controls = [];
    this.view.page = undefined;
    this.view.instruction =
      "Navigation paused. Resume to discover the current page.";
    this.publish(this.view);
  }
  resume() {
    if (this.view.status !== "paused") return;
    this.view.status = "running";
    this.observe();
    this.refresh();
    if (this.view.goalPlan?.status === "guiding") this.replan();
  }
  stop(reason = "Navigation stopped.") {
    this.record("canceled", "guidance-cleared");
    this.teardown();
    this.view.status = "stopped";
    this.view.controls = [];
    this.view.page = undefined;
    this.view.instruction = reason;
    this.publish(this.view);
  }
  unload() {
    this.teardown();
  }
}
