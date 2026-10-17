import { continuesDestination } from "../../../../packages/navigation-core/queue";
import { hash, supportsLiveUrl } from "../../../../packages/page-model/index";
import { returnFromHandoff } from "../../../../packages/route-registry/handoff";
import {
  sessionLocked,
  type PinnedSession,
} from "../../../../packages/route-registry/session";
import { stopFrames } from "./frame-coordinator";

interface Context {
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>;
  session: PinnedSession | undefined;
  save: () => Promise<void>;
  live: () => boolean;
  ledgerNavigationEvent: boolean;
  startFrames: (current: PinnedSession) => Promise<void>;
  navigationStarts: Map<
    number,
    { sessionId: string; journeyId: string; key: string; at: number }
  >;

  inScope: (url: string) => boolean;
  stopSession: (reason?: string) => Promise<void>;
  attachSession: () => Promise<PinnedSession | undefined>;
  visionJob: AbortController | undefined;
  cancelVision: () => void;
}

export function registerNavigationEvents(context: Context) {
  chrome.tabs.onRemoved.addListener((tabId) => {
    void context.enqueue(async () => {
      if (context.session?.tabId === tabId) {
        if (context.session.handoffReturn) {
          const previous = await chrome.tabs
            .get(context.session.handoffReturn.tabId)
            .catch(() => undefined);
          const returned =
            previous && returnFromHandoff(context.session, tabId, previous);
          if (returned) {
            await stopFrames();
            context.session = returned;
            await context.save();
            return;
          }
        }
        context.session = undefined;
        await context.save();
      }
    });
  });

  chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
    if (
      details.frameId !== 0 ||
      details.tabId !== context.session?.tabId ||
      !context.session?.view ||
      !context.live()
    )
      return;
    context.ledgerNavigationEvent = true;
    void chrome.tabs
      .sendMessage(details.tabId, {
        type: "SPA_CHANGED",
        sessionId: context.session.sessionId,
      })
      .catch(() => {});
  });

  chrome.webNavigation.onCompleted.addListener((details) => {
    if (
      details.frameId === 0 ||
      details.tabId !== context.session?.tabId ||
      !context.live() ||
      context.session?.view?.status !== "running"
    )
      return;
    if (context.session)
      void context.startFrames(context.session).catch(() => {});
  });

  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.frameId !== 0) return;
    void context.enqueue(async () => {
      if (
        !context.session?.view?.journey ||
        !continuesDestination(
          context.session.view.journey,
          context.session.view.request,
        ) ||
        !sessionLocked(context.session) ||
        !["running", "waiting"].includes(context.session.view.status)
      )
        return;
      if (details.tabId !== context.session.tabId) {
        const tab = await chrome.tabs.get(details.tabId).catch(() => undefined);
        if (tab?.openerTabId !== context.session.tabId) return;
      }
      if (!supportsLiveUrl(details.url)) return;
      const url = new URL(details.url),
        key = hash(url.origin + url.pathname + url.search);
      const action = context.session.view.journey.workflow?.pendingAction;
      if (
        !context.session.pendingNavigation &&
        action?.acted &&
        Date.now() - action.startedAt < 120000 &&
        context.session.view.page
      ) {
        context.session.pendingNavigation = {
          from: context.session.view.page.stateKey,
          signature: action.signature,
          label: action.label,
          destinationKey: hash(url.origin + url.pathname),
          navigationKey: key,
          origin: url.origin,
          kind: "navigation",
          fromOrigin: context.session.origin,
          newTab: details.tabId !== context.session.tabId,
        };
      }
      const existing = context.navigationStarts.get(details.tabId);
      if (
        existing?.sessionId === context.session.sessionId &&
        existing.journeyId === context.session.view.journey.id &&
        details.timeStamp - existing.at < 15000 &&
        context.session.pendingNavigation?.navigationKey === existing.key
      )
        return;
      context.navigationStarts.clear();
      context.navigationStarts.set(details.tabId, {
        sessionId: context.session.sessionId,
        journeyId: context.session.view.journey.id,
        key,
        at: details.timeStamp,
      });
    });
  });

  chrome.webNavigation.onCommitted.addListener((details) => {
    if (details.frameId !== 0) return;
    void context.enqueue(async () => {
      const start = context.navigationStarts.get(details.tabId);
      context.navigationStarts.delete(details.tabId);
      const nav = context.session?.pendingNavigation;
      if (
        !context.session?.view?.journey ||
        (!context.session.view.journey.workflow &&
          !context.session.view.journey.objective.workflow) ||
        !continuesDestination(
          context.session.view.journey,
          context.session.view.request,
        ) ||
        !nav ||
        !start ||
        !sessionLocked(context.session) ||
        start.sessionId !== context.session.sessionId ||
        start.journeyId !== context.session.view.journey.id ||
        start.key !== nav.navigationKey ||
        details.timeStamp - start.at > 15000 ||
        !["link", "form_submit"].includes(details.transitionType) ||
        !details.transitionQualifiers.includes("server_redirect") ||
        details.transitionQualifiers.includes("from_address_bar") ||
        !supportsLiveUrl(details.url)
      )
        return;
      if (details.tabId !== context.session.tabId) {
        const tab = await chrome.tabs.get(details.tabId).catch(() => undefined);
        if (tab?.openerTabId !== context.session.tabId) return;
      }
      const url = new URL(details.url);
      context.session.pendingNavigation = {
        ...nav,
        origin: url.origin,
        destinationKey: hash(url.origin + url.pathname),
        navigationKey: hash(url.origin + url.pathname + url.search),
        redirected: true,
      };
      context.session.navigationPending = true;
      if (
        url.origin !== context.session.origin ||
        details.tabId !== context.session.tabId
      ) {
        context.session.view = {
          ...context.session.view,
          status: "paused",
          page: undefined,
          controls: [],
          selectedControlId: undefined,
          continuationOrigin: url.origin,
          instruction:
            "The account task redirected to another website. Review its address, then allow access to continue the same task.",
        };
      }
      await context.save();
    });
  });

  chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
    if (change.status !== "loading" && change.status !== "complete") return;
    void context.enqueue(async () => {
      if (
        context.session &&
        tabId !== context.session.tabId &&
        change.status === "complete" &&
        tab.openerTabId === context.session.tabId &&
        context.session.view &&
        continuesDestination(
          context.session.view.journey,
          context.session.view.request,
        ) &&
        context.session.pendingNavigation
      ) {
        const url = tab.url && new URL(tab.url),
          nav = context.session.pendingNavigation;
        if (
          nav.newTab &&
          (!url ||
            (url.origin === nav.origin &&
              hash(url.origin + url.pathname + url.search) ===
                nav.navigationKey))
        ) {
          await chrome.tabs
            .sendMessage(context.session.tabId, {
              type: "CONTROL_SESSION",
              sessionId: context.session.sessionId,
              action: "PAUSE",
            })
            .catch(() => {});
          context.session.view = {
            ...context.session.view,
            status: "paused",
            continuationOrigin: nav.origin,
            controls: [],
            selectedControlId: undefined,
            page: undefined,
            instruction:
              "The expected destination opened in a new tab. Switch to that tab and continue your task.",
          };
          context.session.navigationPending = true;
          await context.save();
        }
        return;
      }
      if (
        context.session?.tabId !== tabId ||
        !context.session?.view ||
        !sessionLocked(context.session)
      )
        return;
      if (!context.live()) {
        if (change.status === "loading") {
          context.session.navigationPending = true;
          await context.save();
          return;
        }
        if (!context.session.navigationPending) return;
        try {
          const documents = await chrome.scripting.executeScript({
            target: { tabId },
            func: () => location.origin,
          });
          if (
            documents[0]?.documentId !== context.session.documentId ||
            !context.inScope(tab.url || "")
          ) {
            await context.stopSession(
              "Page navigation interrupted the session. Start again.",
            );
            return;
          }
          context.session.navigationPending = false;
          // Same-document authored routes already publish their observed state.
          // Resuming here could release a login checkpoint or an explicit Pause.
          await context.save();
        } catch {
          await context.stopSession(
            "Page unavailable. Start navigation again.",
          );
        }
        return;
      }
      if (change.status === "loading") {
        context.session.navigationPending = true;
        context.session.view = {
          ...context.session.view,
          status:
            context.session.view.status === "paused" ? "paused" : "waiting",
          controls: [],
          selectedControlId: undefined,
          page: undefined,
          instruction: "Loading the next page…",
        };
        await context.save();
        return;
      }
      if (!context.session.navigationPending) return;
      if (!context.inScope(tab.url || "")) {
        const nav = context.session.pendingNavigation,
          url = tab.url && new URL(tab.url);
        if (
          continuesDestination(
            context.session.view.journey,
            context.session.view.request,
          ) &&
          nav &&
          (!url ||
            (nav.origin === url.origin &&
              hash(url.origin + url.pathname + url.search) ===
                nav.navigationKey))
        ) {
          context.session.view.status = "paused";
          context.session.view.continuationOrigin = nav.origin;
          context.session.view.instruction =
            "Allow access to the expected destination website to check it and continue your task.";
          await context.save();
          return;
        }
        if (context.session.view.journey?.workflow) {
          await stopFrames();
          context.session.view = {
            ...context.session.view,
            status: "paused",
            page: undefined,
            controls: [],
            selectedControlId: undefined,
            instruction:
              "Navigation left the task's website. Return to that website and resume; your objective and details are retained.",
          };
          await context.save();
          return;
        }
        await context.stopSession(
          "You moved to another website. Click the extension icon there and start a new session.",
        );
        return;
      }
      if (context.session.view.status === "paused") return;
      try {
        await context.attachSession();
      } catch {
        await context.stopSession(
          "The new page could not be observed. Click the extension icon and start again.",
        );
      }
    });
  });

  chrome.webNavigation.onBeforeNavigate.addListener((details) => {
    if (details.tabId === context.session?.tabId && context.visionJob)
      context.cancelVision();
  });
}
