import { requireNavigationCapabilities } from "../platform/capabilities";
import { api, type Tabs } from "../platform/api";
import type { SavedTask } from "../../../../packages/page-model/index";
import {
  contextualTask,
  taskKey,
} from "../../../../packages/goal-planner/task-journey";
import { appendLedger } from "../../../../packages/navigation-core/continuity";
import { advanceQueue } from "../../../../packages/navigation-core/queue";
import {
  hash,
  LIVE_ROUTE_ID,
  LIVE_VERSION,
  supportsLiveUrl,
  type SiteMemory,
} from "../../../../packages/page-model/index";
import { routeRegistry } from "../../../../packages/route-registry/index";
import {
  validPinnedView,
  sessionLocked,
  type PinnedSession,
} from "../../../../packages/route-registry/session";
import { routeSupportsUrl } from "../../../../packages/safety-policy/index";
import { cancelNlp } from "../inference/client";
import { cancelBackendPlanning } from "../platform/backend-client";
import {
  startFrames as observeFrames,
  setFramePresentation,
  stopFrames,
} from "./frame-coordinator";
import { getSurfacePresentation } from "./ui-transport";

interface Context {
  session: PinnedSession | undefined;
  activeTab: () => Promise<Tabs.Tab>;
  lastObservation: string;
  live: () => boolean;
  originOf: (url?: string) => string | undefined;
  ledgerNavigationEvent: boolean;
  refreshMemory: (origin: string) => void;
  remember: (observed?: unknown) => Promise<void>;
  save: () => Promise<void>;
  knownSites: Map<string, SiteMemory | undefined>;
  knownTasks: Map<string, SavedTask[]>;
  navigationStarts: Map<
    number,
    { sessionId: string; journeyId: string; key: string; at: number }
  >;
}

export function createSessionService(context: Context) {
  function inScope(url: string) {
    return (
      !!context.session &&
      (context.live()
        ? supportsLiveUrl(url) &&
          context.originOf(url) === context.session.origin
        : routeSupportsUrl(
            routeRegistry.get(
              context.session.routeId,
              context.session.routeVersion,
            )!,
            url,
          ))
    );
  }

  async function acceptView(raw: unknown) {
    if (!context.session) throw new Error("No active session.");
    const view = validPinnedView(context.session, raw);
    if (!view) throw new Error("The website did not return a valid session.");
    view.memory = context.session.view?.memory;
    view.memoryError = context.session.view?.memoryError;
    context.session.view = view;
    if (view.page && context.session.documentId)
      context.session.ledger = appendLedger(
        context.session.ledger || [],
        view.page,
        context.session.tabId,
        context.session.documentId,
        context.ledgerNavigationEvent,
      );
    context.ledgerNavigationEvent = false;
  }

  async function attachSession() {
    if (!context.session) throw new Error("No pinned session.");
    const uiPresentation = await getSurfacePresentation(context.session);
    if (context.live()) context.refreshMemory(context.session.origin!);
    const previousDocument = context.session.documentId;
    const injected = await api.scripting.executeScript({
      target: { tabId: context.session.tabId },
      files: ["content.js"],
    });
    if (!injected[0]?.documentId)
      throw Error("This browser lacks required native document identity.");
    context.session.documentId = injected[0].documentId;
    context.session.navigationPending = false;
    if (
      context.live() &&
      previousDocument &&
      previousDocument === context.session.documentId
    ) {
      await api.tabs.sendMessage(context.session.tabId, {
        type: "CONTROL_SESSION",
        sessionId: context.session.sessionId,
        action: "RESUME",
      });
      const reply = await api.tabs.sendMessage(context.session.tabId, {
        type: "GET_PAGE",
        sessionId: context.session.sessionId,
      });
      await acceptView(reply.view);
      context.session.pendingNavigation = undefined;
      await context.remember();
      await context.save();
      void startFrames(context.session).catch(() => {});
      return context.session;
    }
    const navigation = context.session.pendingNavigation;
    const tab = navigation && (await api.tabs.get(context.session.tabId)),
      url = tab?.url && new URL(tab.url);
    const verified = !!(
      navigation &&
      url &&
      navigation.origin === url.origin &&
      hash(url.origin + url.pathname + url.search) === navigation.navigationKey
    );
    if (verified && context.session.view) {
      context.session.view.verifiedSteps++;
      if (
        !contextualTask(context.session.view.journey) &&
        context.session.view.request?.tasks[context.session.view.request.active]
          ?.operation !== "search" &&
        context.session.view.goalPlan?.status === "guiding" &&
        context.session.view.goalPlan.steps.length <= 1 &&
        !context.session.view.goalPlan.exploration &&
        context.session.view.goalPlan.source !== "memory"
      )
        context.session.view.goalPlan = {
          ...context.session.view.goalPlan,
          status: "completed",
          steps: [],
          reason: "The linked destination loaded and was observed.",
        };
      if (
        context.session.view.request &&
        context.session.view.goalPlan?.status === "completed"
      )
        context.session.view.request = advanceQueue(
          context.session.view.request,
          "verified",
        );
    }
    context.session.pendingNavigation = undefined;
    const reply = await api.tabs.sendMessage(context.session.tabId, {
      type: "BEGIN_SESSION",
      sessionId: context.session.sessionId,
      presentationVisible: uiPresentation?.visibility !== "launcher",
      presentationRevision: uiPresentation?.revision || 0,
      routeId: context.session.routeId,
      routeVersion: context.session.routeVersion,
      verifiedSteps: context.session.view?.verifiedSteps || 0,
      ...(context.live()
        ? {
            memory: context.knownSites.get(context.session.origin!),
            goalPlan: context.session.view?.goalPlan,
            journey: context.session.view?.journey,
            request: context.session.view?.request,
            savedTask: context.session.view?.journey
              ? (
                  context.knownTasks.get(context.session.view.journey.origin) ||
                  []
                ).find(
                  (t) =>
                    t.id ===
                    (context.session!.view!.journey!.savedRouteId ||
                      taskKey(context.session!.view!.journey!)),
                )
              : undefined,
            liveDiagnostics: context.session.view?.liveDiagnostics,
            navigationVerified: verified,
            navigationEvidence: verified ? navigation : undefined,
          }
        : {}),
    });
    const freshPresentation = await getSurfacePresentation(context.session);
    if (freshPresentation !== uiPresentation)
      await api.tabs
        .sendMessage(
          context.session.tabId,
          {
            type: "PRESENTATION_CHANGED",
            sessionId: context.session.sessionId,
            visible: freshPresentation?.visibility !== "launcher",
            revision: freshPresentation?.revision || 0,
          },
          { frameId: 0 },
        )
        .catch(() => {});
    await acceptView(reply?.view);
    if (verified && navigation && context.session.view?.page)
      await context.remember({
        from: navigation.from,
        to: context.session.view.page.stateKey,
        signature: navigation.signature,
        label: navigation.label,
        durationMs: navigation.durationMs,
      });
    else await context.remember();
    await context.save();
    if (context.live()) void startFrames(context.session).catch(() => {});
    return context.session;
  }

  async function startFrames(current: PinnedSession) {
    const presentation = await getSurfacePresentation(current);
    await observeFrames(
      current,
      presentation?.visibility !== "launcher",
      presentation?.revision || 0,
    );
    const fresh = await getSurfacePresentation(current);
    if (fresh !== presentation)
      await setFramePresentation(
        current,
        fresh?.visibility !== "launcher",
        fresh?.revision || 0,
      );
  }

  async function stopSession(reason = "Navigation stopped.") {
    await stopFrames();
    cancelBackendPlanning();
    await cancelNlp();
    context.navigationStarts.clear();
    if (!context.session) return;
    try {
      const reply = await api.tabs.sendMessage(context.session.tabId, {
        type: "CONTROL_SESSION",
        sessionId: context.session.sessionId,
        action: "STOP",
      });
      if (reply?.view) await acceptView(reply.view);
    } catch {}
    if (context.session.view)
      context.session.view = {
        ...context.session.view,
        status: "stopped",
        controls: context.session.view.controls ? [] : undefined,
        selectedControlId: undefined,
        page: undefined,
        instruction: reason,
      };
    context.session.navigationPending = false;
    context.session.pendingNavigation = undefined;
    await context.save();
  }
  async function startSession(command: {
    routeId: string;
    routeVersion: string;
    tabId?: number;
    origin?: string;
  }) {
    const dynamic =
        command.routeId === LIVE_ROUTE_ID &&
        command.routeVersion === LIVE_VERSION,
      route = routeRegistry.get(command.routeId, command.routeVersion);
    if (!dynamic && !route)
      return {
        error: "This route version is unavailable. Choose a task again.",
      };
    await requireNavigationCapabilities();
    const tab = await context.activeTab();
    if (tab?.id === undefined || !supportsLiveUrl(tab.url || ""))
      return {
        error:
          "Select a website tab and click the extension icon to grant access.",
      };
    if (
      (command.tabId !== undefined && command.tabId !== tab.id) ||
      (command.origin && command.origin !== context.originOf(tab.url))
    )
      return {
        error:
          "The tab changed while granting access. Start navigation on the current website again.",
      };
    if (!dynamic && !routeSupportsUrl(route!, tab.url!))
      return {
        error: "The selected task is unavailable on this website.",
      };
    if (sessionLocked(context.session))
      return {
        error: "Stop the current navigation before starting another task.",
      };
    await stopSession();
    context.session = {
      sessionId: crypto.randomUUID(),
      tabId: tab.id,
      routeId: command.routeId,
      routeVersion: command.routeVersion,
      origin: context.originOf(tab.url),
    };
    context.lastObservation = "";
    await context.save();
    try {
      return await attachSession();
    } catch (error) {
      context.session = undefined;
      await context.save();
      return {
        error:
          "Tholi could not access this page. Click its toolbar icon on the website, refresh the page, then try again. If your browser asks for this site's access, allow it to continue. Browser pages and documents without HTML controls are unsupported.",
      };
    }
  }
  return {
    inScope,
    acceptView,
    attachSession,
    startFrames,
    stopSession,
    startSession,
  };
}
