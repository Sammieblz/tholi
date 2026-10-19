import { api } from "../platform/api";
import { BrowserAdapter } from "../../../../packages/browser-adapter/index";
import { requestSchema } from "../../../../packages/navigation-core/contracts";
import { navigationActionSchema } from "../../../../packages/navigation-core/navigation-actions";
import {
  GuidanceOverlay,
  setGuidanceVisible,
} from "../../../../packages/overlay-ui/index";
import {
  journeySchema,
  LIVE_ROUTE_ID,
  LIVE_VERSION,
  type SiteMemory,
} from "../../../../packages/page-model/index";
import { RouteEngine } from "../../../../packages/route-engine/index";
import { routeRegistry } from "../../../../packages/route-registry/index";
import type { Transition } from "../../../../packages/route-schema/index";
import { contentMessageSchema } from "../../../../packages/route-schema/index";
import { allowedOrigin } from "../../../../packages/safety-policy/index";
import { startPageAppearance } from "../ui/theme/theme-agent";
import {
  applyWidgetLayout,
  expandWidgetShell,
  mountWidgetShell,
  moveWidgetAside,
  unmountWidget,
  updateWidgetShell,
} from "../ui/widget/widget-shell";
import { frameVisibilityBridge } from "./frame-visibility";
import { PageCoach } from "./page-coach";
import {
  captureMetadata,
  clearVisual,
  onVisualInvalidation,
  restoreOverlay,
  showVisual,
  viewportRevision,
} from "./visual-guidance";
const marker = "__internetNavigatorLoaded0100";
const host = globalThis as typeof globalThis & { [marker]?: boolean };
if (!host[marker]) {
  host[marker] = true;
  startPageAppearance();
  let adapter = new BrowserAdapter();
  const overlay = new GuidanceOverlay();
  let engine: RouteEngine | undefined;
  let coach: PageCoach | undefined;
  let sessionId: string | undefined;
  let presentationRevision = 0;
  let visualNotification: ReturnType<typeof setTimeout> | undefined;
  let visualCleanup: (() => void) | undefined;
  const observeVisual = () => {
    visualCleanup?.();
    visualCleanup = onVisualInvalidation(() => {
      if (!sessionId || visualNotification) return;
      visualNotification = setTimeout(() => {
        visualNotification = undefined;
        if (coach?.view.goalPlan?.action?.kind === "visual")
          coach.recheckJourney();
        void api.runtime
          .sendMessage({ type: "VISION_INVALIDATED", sessionId })
          .catch(() => {});
      }, 50);
    });
  };
  const stopVisual = () => {
    visualCleanup?.();
    visualCleanup = undefined;
    clearTimeout(visualNotification);
    visualNotification = undefined;
    clearVisual();
  };
  let frameNonce = "";
  let frameVisibilityCleanup: (() => void) | undefined;
  let cleanup: (() => void) | undefined;
  let current: Transition | undefined;
  let target: HTMLElement | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const publish = () => {
    if (!engine || !sessionId) return;
    api.runtime
      .sendMessage({ type: "SESSION_UPDATE", sessionId, view: engine.view })
      .catch(() => {});
  };
  const clear = () => {
    overlay.clear();
    target = undefined;
    current = undefined;
  };
  const teardown = () => {
    cleanup?.();
    cleanup = undefined;
    clearTimeout(timer);
    timer = undefined;
    clear();
    document.removeEventListener("click", clicked, true);
  };
  const display = (transition: Transition | undefined) => {
    if (!engine) return;
    clear();
    if (transition) {
      const result = adapter.locate(transition.target);
      engine.view.diagnostics!.target = {
        ...result,
        candidates: result.candidates.slice(0, 50),
      };
      if (!result.id) {
        engine.stop(result.reason);
      } else {
        const element = adapter.elements.get(result.id);
        if (element) {
          current = transition;
          target = element;
          overlay.show(element, engine.view.instruction);
        }
      }
    }
    if (
      ["stopped", "boundary", "completed", "checkpoint"].includes(
        engine.view.status,
      )
    )
      teardown();
    publish();
  };
  const update = () => {
    if (!engine) return;
    const next = engine.update(adapter.snapshot());
    if (engine.view.status === "waiting") {
      overlay.clear();
      publish();
      return;
    }
    clearTimeout(timer);
    timer = undefined;
    display(next);
  };
  const clicked = (event: MouseEvent) => {
    if (
      !engine ||
      !current ||
      !target ||
      !(event.target instanceof Node) ||
      !target.contains(event.target)
    )
      return;
    const fresh = adapter.locate(current.target);
    engine.view.diagnostics!.target = {
      ...fresh,
      candidates: fresh.candidates.slice(0, 50),
    };
    if (!fresh.id || adapter.elements.get(fresh.id) !== target) {
      engine.stop("The target changed. Start again after checking the page.");
      teardown();
      publish();
      return;
    }
    const step = current;
    engine.wait(step);
    clear();
    publish();
    clearTimeout(timer);
    timer = setTimeout(() => {
      if (engine) display(engine.timeout(adapter.snapshot()));
    }, step.timeoutMs);
  };
  const observe = () => {
    cleanup = adapter.observe(update);
    document.addEventListener("click", clicked, true);
  };
  api.runtime.onMessage.addListener((raw, sender, respond) => {
    if (sender.id !== api.runtime.id) return;
    if (raw.sessionId === sessionId && raw.type === "MOUNT_WIDGET") {
      void mountWidgetShell(
        raw.url,
        sessionId!,
        raw.bounds,
        raw.visibility,
        raw.phase,
        raw.surface,
        raw.marker,
      ).then(() => respond({ ok: true }));
      return true;
    }
    if (raw.sessionId === sessionId && raw.type === "UPDATE_WIDGET") {
      updateWidgetShell(raw.phase, raw.marker);
      respond({ ok: true });
      return;
    }
    if (raw.sessionId === sessionId && raw.type === "EXPAND_WIDGET") {
      respond({ ok: true, bounds: expandWidgetShell() });
      return;
    }
    if (raw.sessionId === sessionId && raw.type === "LAYOUT_WIDGET") {
      respond({ ok: true, bounds: applyWidgetLayout(raw.action) });
      return;
    }
    if (raw.sessionId === sessionId && raw.type === "PRESENTATION_CHANGED") {
      if (
        typeof raw.visible !== "boolean" ||
        !Number.isInteger(raw.revision) ||
        raw.revision < presentationRevision
      ) {
        respond({ error: "Stale interface presentation." });
        return;
      }
      presentationRevision = raw.revision;
      setGuidanceVisible(raw.visible);
      coach?.presentationChanged(raw.visible);
      if (raw.visible && engine) update();
      respond({ ok: true });
      return;
    }
    if (raw.sessionId === sessionId && raw.type === "MOVE_WIDGET") {
      moveWidgetAside();
      respond({ ok: true });
      return;
    }
    if (raw.sessionId === sessionId && raw.type === "UNMOUNT_WIDGET") {
      unmountWidget();
      respond({ ok: true });
      return;
    }

    if (
      raw.type === "RESTORE_JOURNEY" &&
      raw.sessionId === sessionId &&
      coach
    ) {
      const journey = journeySchema.safeParse(raw.journey),
        request = requestSchema.safeParse(raw.request);
      if (!journey.success || !request.success) {
        respond({ error: "Invalid saved journey." });
        return;
      }
      respond(coach.restoreJourney(journey.data, request.data));
      return;
    }
    if (
      raw.sessionId === sessionId &&
      raw.type === "CONTROL_SESSION" &&
      ["STOP", "PAUSE"].includes(raw.action)
    )
      stopVisual();
    if (raw.sessionId === sessionId && coach) {
      if (raw.type === "RECHECK_JOURNEY") {
        respond(coach.recheckJourney());
        return;
      }
      if (raw.type === "PREPARE_CAPTURE") {
        const metadata = captureMetadata();
        requestAnimationFrame(() =>
          requestAnimationFrame(() => respond(metadata)),
        );
        return true;
      }
      if (raw.type === "RESTORE_CAPTURE") {
        restoreOverlay();
        respond({ viewportRevision: viewportRevision() });
        return;
      }
      if (raw.type === "CHECK_VIEWPORT") {
        respond({ viewportRevision: viewportRevision() });
        return;
      }
      if (raw.type === "SHOW_VISUAL") {
        const action = navigationActionSchema.safeParse(raw.action);
        respond({
          shown:
            action.success &&
            showVisual(action.data, raw.viewportRevision, raw.capturedAt),
        });
        return;
      }
    }
    const parsed = contentMessageSchema.safeParse(raw);
    if (!parsed.success) return;
    const message = parsed.data;
    if (message.type === "BEGIN_SESSION") {
      const route = routeRegistry.get(message.routeId, message.routeVersion);
      const dynamic =
        message.routeId === LIVE_ROUTE_ID &&
        message.routeVersion === LIVE_VERSION;
      if (!dynamic && (!route || !allowedOrigin(route, location.origin))) {
        respond({
          error: "Route is unavailable or unsupported on this origin.",
        });
        return;
      }
      teardown();
      stopVisual();
      coach?.unload();
      coach = undefined;
      engine = undefined;
      sessionId = message.sessionId;
      presentationRevision = Number.isInteger(raw.presentationRevision)
        ? raw.presentationRevision
        : 0;
      setGuidanceVisible(raw.presentationVisible !== false);
      if (dynamic) {
        coach = new PageCoach(
          (view, observed, navigation) => {
            api.runtime
              .sendMessage({
                type: "SESSION_UPDATE",
                sessionId,
                view,
                observed,
                navigation,
              })
              .catch(() => {});
          },
          message.verifiedSteps,
          message.memory as SiteMemory | undefined,
          message.goalPlan,
          message.liveDiagnostics,
          message.navigationVerified,
          message.journey,
          message.savedTask,
          message.navigationEvidence,
          message.request,
          async (request, page, verifiedDestination) => {
            return api.runtime.sendMessage({
              type: "NLP_REPLAN",
              sessionId,
              request,
              page,
              verifiedDestination,
            });
          },
        );
        observeVisual();
        respond({ view: coach.start() });
        return;
      }
      adapter = new BrowserAdapter(route);
      engine = new RouteEngine(route!);
      observe();
      display(engine.start(adapter.snapshot()));
    } else {
      if ((!engine && !coach) || message.sessionId !== sessionId) {
        respond({ error: "Stale session command." });
        return;
      }
      if (message.type === "GUIDE_CONTROL") {
        respond(
          coach
            ? coach.guide(message.controlId)
            : { error: "This task has no page control chooser." },
        );
        return;
      }
      if (message.type === "GET_PAGE") {
        respond({ page: coach?.getPage(message.query), view: coach?.view });
        return;
      }
      if (message.type === "FRAME_ACCESS") {
        frameVisibilityCleanup?.();
        frameNonce = message.nonce;
        frameVisibilityCleanup = frameVisibilityBridge(() =>
          sessionId && frameNonce
            ? { sessionId, nonce: frameNonce }
            : undefined,
        );
        coach?.frameAccess(message.origins, message.limit);
        respond({ ok: true });
        return;
      }
      if (message.type === "FRAME_VISIBILITY_PARENT") {
        coach?.frameVisibility(
          message.frameId,
          message.documentId,
          message.visible,
          message.inViewport,
          message.placement,
        );
        respond({ ok: true });
        return;
      }
      if (message.type === "FRAME_OBSERVATION_PARENT") {
        coach?.frameObservation(
          message.frameId,
          message.documentId,
          message.tabId,
          message.page,
        );
        respond({ ok: true });
        return;
      }
      if (message.type === "FRAME_INTERACTION_PARENT") {
        coach?.frameInteraction(
          {
            frameId: message.frameId,
            documentId: message.documentId,
            tabId: message.tabId,
            controlId: message.controlId,
          },
          message.signature,
          message.verified,
        );
        respond({ ok: true });
        return;
      }
      if (message.type === "WORKFLOW_ACTION") {
        coach?.workflowAction(message.action);
        respond({ view: coach?.view });
        return;
      }
      if (message.type === "WORKFLOW_ENTITY") {
        coach?.setWorkflowEntity(message.entity, message.value);
        respond({ view: coach?.view });
        return;
      }
      if (message.type === "SPA_CHANGED") {
        coach?.getPage();
        respond({ view: coach?.view });
        return;
      }
      if (message.type === "UPDATE_MEMORY") {
        coach?.updateMemory(message.memory as SiteMemory, message.savedTask);
        respond({ ok: true });
        return;
      }
      if (message.type === "SET_GOAL") {
        respond(
          coach
            ? coach.goal(
                message.goal,
                message.revision,
                message.proposal,
                message,
              )
            : { error: "Start live navigation first." },
        );
        return;
      }
      if (message.type === "ASSIST_STEP") {
        respond(
          coach?.assistStep(
            message.controlId,
            message.revision,
            message.requestId,
          ) || { assisted: false },
        );
        return;
      }
      if (message.type === "INSTALL_REQUEST") {
        respond(
          coach?.installRequest(
            message.result,
            message.strategy,
            message.savedRouteId,
          ) || { error: "No live session." },
        );
        return;
      }
      if (message.type === "SKIP_TASK") {
        coach?.skipTask();
        respond({ view: coach?.view });
        return;
      }
      if (coach) {
        if (["PAUSE", "STOP"].includes(message.action)) {
          frameVisibilityCleanup?.();
          frameVisibilityCleanup = undefined;
          frameNonce = "";
        }
        if (message.action === "PAUSE") coach.pause();
        if (message.action === "RESUME") {
          observeVisual();
          coach.resume();
        }
        if (message.action === "STOP") coach.stop();
        respond({ view: coach.view });
        return;
      }
      switch (message.action) {
        case "PAUSE":
          engine!.pause();
          teardown();
          publish();
          break;
        case "RESUME":
          if (["paused", "checkpoint"].includes(engine!.view.status)) {
            teardown();
            observe();
            display(engine!.resume(adapter.snapshot()));
          }
          break;
        case "STOP":
          engine!.stop();
          teardown();
          publish();
          break;
      }
    }
    respond({ view: engine?.view });
  });
  window.addEventListener("pagehide", () => {
    stopVisual();
    if (coach) {
      coach.unload();
      return;
    }
    if (!engine) return;
    if (!["boundary", "completed", "stopped"].includes(engine.view.status))
      engine.stop(
        "Page closed or reloaded. Start again on the current screen.",
      );
    teardown();
    publish();
  });
}
