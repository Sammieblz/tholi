import { api } from "../platform/api";
import { fullyUnclipped } from "../../../../packages/browser-adapter/geometry";
import { scrollTarget } from "../../../../packages/browser-adapter/scroll-target";
import {
  actionBoundary,
  goalScore,
  inspectGoal,
} from "../../../../packages/goal-planner/index";
import {
  advanceJourney,
  beginJourney,
  contextualTask,
  objectiveReached,
  planTask,
  resumeJourney,
} from "../../../../packages/goal-planner/task-journey";
import {
  appendVerification,
  updateObservation,
  type LiveDiagnostics,
  type VerificationEvent,
} from "../../../../packages/live-diagnostics/index";
import type {
  NavigationRequest,
  PlanResult,
} from "../../../../packages/navigation-core/contracts";
import { groundedSettingsTarget } from "../../../../packages/navigation-core/exploration";
import { workflowGuides } from "../../../../packages/navigation-core/guides";
import {
  advanceQueue,
  continuesDestination,
  pauseQueue,
  resumeQueue,
  stopQueue,
} from "../../../../packages/navigation-core/queue";
import type {
  ControlReference,
  WorkflowContext,
} from "../../../../packages/navigation-core/workflow-contracts";
import {
  continueWorkflow,
  recordWorkflowAction,
} from "../../../../packages/navigation-core/workflows";
import { words } from "../../../../packages/nlp/retrieval";
import {
  GuidanceOverlay,
  guidanceVisible,
} from "../../../../packages/overlay-ui/index";
import {
  PageDiscovery,
  presented,
  type BoundControl,
} from "../../../../packages/page-discovery/index";
import {
  hash,
  LIVE_ROUTE_ID,
  LIVE_VERSION,
  type GoalPlan,
  type ModelProposal,
  type ObservedTransition,
  type PageControl,
  type PageSnapshot,
  type PendingNavigation,
  type RouteStrategy,
  type SavedTask,
  type SiteMemory,
  type TaskJourney,
} from "../../../../packages/page-model/index";
import { sanitizeGoal } from "../../../../packages/privacy-redaction/index";
import type { SessionView } from "../../../../packages/shared-types/index";
import { frameElement } from "./frame-visibility";
import { compose as composeService } from "./observation-composition";
import { verified as verifiedService } from "./outcome-verification";
import {
  completeQueuedTask as completeQueuedTaskService,
  installPlan as installPlanService,
  installRequest as installRequestService,
  requestReplan as requestReplanService,
} from "./plan-lifecycle";
export class PageCoach {
  /** One live view of the coach for extracted services; no secondary state owner. */
  private serviceContext() {
    const owner = this;
    return {
      get selected() {
        return owner.selected;
      },
      set selected(value: PageCoach["selected"]) {
        owner.selected = value;
      },
      get before() {
        return owner.before;
      },
      set before(value: PageCoach["before"]) {
        owner.before = value;
      },
      get selectedAt() {
        return owner.selectedAt;
      },
      set selectedAt(value: PageCoach["selectedAt"]) {
        owner.selectedAt = value;
      },
      get view() {
        return owner.view;
      },
      set view(value: PageCoach["view"]) {
        owner.view = value;
      },
      get inputHandoff() {
        return owner.inputHandoff;
      },
      set inputHandoff(value: PageCoach["inputHandoff"]) {
        owner.inputHandoff = value;
      },
      clearTarget: owner.clearTarget.bind(owner),
      get publish() {
        return owner.publish;
      },
      set publish(value: PageCoach["publish"]) {
        owner.publish = value;
      },
      get planningRevision() {
        return owner.planningRevision;
      },
      set planningRevision(value: PageCoach["planningRevision"]) {
        owner.planningRevision = value;
      },
      requestReplan: owner.requestReplan.bind(owner),
      get verifiedDestination() {
        return owner.verifiedDestination;
      },
      set verifiedDestination(value: PageCoach["verifiedDestination"]) {
        owner.verifiedDestination = value;
      },
      state: owner.state.bind(owner),
      select: owner.select.bind(owner),
      replan: owner.replan.bind(owner),
      completeQueuedTask: owner.completeQueuedTask.bind(owner),
      refresh: owner.refresh.bind(owner),
      get memory() {
        return owner.memory;
      },
      set memory(value: PageCoach["memory"]) {
        owner.memory = value;
      },
      get workflowWaitTimer() {
        return owner.workflowWaitTimer;
      },
      set workflowWaitTimer(value: PageCoach["workflowWaitTimer"]) {
        owner.workflowWaitTimer = value;
      },
      get recoveryKey() {
        return owner.recoveryKey;
      },
      set recoveryKey(value: PageCoach["recoveryKey"]) {
        owner.recoveryKey = value;
      },
      get recoveryStep() {
        return owner.recoveryStep;
      },
      set recoveryStep(value: PageCoach["recoveryStep"]) {
        owner.recoveryStep = value;
      },
      get recoveryTimer() {
        return owner.recoveryTimer;
      },
      set recoveryTimer(value: PageCoach["recoveryTimer"]) {
        owner.recoveryTimer = value;
      },
      get discovery() {
        return owner.discovery;
      },
      set discovery(value: PageCoach["discovery"]) {
        owner.discovery = value;
      },
      installPlan: owner.installPlan.bind(owner),
      get cancelScroll() {
        return owner.cancelScroll;
      },
      set cancelScroll(value: PageCoach["cancelScroll"]) {
        owner.cancelScroll = value;
      },
      get overlay() {
        return owner.overlay;
      },
      set overlay(value: PageCoach["overlay"]) {
        owner.overlay = value;
      },
      showFrameControl: owner.showFrameControl.bind(owner),
      get requestPlanner() {
        return owner.requestPlanner;
      },
      set requestPlanner(value: PageCoach["requestPlanner"]) {
        owner.requestPlanner = value;
      },
      installRequest: owner.installRequest.bind(owner),
      get frames() {
        return owner.frames;
      },
      set frames(value: PageCoach["frames"]) {
        owner.frames = value;
      },
      get compositionStarted() {
        return owner.compositionStarted;
      },
      set compositionStarted(value: PageCoach["compositionStarted"]) {
        owner.compositionStarted = value;
      },
      get frameVisibilityStates() {
        return owner.frameVisibilityStates;
      },
      set frameVisibilityStates(value: PageCoach["frameVisibilityStates"]) {
        owner.frameVisibilityStates = value;
      },
      get compositionFingerprint() {
        return owner.compositionFingerprint;
      },
      set compositionFingerprint(value: PageCoach["compositionFingerprint"]) {
        owner.compositionFingerprint = value;
      },
      get compositionRevision() {
        return owner.compositionRevision;
      },
      set compositionRevision(value: PageCoach["compositionRevision"]) {
        owner.compositionRevision = value;
      },
    };
  }

  view: SessionView;
  private discovery = new PageDiscovery();
  private overlay = new GuidanceOverlay();
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
  private planningRevision = "";
  private verifiedDestination?: string;
  private workflowWaitTimer?: ReturnType<typeof setTimeout>;
  private cancelScroll?: () => void;
  private recoveryKey = "";
  private recoveryStep = 0;
  private recoveryTimer?: ReturnType<typeof setTimeout>;
  private inputHandoff?: BoundControl;
  private frames = new Map<
    number,
    { documentId: string; tabId: number; page: PageSnapshot }
  >();
  private compositionStarted = false;
  private compositionRevision = 0;
  private compositionFingerprint = "";
  private externalControl?: PageControl;
  private frameVisibilityStates = new Map<
    number,
    {
      documentId: string;
      visible: boolean;
      inViewport: boolean;
      placement: PageControl["placement"];
    }
  >();
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
    restoredRequest?: NavigationRequest,
    private requestPlanner?: (
      request: NavigationRequest,
      page: PageSnapshot,
      verifiedDestination?: string,
    ) => Promise<PlanResult>,
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
      request: restoredRequest,
    };
  }
  start() {
    if (this.view.request) this.view.request = resumeQueue(this.view.request);
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
    if (this.view.request?.status === "active") this.requestReplan();
    return this.view;
  }
  presentationChanged(visible: boolean) {
    this.cancelScroll?.();
    this.cancelScroll = undefined;
    this.overlay.clear();
    // Retain the selected control for outcome observation while minimized.
    // Restoring always checks the current document before showing it again.
    if (visible) this.refresh();
  }
  private observe() {
    this.cleanup = this.discovery.observe(() => this.refresh());
    document.addEventListener("click", this.clicked, true);
    document.addEventListener("focusin", this.focused, true);
    document.addEventListener("pointerover", this.hovered, true);
    document.addEventListener("change", this.changed, true);
  }
  private clearTarget() {
    this.cancelScroll?.();
    this.cancelScroll = undefined;
    if (this.view.status === "waiting") this.view.status = "running";
    this.selected = undefined;
    if (this.externalControl)
      void api.runtime
        .sendMessage({ type: "CLEAR_FRAME_GUIDANCE" })
        .catch(() => {});
    this.externalControl = undefined;
    this.before = undefined;
    this.ownedRegions = [];
    this.pending = false;
    clearTimeout(this.deadline);
    this.deadline = undefined;
    this.view.selectedControlId = undefined;
    this.overlay.clear();
  }
  private teardown() {
    this.inputHandoff = undefined;
    clearTimeout(this.recoveryTimer);
    this.cleanup?.();
    this.cleanup = undefined;
    document.removeEventListener("click", this.clicked, true);
    document.removeEventListener("focusin", this.focused, true);
    document.removeEventListener("pointerover", this.hovered, true);
    document.removeEventListener("change", this.changed, true);
    clearTimeout(this.eventTick);
    clearTimeout(this.workflowWaitTimer);
    this.workflowWaitTimer = undefined;
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
    const page = this.compose(this.discovery.snapshot());
    this.view.page = page;
    this.view.liveDiagnostics = updateObservation(
      page,
      this.view.liveDiagnostics,
    );
    if (
      !this.pending &&
      this.view.request?.status === "active" &&
      this.view.journey?.status === "active" &&
      this.view.journey.requestTaskId ===
        this.view.request.tasks[this.view.request.active]?.id &&
      this.view.journey?.objective.value &&
      !this.view.journey.workflow &&
      objectiveReached(this.view.journey, page)
    ) {
      this.clearTarget();
      this.view.journey.status = "completed";
      this.view.goalPlan = {
        goal: this.view.journey.goal,
        source: "semantics",
        status: "completed",
        confidence: 1,
        reason: "The requested preference is present in the fresh page state.",
        steps: [],
      };
      this.completeQueuedTask();
      return;
    }

    if (this.navigationVerified) {
      this.navigationVerified = false;
      if (this.restoredNavigation && this.view.journey) {
        const nav = this.restoredNavigation;
        if (
          this.view.journey.workflow &&
          this.view.journey.workflow.pendingAction?.signature === nav.signature
        ) {
          this.view.journey.workflow = recordWorkflowAction(
            this.view.journey.workflow,
            {
              ...page.controls[0],
              label: nav.label,
              signature: nav.signature,
              kind: "navigation",
              destination: {
                origin: page.origin,
                path: page.path,
                key: page.pageKey,
              },
            },
            true,
            page,
          );
          if (this.view.journey.workflow.pendingAction)
            this.view.journey.workflow.pendingAction.frameId = 0;
        }
        this.verifiedDestination = nav.label;
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
    if (
      this.pending &&
      this.selected?.control.kind === "expand" &&
      this.selected.control.popup &&
      this.before &&
      this.view.journey?.workflow?.status !== "review"
    ) {
      const workflow = this.view.journey?.workflow;
      const guide =
        workflow && workflowGuides.find((g) => g.id === workflow.guideId);
      const method = workflow?.entities.find((e) => e.type === "method")?.value;
      const next = guide?.milestones
        .slice((workflow?.activeMilestone || 0) + 1)
        .find((m) => !m.branch || m.branch === method);
      const value = workflow?.entities.find(
        (e) => e.type === next?.entity,
      )?.value;
      const targets = [value, ...(next?.targets || [])].filter(
        (v): v is string => !!v,
      );
      const pickerTask = this.view.request?.tasks[this.view.request.active];
      // A detached picker can obscure or omit its opener before focus settles.
      // Verify only this pending, same-task reveal from a fresh named dialog's
      // visible expanded combobox. This cannot establish the chosen outcome.
      const pickerWords =
        this.view.request?.status === "active" &&
        pickerTask &&
        ["reveal", "choose"].includes(pickerTask.operation) &&
        !pickerTask.desiredValue &&
        this.view.journey?.requestTaskId === pickerTask.id &&
        this.before.origin === page.origin &&
        this.selected.element.isConnected &&
        this.selected.control.risk === "ordinary" &&
        words(pickerTask.target).every((word) =>
          words(
            this.selected!.control.label +
              " " +
              this.selected!.control.description,
          ).includes(word),
        )
          ? words(pickerTask.target)
          : [];
      const matching = page.controls.filter(
        (c) =>
          c.visible &&
          c.enabled &&
          !c.occluded &&
          c.kind !== "section" &&
          (c.reference?.frameId || 0) ===
            (this.selected!.control.reference?.frameId || 0) &&
          (workflow
            ? targets.some((t) => t.toLowerCase() === c.label.toLowerCase())
            : (this.view.goalPlan?.exploration &&
                c.risk === "ordinary" &&
                (goalScore(this.view.goalPlan.goal, c) >= 0.7 ||
                  (!!this.view.request &&
                    groundedSettingsTarget(
                      this.view.request.tasks[this.view.request.active],
                      c,
                    )))) ||
              (pickerWords.length > 0 &&
                c.kind === "focus" &&
                c.role === "combobox" &&
                c.expanded === true &&
                c.risk === "ordinary" &&
                pickerWords.every((word) => words(c.label).includes(word)) &&
                c.structure?.regions.some(
                  (region) =>
                    region.role === "dialog" &&
                    pickerWords.every((word) =>
                      words(region.name).includes(word),
                    ),
                ))) &&
          !this.before!.controls.some(
            (old) => old.signature === c.signature && old.visible,
          ) &&
          page.coverage?.some(
            (s) =>
              s.surfaceId === c.surfaceId &&
              ["menu", "listbox", "dialog"].includes(s.role),
          ),
      );
      // A fresh, uniquely task-relevant control inside the declared popup can
      // verify the reveal even when a framework portals it outside the trigger.
      // This verifies only the opening, never the next action or task outcome.
      if (
        (workflow || this.view.goalPlan?.exploration || pickerWords.length) &&
        matching.length === 1
      ) {
        if (pickerWords.length)
          this.record("verified", "related-controls-added");
        this.verified(page);
        return;
      }
    }
    if (
      this.externalControl &&
      !page.controls.some(
        (c) =>
          c.id === this.externalControl!.id &&
          c.signature === this.externalControl!.signature &&
          c.visible &&
          c.reference?.documentId ===
            this.externalControl!.reference?.documentId,
      )
    ) {
      this.clearTarget();
      this.planningRevision = "";
      this.requestReplan();
    }
    if (
      this.selected &&
      this.before &&
      !["review", "verifying"].includes(
        this.view.journey?.workflow?.status || "",
      )
    ) {
      const chosen = this.selected,
        c = chosen.control,
        fresh = this.discovery.bindings.get(c.id);
      const destination =
        chosen.destination &&
        presented(chosen.destination) &&
        chosen.destination.getBoundingClientRect();
      const sectionVisible =
        !!destination &&
        fullyUnclipped(chosen.destination!) &&
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
            ((fresh.control.checked === this.expectedChecked &&
              fresh.control.checked !== c.checked) ||
              (c.kind === "choice" &&
                fresh.control.selected === true &&
                c.selected !== true))
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
                : c.kind === "range"
                  ? !!fresh &&
                    fresh.control.range?.current !== c.range?.current &&
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
        this.pending &&
        c.kind === "expand" &&
        c.popup &&
        page.partial &&
        chosen.element.isConnected &&
        (!fresh?.control.visible || fresh.control.occluded)
      ) {
        // A portal can obscure its opener before incremental discovery indexes
        // the new popup. Retain the actual interaction through that incomplete
        // observation; fresh outcome evidence is still required to verify it.
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
          if (this.view.request) {
            this.view.goalPlan = {
              ...this.view.goalPlan,
              status: "unresolved",
              steps: [],
              reason: this.view.instruction,
            };
            this.publish(this.view);
          }
          this.replan();
          return;
        }
      } else if (!this.pending)
        this.overlay.show(fresh.geometry, this.view.instruction, {
          key:
            (this.view.request?.id || this.view.journey?.id || "") +
            ":" +
            fresh.control.id +
            ":" +
            this.view.verifiedSteps,
          attention: fresh.control.risk === "ordinary",
          warning: fresh.control.risk !== "ordinary",
        });
    } else if (
      !this.view.request &&
      (this.view.goalPlan?.status === "unresolved" ||
        (this.view.goalPlan?.status === "awaiting-choice" &&
          this.view.journey?.progress.length &&
          this.view.goalPlan.interpretation))
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
    return verifiedService(this.serviceContext(), page);
  }
  getPage(query?: string) {
    if (query) this.discovery.setQuery(query);
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
      this.view.request = undefined;
      this.view.clarification = undefined;
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
    if (this.view.request && this.requestPlanner) {
      this.requestReplan();
      return;
    }
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
    return installPlanService(this.serviceContext(), plan);
  }
  installRequest(
    result: PlanResult,
    strategy?: RouteStrategy,
    savedRouteId?: string,
  ) {
    return installRequestService(
      this.serviceContext(),
      result,
      strategy,
      savedRouteId,
    );
  }
  private completeQueuedTask() {
    return completeQueuedTaskService(this.serviceContext());
  }
  recheckJourney() {
    this.refresh();
    this.planningRevision = "";
    this.requestReplan();
    return { view: this.view };
  }
  restoreJourney(journey: TaskJourney, request: NavigationRequest) {
    this.clearTarget();
    this.view.journey = structuredClone(journey);
    this.view.request = structuredClone(request);
    this.view.goalPlan = undefined;
    this.view.clarification = undefined;
    this.planningRevision = "";
    this.view.status = "running";
    this.refresh();
    this.publish(this.view);
    queueMicrotask(() => this.requestReplan());
    return { view: this.view };
  }
  skipTask() {
    if (!this.view.request || this.view.request.status === "canceled") return;
    this.clearTarget();
    this.view.request = advanceQueue(this.view.request, "skipped");
    this.view.clarification = undefined;
    this.planningRevision = "";
    if (this.view.request.status === "active") this.requestReplan();
    this.publish(this.view);
  }
  private requestReplan() {
    return requestReplanService(this.serviceContext());
  }
  guide(id: string) {
    this.view.request = undefined;
    this.view.clarification = undefined;
    this.view.goalPlan = undefined;
    this.view.journey = undefined;
    if (this.view.liveDiagnostics)
      this.view.liveDiagnostics.planning = undefined;
    this.refresh();
    return this.select(id);
  }
  private select(id: string, observed?: ObservedTransition) {
    if (this.view.status !== "running")
      return { error: "Resume navigation before choosing a control." };
    const target = this.discovery.bindings.get(id);
    const external = this.view.page?.controls.find(
      (c) => c.id === id && c.reference?.frameId,
    );
    if (external)
      return this.showFrameControl(
        external,
        "Use the highlighted control in the embedded application. Its result will be checked.",
        false,
      );
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
      if (this.view.request)
        this.view.request = advanceQueue(this.view.request, "boundary");
      this.view.goalPlan = actionBoundary(target.control);
      this.view.instruction = this.view.goalPlan.reason;
      this.state("choosing");
      this.publish(this.view, observed);
      return { view: this.view };
    }
    this.selected = target;
    if (
      guidanceVisible() &&
      (!target.control.inViewport || !fullyUnclipped(target.geometry))
    )
      this.cancelScroll = scrollTarget(
        target.geometry,
        () => guidanceVisible() && this.selected === target,
      );
    this.discovery.setPriority(target.element);
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
    if (this.view.goalPlan?.exploration)
      this.view.instruction = this.view.goalPlan.reason;
    const workflow = this.view.journey?.workflow,
      guide = workflow && workflowGuides.find((g) => g.id === workflow.guideId),
      stage = guide?.milestones[workflow?.activeMilestone || 0],
      value = workflow?.entities.find((e) => e.type === stage?.entity)?.value;
    if (value)
      this.view.instruction =
        target.control.kind === "focus"
          ? `Enter “${value}” using the highlighted field and the website's controls. Input contents are not read.`
          : `Use the highlighted “${target.control.label}” control to choose “${value}”. The requested state is checked.`;
    this.overlay.show(target.geometry, this.view.instruction, {
      key:
        (this.view.request?.id || this.view.journey?.id || "") +
        ":" +
        target.control.id +
        ":" +
        this.view.verifiedSteps,
      attention: target.control.risk === "ordinary",
      warning: target.control.risk !== "ordinary",
    });
    this.publish(this.view, observed);
    return { view: this.view };
  }
  private interacted() {
    if (!this.selected || this.pending) return;
    if (this.view.journey?.workflow?.status === "review") {
      const target = this.selected;
      this.view.journey.workflow = recordWorkflowAction(
        this.view.journey.workflow,
        target.control,
      );
      let navigation: PendingNavigation | undefined;
      if (target.control.kind === "navigation" && target.control.destination) {
        const url = new URL(
          target.element.getAttribute("href")!,
          location.href,
        );
        navigation = {
          from: this.view.page!.stateKey,
          signature: target.control.signature,
          label: target.control.label,
          destinationKey: target.control.destination.key,
          navigationKey: hash(url.origin + url.pathname + url.search),
          origin: url.origin,
          durationMs: Date.now() - this.selectedAt,
          kind: "navigation",
          fromOrigin: location.origin,
          newTab: (target.element as HTMLAnchorElement).target === "_blank",
        };
      }
      this.overlay.clear();
      this.view.instruction =
        "Waiting for the website's result. The action has not been verified.";
      this.publish(this.view, undefined, navigation);
      this.clearTarget();
      this.planningRevision = "";
      this.eventTick = setTimeout(() => {
        this.refresh();
        this.requestReplan();
      }, 0);
      return;
    }
    this.pending = true;
    if (this.view.journey?.workflow)
      this.view.journey.workflow = recordWorkflowAction(
        this.view.journey.workflow,
        this.selected.control,
      );
    this.record("waiting", "user-interaction");
    this.overlay.clear();
    if (this.selected.control.kind === "action") {
      this.clearTarget();
      this.state("choosing");
      this.view.instruction =
        "Review the website's result yourself. This control does not declare an outcome Tholi can verify.";
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
    this.view.status = this.view.journey?.workflow ? "running" : "waiting";
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
        (continuesDestination(this.view.journey, this.view.request) &&
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
          newTab:
            (this.selected.element as HTMLAnchorElement).target === "_blank",
        };
    }
    this.publish(this.view, undefined, navigation);
    this.deadline = setTimeout(() => {
      if (this.view.journey?.workflow) {
        this.view.journey.workflow.waitExpired = true;
        this.view.journey.workflow.revision++;
        this.view.instruction =
          "The website has not confirmed the result. Keep waiting, retry, or replan; the task remains incomplete.";
        this.publish(this.view);
        return;
      }
      this.record("timeout", "deadline-expired");
      this.view.status = "running";
      this.view.instruction =
        "Still waiting for the website. Your destination is retained.";
      this.publish(this.view);
    }, 120000);
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
  private hovered = (event: PointerEvent) => {
    if (
      this.selected?.control.kind === "expand" &&
      event.composedPath().includes(this.selected.element)
    )
      this.interacted();
  };
  private changed = (event: Event) => {
    if (
      this.inputHandoff?.element === event.target &&
      this.view.journey?.workflow
    ) {
      const workflow = this.view.journey.workflow;
      const guide = workflowGuides.find((g) => g.id === workflow.guideId);
      if (
        guide?.milestones[workflow.activeMilestone]?.kind === "input" &&
        workflow.pendingAction?.signature ===
          this.inputHandoff.control.signature
      ) {
        // A native change is an input handoff, not proof of the entered value
        // or the task outcome. Verification still happens on later screens.
        this.view.journey.workflow = continueWorkflow(workflow, guide);
        this.inputHandoff = undefined;
        this.planningRevision = "";
        this.requestReplan();
      }
    }
    if (this.selected && event.target === this.selected.element) {
      this.interacted();
      this.refresh();
    }
  };
  updateMemory(memory: SiteMemory, savedTask?: SavedTask) {
    this.memory = memory;
    this.savedTask = savedTask;
  }
  workflowAction(action: "CONTINUE" | "WAIT" | "RETRY") {
    const workflow = this.view.journey?.workflow;
    if (!workflow || this.view.status !== "running") return;
    const guide = workflowGuides.find((g) => g.id === workflow.guideId);
    if (!guide) return;
    this.view.journey!.workflow =
      action === "CONTINUE"
        ? continueWorkflow(workflow, guide)
        : {
            ...workflow,
            revision: workflow.revision + 1,
            status: action === "RETRY" ? "active" : workflow.status,
            pendingAction:
              action === "RETRY" ? undefined : workflow.pendingAction,
          };
    if (action === "WAIT" && this.view.journey!.workflow.pendingAction) {
      this.view.journey!.workflow.pendingAction.startedAt = Date.now();
      this.view.journey!.workflow.waitExpired = false;
    }
    this.clearTarget();
    this.planningRevision = "";
    this.requestReplan();
    this.publish(this.view);
  }
  setWorkflowEntity(
    type: WorkflowContext["entities"][number]["type"],
    raw: string,
  ) {
    const w = this.view.journey?.workflow,
      value = sanitizeGoal(raw);
    if (!w || !value || this.view.status !== "running") return;
    const guide = workflowGuides.find((g) => g.id === w.guideId);
    const previous = w.entities.find((e) => e.type === type);
    w.entities = w.entities.filter((e) => e.type !== type);
    w.entities.push({ type, value, source: "clarification" });
    w.revision++;
    if (previous && previous.value !== value) {
      const stage = guide?.milestones.findIndex((m) => m.entity === type) ?? -1;
      if (stage >= 0) w.activeMilestone = Math.min(w.activeMilestone, stage);
      w.verified = w.verified.filter(
        (v) =>
          (guide?.milestones.findIndex((m) => m.id === v.milestone) ?? -1) <
          w.activeMilestone,
      );
    }
    w.status = "active";
    w.pendingAction = undefined;
    this.clearTarget();
    this.planningRevision = "";
    this.requestReplan();
    this.publish(this.view);
  }
  private compose(local: PageSnapshot): PageSnapshot {
    return composeService(this.serviceContext(), local);
  }
  frameAccess(origins: string[], limit: number) {
    this.frames.clear();
    this.frameVisibilityStates.clear();
    this.view.frameAccess = origins;
    this.discovery.setLimit(limit);
    this.refresh();
  }
  frameObservation(
    frameId: number,
    documentId: string,
    tabId: number,
    page: PageSnapshot,
  ) {
    if (this.view.status !== "running") return;
    const old = this.frames.get(frameId);
    if (old?.documentId === documentId && old.page.revision > page.revision)
      return;
    this.frames.set(frameId, { documentId, tabId, page });
    this.refresh();
  }
  frameVisibility(
    frameId: number,
    documentId: string,
    shown: boolean,
    inViewport: boolean,
    placement: PageControl["placement"],
  ) {
    this.frameVisibilityStates.set(frameId, {
      documentId,
      visible: shown,
      inViewport,
      placement,
    });
    this.refresh();
  }
  frameInteraction(
    reference: ControlReference,
    signature: string,
    verified: boolean,
  ) {
    const control = this.view.page?.controls.find(
      (c) =>
        c.id === reference.controlId &&
        c.reference?.documentId === reference.documentId &&
        c.signature === signature,
    );
    if (
      !control ||
      control.id !== this.externalControl?.id ||
      this.view.status !== "running"
    )
      return;
    if (this.view.journey?.workflow) {
      this.view.journey.workflow = recordWorkflowAction(
        this.view.journey.workflow,
        control,
        verified,
        this.view.page,
      );
      if (verified && control.kind !== "focus") this.view.verifiedSteps++;
    } else if (
      verified &&
      this.view.request?.tasks[this.view.request.active]?.operation === "search"
    ) {
      this.view.request.tasks[this.view.request.active].searchPhase = "results";
      this.view.verifiedSteps++;
    } else if (verified && this.view.journey?.objective.value) {
      this.view.verifiedSteps++;
    } else if (verified && this.view.goalPlan) {
      this.view.verifiedSteps++;
      this.view.goalPlan = {
        ...this.view.goalPlan,
        status: "completed",
        steps: [],
        reason:
          "The requested control interaction was verified in the embedded application.",
      };
      this.completeQueuedTask();
    }
    this.publish(this.view);
    this.planningRevision = "";
    this.requestReplan();
  }
  private showFrameControl(
    control: PageControl,
    instruction: string,
    review: boolean,
  ) {
    if (
      !control.visible ||
      !control.enabled ||
      control.occluded ||
      (control.risk === "consequential" && !review)
    )
      return { error: "Frame target requires fresh review." };
    this.clearTarget();
    this.externalControl = control;
    this.view.selectedControlId = control.id;
    this.view.instruction = instruction;
    const element = frameElement(control.reference!.frameId);
    if (element && !control.inViewport)
      this.overlay.show(
        element,
        "Scroll to the embedded application to see its highlighted control.",
      );
    void api.runtime
      .sendMessage({
        type: "GUIDE_FRAME",
        reference: control.reference,
        signature: control.signature,
        instruction,
        review,
      })
      .then((reply) => {
        if (reply?.error) {
          this.clearTarget();
          this.view.instruction = reply.error;
          this.publish(this.view);
        }
      })
      .catch(() => this.clearTarget());
    this.publish(this.view);
    return { view: this.view };
  }
  pause() {
    if (this.view.request) this.view.request = pauseQueue(this.view.request);
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
    if (this.view.request) this.view.request = resumeQueue(this.view.request);
    // Blocked review requests may not start another plan immediately. Do not
    // leave their prior Pause instruction attached to a running session.
    this.view.instruction =
      this.view.goalPlan?.reason ||
      "Checking the current page. Your destination is retained.";
    this.planningRevision = "";
    this.observe();
    this.refresh();
    if (
      this.view.goalPlan?.status === "guiding" ||
      this.view.request?.status === "active"
    )
      this.replan();
  }
  stop(reason = "Navigation stopped.") {
    if (this.view.journey?.workflow)
      this.view.journey.workflow.status = "canceled";
    if (this.view.request) this.view.request = stopQueue(this.view.request);
    this.view.clarification = undefined;
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
    if (["running", "waiting"].includes(this.view.status)) {
      this.view.status = "paused";
      if (this.view.request) this.view.request = pauseQueue(this.view.request);
    }
  }
}
