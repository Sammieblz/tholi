import type { Route, Transition } from "../route-schema";
import type { UIState, SessionView, Localization } from "../shared-types";
import { localize } from "../state-localizer";
import { allowedOrigin, guidancePolicy } from "../safety-policy";
export class RouteEngine {
  view: SessionView;
  pending?: Transition;
  lastLocalization?: Localization;
  private started = false;
  constructor(public readonly route: Route) {
    this.view = {
      status: "idle",
      instruction: "Choose Start navigation to begin.",
      verifiedSteps: 0,
      confidence: 0,
      routeId: route.id,
      routeVersion: route.version,
      history: [],
    };
  }
  start(ui: UIState) {
    this.started = true;
    this.view.status = "running";
    return this.update(ui);
  }
  pause() {
    this.view.status = "paused";
    this.view.instruction =
      "Navigation paused. Resume to check the current screen.";
    this.pending = undefined;
  }
  stop(reason = "Navigation stopped.") {
    this.started = false;
    this.pending = undefined;
    this.view.status = "stopped";
    this.view.instruction = reason;
    this.view.reason = reason;
  }
  resume(ui: UIState) {
    if (this.view.status !== "paused" && this.view.status !== "checkpoint")
      return;
    this.started = true;
    this.view.status = "running";
    this.pending = undefined;
    return this.update(ui);
  }
  wait(transition: Transition) {
    if (this.view.status !== "running" && this.view.status !== "rerouting")
      return;
    this.pending = transition;
    this.view.status = "waiting";
    this.view.instruction = "Checking the next screen…";
  }
  timeout(ui: UIState) {
    if (!this.pending) return;
    const from = this.pending.from;
    this.pending = undefined;
    this.view.status = "running";
    const next = this.update(ui);
    if (this.view.stateId === from && this.view.status === "running")
      this.stop(
        "The expected change did not happen. Start again when the page is ready.",
      );
    return this.started ? next : undefined;
  }
  update(ui: UIState): Transition | undefined {
    if (
      !this.started ||
      ["paused", "checkpoint", "stopped", "completed", "boundary"].includes(
        this.view.status,
      )
    )
      return;
    if (!allowedOrigin(this.route, ui.origin)) {
      this.stop("The page left the supported origin.");
      return;
    }
    const result = localize(this.route, ui, this.view.stateId);
    this.lastLocalization = result;
    this.view.confidence = result.confidence;
    if (!result.stateId) {
      if (this.pending) return;
      this.stop(result.reason);
      return;
    }
    const previous = this.view.stateId;
    if (!previous && !this.route.startStates.includes(result.stateId)) {
      this.stop("This screen is not a supported starting point.");
      return;
    }
    if (this.pending && result.stateId === this.pending.from) return;
    const deviated =
      (!!previous &&
        result.stateId !== previous &&
        (!this.pending || !this.pending.to.includes(result.stateId))) ||
      (this.view.status === "rerouting" && previous === result.stateId);
    if (this.pending && this.pending.to.includes(result.stateId))
      this.view.verifiedSteps++;
    this.pending = undefined;
    this.view.stateId = result.stateId;
    if (this.view.history.at(-1) !== result.stateId)
      this.view.history = [...this.view.history, result.stateId].slice(-30);
    const state = this.route.states.find((s) => s.id === result.stateId)!;
    if (state.behavior === "boundary") {
      this.view.status = "boundary";
      this.view.instruction =
        "You reached the cancellation confirmation. Navigator stops here. Only you can confirm cancellation.";
      this.started = false;
      return;
    }
    if (state.behavior === "checkpoint") {
      this.view.status = "checkpoint";
      this.view.instruction =
        "Sign in manually. Navigator does not read authentication fields. Then select Resume.";
      return;
    }
    if (state.behavior === "success") {
      if (this.route.successStates.includes(state.id)) {
        this.view.status = "completed";
        this.view.instruction =
          "Visible confirmation verified. Your demo subscription is canceled.";
        this.started = false;
      } else this.stop("Success evidence is not configured.");
      return;
    }
    const transition = this.route.transitions.find((t) => t.from === state.id);
    if (!transition) {
      this.stop("No verified next step is available.");
      return;
    }
    const policy = guidancePolicy(transition);
    if (!policy.allowed) {
      this.stop(policy.reason);
      return;
    }
    this.view.status = deviated ? "rerouting" : "running";
    this.view.instruction =
      (deviated ? "Recalculating. " : "") + transition.instruction;
    this.view.reason = undefined;
    return transition;
  }
}
