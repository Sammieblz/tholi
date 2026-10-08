import { messageSchema } from "../../../packages/route-schema";
import { routeRegistry, previewRoute } from "../../../packages/route-registry";
import {
  restoreSession,
  validPinnedView,
  sessionLocked,
  type PinnedSession,
} from "../../../packages/route-registry/session";
import { allowedOrigin } from "../../../packages/safety-policy";
let session: PinnedSession | undefined;
const ready = chrome.storage.session.get("navigatorSession").then((data) => {
  session = restoreSession(data.navigatorSession);
});
const save = async () => {
  if (session) await chrome.storage.session.set({ navigatorSession: session });
  else await chrome.storage.session.remove("navigatorSession");
};
const activeTab = async () =>
  (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
const originOf = (url?: string) => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
// Serialize mutations. Content responses are synchronous; publications never await the worker.
let queue: Promise<unknown> = ready;
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation);
  queue = next.catch(() => {});
  return next;
}
chrome.runtime.onMessage.addListener((raw, sender, respond) => {
  enqueue(async () => {
    if (sender.id !== chrome.runtime.id) return { error: "Invalid sender." };
    if (raw?.type === "SESSION_UPDATE") {
      const route =
        session && routeRegistry.get(session.routeId, session.routeVersion);
      const view = session && validPinnedView(session, raw.view);
      if (
        !session ||
        !route ||
        !view ||
        raw.sessionId !== session.sessionId ||
        sender.tab?.id !== session.tabId ||
        !allowedOrigin(route, originOf(sender.url) || "")
      )
        return { error: "Stale or invalid session update." };
      session.view = view;
      await save();
      return { ok: true };
    }
    if (sender.url !== chrome.runtime.getURL("sidepanel.html"))
      return { error: "Extension panel required." };
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success) return { error: "Invalid command." };
    const command = parsed.data;
    if (command.type === "GET_SESSION") return session || {};
    if (command.type === "GET_CONTEXT") {
      const tab = await activeTab(),
        origin = originOf(tab?.url);
      const routes = origin
        ? routeRegistry.forOrigin(origin).map(previewRoute)
        : [];
      return {
        tabId: tab?.id,
        origin: routes.length ? origin : undefined,
        routes,
        reason: routes.length
          ? undefined
          : "No supported tasks on this tab. Open a supported website to choose a task.",
        session: session || null,
        sessionRoute: session
          ? routeRegistry.get(session.routeId, session.routeVersion) &&
            previewRoute(
              routeRegistry.get(session.routeId, session.routeVersion)!,
            )
          : undefined,
      };
    }
    if (command.type === "START") {
      const route = routeRegistry.get(command.routeId, command.routeVersion);
      if (!route)
        return {
          error: "This route version is unavailable. Choose a task again.",
        };
      const tab = await activeTab();
      if (tab?.id === undefined)
        return {
          error:
            "No active website tab was found. Select the website tab and try again.",
        };
      if (!tab.url)
        return {
          error:
            "Chrome has not granted access to this tab. Reload the extension and reopen it on the supported website.",
        };
      if (!allowedOrigin(route, originOf(tab.url) || ""))
        return {
          error:
            "The selected task is not supported on this tab. Select the website tab and choose a task again.",
        };
      if (sessionLocked(session))
        return {
          error: "Stop the current navigation before starting another task.",
        };
      if (session) {
        try {
          await chrome.tabs.sendMessage(session.tabId, {
            type: "CONTROL_SESSION",
            sessionId: session.sessionId,
            action: "STOP",
          });
        } catch {}
      }
      session = {
        sessionId: crypto.randomUUID(),
        tabId: tab.id,
        routeId: route.id,
        routeVersion: route.version,
      };
      await save();
      try {
        await chrome.scripting.executeScript({
          target: { tabId: tab.id },
          files: ["content.js"],
        });
        const reply = await chrome.tabs.sendMessage(tab.id, {
          type: "BEGIN_SESSION",
          sessionId: session.sessionId,
          routeId: route.id,
          routeVersion: route.version,
        });
        const view = validPinnedView(session, reply?.view);
        if (!view)
          throw new Error(
            reply?.error || "The website did not return a valid route session.",
          );
        session.view = view;
        await save();
        return session;
      } catch (error) {
        session = undefined;
        await save();
        return {
          error:
            error instanceof Error
              ? error.message
              : "Navigation could not start.",
        };
      }
    }
    if (!session)
      return command.type === "STOP"
        ? {}
        : { error: "Start navigation first." };
    const tab = await activeTab();
    if (command.type === "RESUME" && tab?.id !== session.tabId)
      return {
        error: "Return to the tab where this task started before resuming.",
      };
    try {
      const reply = await chrome.tabs.sendMessage(session.tabId, {
        type: "CONTROL_SESSION",
        sessionId: session.sessionId,
        action: command.type,
      });
      const view = validPinnedView(session, reply?.view);
      if (!view) throw new Error("Invalid session response.");
      session.view = view;
      await save();
      return session;
    } catch {
      if (session.view) {
        session.view = {
          ...session.view,
          status: "stopped",
          instruction: "Page reloaded or unavailable. Start navigation again.",
        };
        await save();
      } else {
        session = undefined;
        await save();
      }
      return command.type === "STOP"
        ? session || {}
        : {
            error:
              "Page unavailable. Select the supported tab and start again.",
          };
    }
  })
    .then(respond)
    .catch((error) =>
      respond({
        error:
          error instanceof Error ? error.message : "Navigation command failed.",
      }),
    );
  return true;
});
chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => {
    if (session?.tabId === tabId) {
      session = undefined;
      await save();
    }
  });
});
chrome.tabs.onUpdated.addListener((tabId, change) => {
  if (change.status === "loading")
    void enqueue(async () => {
      if (session?.tabId === tabId && session.view && sessionLocked(session)) {
        session.view = {
          ...session.view,
          status: "stopped",
          instruction: "Page navigation interrupted the session. Start again.",
        };
        await save();
      }
    });
});
