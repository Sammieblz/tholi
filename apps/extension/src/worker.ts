import { messageSchema } from "../../../packages/route-schema";
import { routeRegistry, previewRoute } from "../../../packages/route-registry";
import {
  restoreSession,
  validPinnedView,
  sessionLocked,
  sessionSchema,
  type PinnedSession,
} from "../../../packages/route-registry/session";
import { routeSupportsUrl } from "../../../packages/safety-policy";
import {
  LIVE_ROUTE_ID,
  LIVE_VERSION,
  supportsLiveUrl,
  livePreview,
  transitionEvidenceSchema,
  hash,
} from "../../../packages/page-model";
import { saveTask, taskKey } from "../../../packages/goal-planner/task-journey";
import {
  IndexedDBSiteMemory,
  memorySummary,
} from "../../../packages/site-memory";
let session: PinnedSession | undefined;
const memory = new IndexedDBSiteMemory();
let lastObservation = "";
const ready = chrome.storage.session.get("navigatorSession").then((data) => {
  session = restoreSession(data.navigatorSession);
});
const save = async () => {
  if (session) await chrome.storage.session.set({ navigatorSession: session });
  else await chrome.storage.session.remove("navigatorSession");
};
const live = () => session?.routeId === LIVE_ROUTE_ID;
const activeTab = async () =>
  (await chrome.tabs.query({ active: true, lastFocusedWindow: true }))[0];
const originOf = (url?: string) => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};
function inScope(url: string) {
  return (
    !!session &&
    (live()
      ? supportsLiveUrl(url) && originOf(url) === session.origin
      : routeSupportsUrl(
          routeRegistry.get(session.routeId, session.routeVersion)!,
          url,
        ))
  );
}
async function remember(observed?: unknown) {
  if (!session?.view?.page || !live()) return;
  const page = session.view.page,
    evidence = transitionEvidenceSchema.safeParse(observed);
  const key =
    session.documentId +
    ":" +
    page.stateKey +
    ":" +
    (session.view.journey
      ? session.view.journey.id +
        ":" +
        session.view.journey.progress.length +
        ":" +
        session.view.journey.status
      : "") +
    ":" +
    hash(JSON.stringify(session.view.goalPlan) || "");
  if (lastObservation === key && !evidence.success) return;
  try {
    const site = await memory.observe(
      page,
      evidence.success ? evidence.data : undefined,
    );
    session.view.memory = memorySummary(site);
    session.view.memoryError = undefined;
    const journey = session.view.journey;
    let savedTask;
    if (journey) {
      savedTask = (await memory.tasks(journey.origin)).find(
        (t) => t.id === (journey.savedRouteId || taskKey(journey)),
      );
      // A draft does not replace a previously successful route's observations.
      if (
        !session.forgottenTaskIds?.includes(taskKey(journey)) &&
        (!savedTask?.completed || journey.status === "completed")
      )
        await memory.saveTask(saveTask(journey, page, session.view.goalPlan));
    }
    lastObservation = key;
    await chrome.tabs
      .sendMessage(session.tabId, {
        type: "UPDATE_MEMORY",
        sessionId: session.sessionId,
        memory: site,
        savedTask,
      })
      .catch(() => {});
  } catch {
    session.view.memoryError =
      "Site memory could not be saved. Live guidance remains available.";
  }
}
async function acceptView(raw: unknown) {
  if (!session) throw new Error("No active session.");
  const view = validPinnedView(session, raw);
  if (!view) throw new Error("The website did not return a valid session.");
  view.memory = session.view?.memory;
  view.memoryError = session.view?.memoryError;
  session.view = view;
}
async function attachSession() {
  if (!session) throw new Error("No pinned session.");
  const previousDocument = session.documentId;
  const injected = await chrome.scripting.executeScript({
    target: { tabId: session.tabId },
    files: ["content.js"],
  });
  session.documentId = injected[0]?.documentId;
  session.navigationPending = false;
  if (live() && previousDocument && previousDocument === session.documentId) {
    await chrome.tabs.sendMessage(session.tabId, {
      type: "CONTROL_SESSION",
      sessionId: session.sessionId,
      action: "RESUME",
    });
    const reply = await chrome.tabs.sendMessage(session.tabId, {
      type: "GET_PAGE",
      sessionId: session.sessionId,
    });
    await acceptView(reply.view);
    session.pendingNavigation = undefined;
    await remember();
    await save();
    return session;
  }
  const navigation = session.pendingNavigation;
  const tab = navigation && (await chrome.tabs.get(session.tabId)),
    url = tab?.url && new URL(tab.url);
  const verified = !!(
    navigation &&
    url &&
    navigation.origin === url.origin &&
    hash(url.origin + url.pathname + url.search) === navigation.navigationKey
  );
  if (verified && session.view) {
    session.view.verifiedSteps++;
    if (
      !session.view.journey?.objective.value &&
      session.view.goalPlan?.status === "guiding" &&
      session.view.goalPlan.steps.length <= 1 &&
      session.view.goalPlan.source !== "memory"
    )
      session.view.goalPlan = {
        ...session.view.goalPlan,
        status: "completed",
        steps: [],
        reason: "The linked destination loaded and was observed.",
      };
  }
  session.pendingNavigation = undefined;
  const reply = await chrome.tabs.sendMessage(session.tabId, {
    type: "BEGIN_SESSION",
    sessionId: session.sessionId,
    routeId: session.routeId,
    routeVersion: session.routeVersion,
    verifiedSteps: session.view?.verifiedSteps || 0,
    ...(live()
      ? {
          memory: await memory.get(session.origin!).catch(() => undefined),
          goalPlan: session.view?.goalPlan,
          journey: session.view?.journey,
          savedTask: session.view?.journey
            ? (await memory.tasks(session.view.journey.origin)).find(
                (t) =>
                  t.id ===
                  (session!.view!.journey!.savedRouteId ||
                    taskKey(session!.view!.journey!)),
              )
            : undefined,
          liveDiagnostics: session.view?.liveDiagnostics,
          navigationVerified: verified,
          navigationEvidence: verified ? navigation : undefined,
        }
      : {}),
  });
  await acceptView(reply?.view);
  if (verified && navigation && session.view?.page)
    await remember({
      from: navigation.from,
      to: session.view.page.stateKey,
      signature: navigation.signature,
      label: navigation.label,
      durationMs: navigation.durationMs,
    });
  else await remember();
  await save();
  return session;
}
async function stopSession(reason = "Navigation stopped.") {
  if (!session) return;
  try {
    const reply = await chrome.tabs.sendMessage(session.tabId, {
      type: "CONTROL_SESSION",
      sessionId: session.sessionId,
      action: "STOP",
    });
    if (reply?.view) await acceptView(reply.view);
  } catch {}
  if (session.view)
    session.view = {
      ...session.view,
      status: "stopped",
      controls: session.view.controls ? [] : undefined,
      selectedControlId: undefined,
      page: undefined,
      instruction: reason,
    };
  session.navigationPending = false;
  session.pendingNavigation = undefined;
  await save();
}
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch(() => {});
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
      if (
        !session ||
        raw.sessionId !== session.sessionId ||
        sender.tab?.id !== session.tabId ||
        sender.documentId !== session.documentId ||
        !inScope(sender.url || "")
      )
        return { error: "Stale or invalid session update." };
      if (
        session.view?.status === "stopped" ||
        (session.view?.status === "paused" && raw.view?.status === "running")
      )
        return { error: "Inactive session update." };
      const incoming = validPinnedView(session, raw.view);
      if (!incoming) return { error: "Invalid page observation." };
      if (raw.navigation) {
        const nav = sessionSchema.shape.pendingNavigation.safeParse(
            raw.navigation,
          ),
          selectedId = incoming.selectedControlId,
          control = incoming.controls?.find((c) => c.id === selectedId);
        if (
          nav.success &&
          control?.kind === "navigation" &&
          nav.data?.signature === control.signature &&
          nav.data.destinationKey === control.destination?.key
        )
          session.pendingNavigation = nav.data;
      }
      // A click publication may arrive after Chrome's loading event. Preserve its intent
      // without restoring the previous document's running state or controls.
      if (session.navigationPending) {
        await save();
        return { ok: true };
      }
      await acceptView(incoming);
      if (
        !incoming.selectedControlId &&
        (incoming.stateId === "verified" ||
          (incoming.status === "running" &&
            incoming.goalPlan?.status === "unresolved"))
      )
        session.pendingNavigation = undefined;
      await remember(raw.observed);
      await save();
      return { ok: true };
    }
    if (sender.url !== chrome.runtime.getURL("sidepanel.html"))
      return { error: "Extension panel required." };
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success) return { error: "Invalid command." };
    const command = parsed.data;
    if (command.type === "GET_SESSION") return session || {};
    if (command.type === "GET_TASKS" || command.type === "DELETE_TASK") {
      const tab = await activeTab(),
        origin = originOf(tab?.url);
      if (!origin) return { tasks: [] };
      if (command.type === "DELETE_TASK") {
        if ((await memory.tasks(origin)).some((t) => t.id === command.id)) {
          await memory.deleteTask(command.id);
          if (session) {
            session.forgottenTaskIds = [
              ...new Set([...(session.forgottenTaskIds || []), command.id]),
            ].slice(-100);
            await save();
          }
        }
      }
      return { tasks: await memory.tasks(origin) };
    }
    if (command.type === "GET_CONTEXT") {
      const tab = await activeTab(),
        origin = originOf(tab?.url),
        available = supportsLiveUrl(tab?.url || ""),
        continuation = session?.view?.continuationOrigin
          ? session.pendingNavigation
          : undefined,
        currentURL = tab?.url && new URL(tab.url);
      const routes = available
        ? [
            ...routeRegistry.forUrl(tab.url!).map(previewRoute),
            livePreview(origin!),
          ]
        : [];
      return {
        tabId: tab?.id,
        origin: available ? origin : undefined,
        canContinueTask: !!(
          continuation &&
          session &&
          tab?.id &&
          (tab.id === session.tabId || tab.openerTabId === session.tabId) &&
          (!currentURL ||
            (origin === continuation.origin &&
              hash(
                currentURL.origin + currentURL.pathname + currentURL.search,
              ) === continuation.navigationKey))
        ),
        routes,
        reason: available
          ? undefined
          : "Open an HTTP or HTTPS website and click the extension icon to grant access.",
        session: session || null,
        sessionRoute: session
          ? live()
            ? livePreview(session.origin!)
            : previewRoute(
                routeRegistry.get(session.routeId, session.routeVersion)!,
              )
          : undefined,
      };
    }
    if (
      command.type === "GET_MEMORY" ||
      command.type === "FORGET_SITE" ||
      command.type === "CLEAR_MEMORY"
    ) {
      const tab = await activeTab(),
        origin = originOf(tab?.url) || session?.origin;
      if (command.type !== "GET_MEMORY") {
        if (
          live() &&
          (command.type === "CLEAR_MEMORY" || origin === session?.origin)
        )
          await stopSession(
            "Site memory cleared. Start navigation to learn this page again.",
          );
        command.type === "CLEAR_MEMORY"
          ? await memory.clear()
          : origin && (await memory.forget(origin));
        lastObservation = "";
        if (session?.view && live()) {
          session.view.memory = memorySummary();
          session.view.goalPlan = undefined;
          session.view.journey = undefined;
          await save();
        }
      }
      return {
        origin,
        memory: origin ? await memory.get(origin) : undefined,
        view: session?.view,
      };
    }
    if (command.type === "START") {
      const dynamic =
          command.routeId === LIVE_ROUTE_ID &&
          command.routeVersion === LIVE_VERSION,
        route = routeRegistry.get(command.routeId, command.routeVersion);
      if (!dynamic && !route)
        return {
          error: "This route version is unavailable. Choose a task again.",
        };
      const tab = await activeTab();
      if (tab?.id === undefined || !supportsLiveUrl(tab.url || ""))
        return {
          error:
            "Select a website tab and click the extension icon to grant access.",
        };
      if (!dynamic && !routeSupportsUrl(route!, tab.url!))
        return { error: "The selected task is unavailable on this website." };
      if (sessionLocked(session))
        return {
          error: "Stop the current navigation before starting another task.",
        };
      await stopSession();
      session = {
        sessionId: crypto.randomUUID(),
        tabId: tab.id,
        routeId: command.routeId,
        routeVersion: command.routeVersion,
        origin: originOf(tab.url),
      };
      lastObservation = "";
      await save();
      try {
        return await attachSession();
      } catch (error) {
        session = undefined;
        await save();
        return {
          error:
            "Navigator could not access this page. Click the extension icon on the website, refresh the page, then Start again. If Chrome asks for this site's access, allow it to continue. Browser pages and documents without HTML controls are unsupported.",
        };
      }
    }
    if (!session)
      return command.type === "STOP"
        ? {}
        : { error: "Start navigation first." };
    if (command.type === "STOP") {
      await stopSession();
      return session;
    }
    const tab = await activeTab();
    if (
      command.type === "CONTINUE_TASK" &&
      session.pendingNavigation &&
      session.view?.journey?.objective.value
    ) {
      const nav = session.pendingNavigation;
      if (
        !tab?.id ||
        (tab.id !== session.tabId && tab.openerTabId !== session.tabId)
      )
        return {
          error:
            "Return to the expected destination tab to continue this task.",
        };
      // Chrome withholds a destination tab's URL until its host access is
      // granted. Request only the clicked link's origin; validate the actual
      // destination after that grant, before observing or advancing the task.
      const expected = new URL(nav.origin);
      const granted = await chrome.permissions.contains({
        origins: [expected.protocol + "//" + expected.hostname + "/*"],
      });
      if (!granted)
        return {
          error:
            "Allow access to this destination website to continue your task.",
        };
      const url = tab.url && new URL(tab.url);
      if (
        !url ||
        hash(url.origin + url.pathname + url.search) !== nav.navigationKey ||
        url.origin !== nav.origin
      )
        return {
          error:
            "Return to the expected destination tab to continue this task.",
        };
      session.tabId = tab.id;
      session.origin = url.origin;
      session.documentId = undefined;
      session.view.continuationOrigin = undefined;
      session.view.status = "running";
      return await attachSession();
    }
    if (command.type !== "PAUSE" && tab?.id !== session.tabId)
      return { error: "Return to the tab where this task started." };
    if (command.type === "RESUME" && session.navigationPending && live()) {
      if (!inScope(tab.url || ""))
        return {
          error:
            "This page is outside the session's website. Start a new session here.",
        };
      return await attachSession();
    }
    if (
      ["GUIDE_CONTROL", "GET_PAGE", "SET_GOAL"].includes(command.type) &&
      (!live() ||
        session.navigationPending ||
        session.view?.status !== "running")
    )
      return {
        error: "Start or resume live navigation on the current page first.",
      };
    const outgoing =
      command.type === "PAUSE" || command.type === "RESUME"
        ? {
            type: "CONTROL_SESSION",
            action: command.type,
            sessionId: session.sessionId,
          }
        : { ...command, sessionId: session.sessionId };
    try {
      const reply = await chrome.tabs.sendMessage(session.tabId, outgoing);
      if (reply?.error) return reply;
      if (command.type === "GET_PAGE")
        return {
          page: reply.page,
          sessionId: session.sessionId,
          documentId: session.documentId,
          journey: session.view?.journey,
        };
      if (
        command.type === "SET_GOAL" &&
        !command.journeyId &&
        session.view?.journey
      )
        session.forgottenTaskIds = session.forgottenTaskIds?.filter(
          (id) => id !== taskKey(session!.view!.journey!),
        );
      await acceptView(reply?.view);
      await remember();
      await save();
      return session;
    } catch {
      await stopSession(
        "Page unavailable. Click the extension icon on the website and start again.",
      );
      return { error: "The website is unavailable. Start navigation again." };
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
chrome.tabs.onUpdated.addListener((tabId, change, tab) => {
  if (change.status !== "loading" && change.status !== "complete") return;
  void enqueue(async () => {
    if (
      session &&
      tabId !== session.tabId &&
      change.status === "complete" &&
      tab.openerTabId === session.tabId &&
      session.view?.journey?.objective.value &&
      session.pendingNavigation
    ) {
      const url = tab.url && new URL(tab.url),
        nav = session.pendingNavigation;
      if (
        !url ||
        (url.origin === nav.origin &&
          hash(url.origin + url.pathname + url.search) === nav.navigationKey)
      ) {
        await chrome.tabs
          .sendMessage(session.tabId, {
            type: "CONTROL_SESSION",
            sessionId: session.sessionId,
            action: "PAUSE",
          })
          .catch(() => {});
        session.view = {
          ...session.view,
          status: "paused",
          continuationOrigin: nav.origin,
          controls: [],
          selectedControlId: undefined,
          page: undefined,
          instruction:
            "The expected destination opened in a new tab. Switch to that tab and continue your task.",
        };
        session.navigationPending = true;
        await save();
      }
      return;
    }
    if (session?.tabId !== tabId || !session?.view || !sessionLocked(session))
      return;
    if (!live()) {
      if (change.status === "loading") {
        session.navigationPending = true;
        await save();
        return;
      }
      if (!session.navigationPending) return;
      try {
        const documents = await chrome.scripting.executeScript({
          target: { tabId },
          func: () => location.origin,
        });
        if (
          documents[0]?.documentId !== session.documentId ||
          !inScope(tab.url || "")
        ) {
          await stopSession(
            "Page navigation interrupted the session. Start again.",
          );
          return;
        }
        session.navigationPending = false;
        const reply = await chrome.tabs.sendMessage(tabId, {
          type: "CONTROL_SESSION",
          sessionId: session.sessionId,
          action: "RESUME",
        });
        await acceptView(reply.view);
        await save();
      } catch {
        await stopSession("Page unavailable. Start navigation again.");
      }
      return;
    }
    if (change.status === "loading") {
      session.navigationPending = true;
      session.view = {
        ...session.view,
        status: session.view.status === "paused" ? "paused" : "waiting",
        controls: [],
        selectedControlId: undefined,
        page: undefined,
        instruction: "Loading the next page…",
      };
      await save();
      return;
    }
    if (!session.navigationPending) return;
    if (!inScope(tab.url || "")) {
      const nav = session.pendingNavigation,
        url = tab.url && new URL(tab.url);
      if (
        session.view.journey?.objective.value &&
        nav &&
        (!url ||
          (nav.origin === url.origin &&
            hash(url.origin + url.pathname + url.search) === nav.navigationKey))
      ) {
        session.view.status = "paused";
        session.view.continuationOrigin = nav.origin;
        session.view.instruction =
          "Allow access to the expected destination website to check it and continue your task.";
        await save();
        return;
      }
      await stopSession(
        "You moved to another website. Click the extension icon there and start a new session.",
      );
      return;
    }
    if (session.view.status === "paused") return;
    try {
      await attachSession();
    } catch {
      await stopSession(
        "The new page could not be observed. Click the extension icon and start again.",
      );
    }
  });
});
