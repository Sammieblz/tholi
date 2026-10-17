import { tabAppearance, validThemeSender } from "./ui/theme/theme-worker";
import {
  trustedUi,
  isWidget,
  isPanel,
  widgetCommands,
  uiMessage,
  invalidateUi,
  mountWidget,
  preferredSurface,
  getSurfacePresentation,
  presentationVisible,
  restoreSurface,
  clearSurfacePresentation,
  watchNativePanels,
} from "./ui-transport";
import { browserOcr } from "./nlp-client";
import { backendOcr } from "./backend-client";
import { recognizeWithFallback } from "../../../packages/vision/processing";
import { needsVision } from "../../../packages/vision/fusion";
import {
  visualObservationSchema,
  type VisualObservation,
} from "../../../packages/vision/contracts";
import {
  appendLedger,
  suspendJourney,
  sameDestination,
  suspendedJourneySchema,
  type SuspendedJourney,
} from "../../../packages/navigation-core/continuity";
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
  type SiteMemory,
  type SavedTask,
} from "../../../packages/page-model";
import {
  saveTask,
  taskKey,
  contextualTask,
  resumeJourney,
} from "../../../packages/goal-planner/task-journey";
import {
  IndexedDBSiteMemory,
  memorySummary,
} from "../../../packages/site-memory";
import { BackgroundMemory } from "../../../packages/site-memory/background";
import { parameterizedTask } from "../../../packages/navigation-core/privacy";
import { localNlp, cancelNlp } from "./nlp-client";
import { interpretRequest } from "../../../packages/nlp/interpret";
import { IndexedDBDerivedStore } from "../../../packages/site-memory/derived";
import {
  planInputSchema,
  resultSchema,
  requestSchema,
  type PlanInput,
} from "../../../packages/navigation-core/contracts";
import {
  advanceQueue,
  continuesDestination,
} from "../../../packages/navigation-core/queue";
import { sanitizeGoal } from "../../../packages/privacy-redaction";
import { returnFromHandoff } from "../../../packages/route-registry/handoff";
import {
  startFrames as observeFrames,
  stopFrames,
  frameMessage,
  routeFrameGuide,
  clearFrames,
  frameVisibilityMessage,
  setFramePresentation,
} from "./frames";
import {
  backendNlp,
  backendSettings,
  setBackendSettings,
  deleteBackendMemory,
  mirrorRoute,
  cancelBackendPlanning,
} from "./backend-client";
let session: PinnedSession | undefined;
let suspended: SuspendedJourney[] = [];
const memory = new IndexedDBSiteMemory();
const memoryJobs = new BackgroundMemory();
const knownSites = new Map<string, SiteMemory | undefined>();
const knownTasks = new Map<string, SavedTask[]>();
let memoryEpoch = 0;
function cacheMemory(
  origin: string,
  site: SiteMemory | undefined,
  tasks: SavedTask[],
) {
  knownSites.set(origin, site);
  knownTasks.set(origin, tasks);
  while (knownSites.size > 50) {
    const oldest = knownSites.keys().next().value!;
    knownSites.delete(oldest);
    knownTasks.delete(oldest);
  }
}
function refreshMemory(origin: string) {
  memoryJobs.schedule("read:" + origin, async () => {
    const site = await memory.get(origin);
    const tasks = await memory.tasks(origin);
    cacheMemory(origin, site, tasks);
  });
}
let lastObservation = "";
let ledgerNavigationEvent = false;
let goalGeneration = 0;
let visionJob: AbortController | undefined;
let lastCapture = 0;
let lastVisionKey = "";

function cancelVision() {
  visionJob?.abort();
  visionJob = undefined;
  lastVisionKey = "";
  void chrome.runtime
    .sendMessage({ target: "offscreen", type: "CANCEL_OCR" })
    .catch(() => {});
}
async function attemptVision(sessionId: string, requestId: string) {
  if (
    visionJob ||
    !session ||
    session.sessionId !== sessionId ||
    session.view?.request?.id !== requestId ||
    !session.view.journey ||
    !session.view.page ||
    session.view.status !== "running" ||
    session.view.journey.workflow?.status === "review" ||
    (session.view.goalPlan?.recoveryStage &&
      session.view.goalPlan.recoveryStage !== "vision") ||
    !needsVision(session.view.goalPlan, !!session.view.clarification)
  )
    return;
  const candidate = session;
  if (!(await presentationVisible(candidate)) || session !== candidate) return;
  const captured = structuredClone(session),
    view = captured.view!;
  const controller = new AbortController();
  visionJob = controller;
  const generation = goalGeneration;
  try {
    const tab = await activeTab();
    if (
      tab?.id !== captured.tabId ||
      !supportsLiveUrl(tab.url || "") ||
      originOf(tab.url) !== captured.origin
    )
      return;
    const metadata = await chrome.tabs.sendMessage(captured.tabId, {
      type: "PREPARE_CAPTURE",
      sessionId,
    });
    if (!metadata?.width || !metadata?.height) return;
    const key = [
      requestId,
      captured.documentId,
      view.page!.revision,
      metadata.viewportRevision,
    ].join(":");
    if (lastVisionKey === key) return;
    if (Date.now() - lastCapture < 2000) {
      setTimeout(
        () => void attemptVision(sessionId, requestId),
        2000 - (Date.now() - lastCapture),
      );
      return;
    }
    lastCapture = Date.now();
    lastVisionKey = key;
    const image = await chrome.tabs.captureVisibleTab(tab.windowId, {
      format: "png",
    });
    controller.signal.throwIfAborted();
    const afterTab = await activeTab();
    if (afterTab?.id !== tab.id || afterTab.url !== tab.url) return;
    const stamp = {
      requestId,
      journeyId: view.journey!.id,
      contextRevision: view.journey!.workflow?.revision || 0,
      documentId: captured.documentId!,
      observationRevision: view.page!.revision,
      viewportRevision: metadata.viewportRevision,
      captureId: crypto.randomUUID(),
    };
    const settings = (await chrome.storage.local.get("vision")).vision;
    const value = await recognizeWithFallback(
      { image, metadata, stamp },
      { browser: browserOcr, backend: backendOcr },
      !!settings?.backend,
      controller.signal,
    );
    controller.signal.throwIfAborted();
    const observation = visualObservationSchema.parse(value);
    if (
      Object.entries(stamp).some(
        ([k, v]) => observation[k as keyof VisualObservation] !== v,
      )
    )
      return;
    const viewport = await chrome.tabs.sendMessage(captured.tabId, {
      type: "CHECK_VIEWPORT",
      sessionId,
    });
    const fresh = await chrome.tabs.sendMessage(captured.tabId, {
      type: "GET_PAGE",
      sessionId,
    });
    if (
      generation !== goalGeneration ||
      session?.documentId !== stamp.documentId ||
      session.view?.request?.id !== requestId ||
      fresh.page?.revision !== stamp.observationRevision ||
      viewport.viewportRevision !== stamp.viewportRevision ||
      fresh.view?.journey?.id !== stamp.journeyId ||
      (fresh.view.journey.workflow?.revision || 0) !== stamp.contextRevision ||
      fresh.view.status !== "running" ||
      !needsVision(fresh.view.goalPlan, !!fresh.view.clarification)
    )
      return;

    const visualInput = planInputSchema.parse({
      requestId,
      documentId: stamp.documentId,
      revision: stamp.observationRevision,
      text: view.request!.original,
      observation: fresh.page,
      request: fresh.view.request,
      journey: fresh.view.journey,
      workflow: fresh.view.journey.workflow,
      contextRevision: stamp.contextRevision,
      protocolVersion: 2,
      strategy: fresh.view.journey.strategy,
      tabId: captured.tabId,
      visualObservation: observation,
    });
    const interpreted = resultSchema.parse(
      await localNlp(visualInput, knownSites.get(captured.origin!)),
    );
    controller.signal.throwIfAborted();
    const currentViewport = await chrome.tabs.sendMessage(captured.tabId, {
      type: "CHECK_VIEWPORT",
      sessionId,
    });
    if (
      currentViewport.viewportRevision !== stamp.viewportRevision ||
      session?.view?.request?.id !== requestId ||
      session.view.page?.revision !== stamp.observationRevision
    )
      return;
    const plan = interpreted.plan;
    if (!plan) {
      session.view!.instruction =
        "Visual assistance did not identify an unambiguous target. Your destination remains active.";
      await save();
      return;
    }
    if (plan.action?.kind === "visual") {
      const delay = Math.max(0, 2000 - (Date.now() - lastCapture));
      if (delay)
        await new Promise<void>((resolve) => setTimeout(resolve, delay));
      controller.signal.throwIfAborted();
      const active = await activeTab();
      if (active?.id !== captured.tabId || active.url !== tab.url) return;
      lastCapture = Date.now();
      const currentImage = await chrome.tabs.captureVisibleTab(
        active.windowId,
        { format: "png" },
      );
      const checked = await browserOcr({
        image: currentImage,
        referenceImage: image,
        metadata,
        stamp,
        compareRegion: plan.action.box,
      });
      controller.signal.throwIfAborted();
      if (!checked.matches) {
        lastVisionKey = "";
        return;
      }
      const shown = await chrome.tabs.sendMessage(captured.tabId, {
        type: "SHOW_VISUAL",
        sessionId,
        action: plan.action,
        viewportRevision: metadata.viewportRevision,
        capturedAt: metadata.at,
      });
      if (!shown.shown) return;
    }
    const result = interpreted;
    const reply = await chrome.tabs.sendMessage(captured.tabId, {
      type: "INSTALL_REQUEST",
      sessionId,
      result,
    });
    if (
      reply.view &&
      session?.sessionId === sessionId &&
      generation === goalGeneration
    ) {
      await acceptView(reply.view);
      await save();
    }
  } catch (error) {
    if (
      !controller.signal.aborted &&
      session?.sessionId === sessionId &&
      generation === goalGeneration
    ) {
      session.view!.instruction =
        /activeTab|permission|capture|Cannot access/i.test(
          error instanceof Error ? error.message : "",
        )
          ? "Chrome needs renewed capture access. Click the extension icon on this website; your destination is retained."
          : "Visual recognition is unavailable right now. Your destination is retained; use live controls or retry visual assistance.";
      await save();
    }
  } finally {
    await chrome.tabs
      .sendMessage(captured.tabId, { type: "RESTORE_CAPTURE", sessionId })
      .catch(() => {});
    if (visionJob === controller) visionJob = undefined;
  }
}

const navigationStarts = new Map<
  number,
  { sessionId: string; journeyId: string; key: string; at: number }
>();
const ready = chrome.storage.session
  .get(["navigatorSession", "navigatorJourneys"])
  .then((data) => {
    session = restoreSession(data.navigatorSession);
    suspended = (data.navigatorJourneys || [])
      .map((v: unknown) => suspendedJourneySchema.safeParse(v))
      .filter((v: any) => v.success)
      .map((v: any) => v.data)
      .slice(0, 5);
    if (session?.view?.journey)
      session.view.journey = resumeJourney(session.view.journey);
  });
chrome.runtime.onInstalled.addListener((details) => {
  if (details.reason !== "update") return;
  void ready.then(async () => {
    if (session?.view) {
      session.view.status = "paused";
      session.view.controls = [];
      session.view.page = undefined;
      session.view.selectedControlId = undefined;
      session.view.instruction =
        "Tholi was updated. Resume to refresh guidance on this page.";
      session.documentId = undefined;
      session.navigationPending = true;
      await save();
    }
  });
});
const save = async () => {
  invalidateUi();
  void mountWidget(session);
  await chrome.storage.session.set({ navigatorJourneys: suspended });
  if (session) await chrome.storage.session.set({ navigatorSession: session });
  else await chrome.storage.session.remove("navigatorSession");
};
void ready.then(() => mountWidget(session, true));
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
  lastObservation = key;
  const pinned = session;
  const snapshot = structuredClone({
    page,
    journey: session.view.journey,
    plan: session.view.goalPlan,
    documentId: session.documentId,
    evidence: evidence.success ? evidence.data : undefined,
  });
  // Ordinary updates replace queued snapshots; verified edges have their own key.
  const jobKey =
    pinned.sessionId +
    ":" +
    page.pageKey +
    (snapshot.evidence
      ? ":edge:" + hash(JSON.stringify(snapshot.evidence))
      : "");
  memoryJobs.schedule(jobKey, async () => {
    try {
      const site = await memory.observe(snapshot.page, snapshot.evidence);
      const journey = snapshot.journey;
      const tasks = await memory.tasks(page.origin);
      let savedTask;
      if (journey) {
        savedTask = tasks.find(
          (t) => t.id === (journey.savedRouteId || taskKey(journey)),
        );
        // A draft does not replace a previously successful route's observations.
        if (
          !pinned.forgottenTaskIds?.includes(taskKey(journey)) &&
          (!savedTask?.completed || journey.status === "completed")
        ) {
          const task = parameterizedTask(
            saveTask(journey, snapshot.page, snapshot.plan),
          );
          await memory.saveTask(task);
          await mirrorRoute(task).catch(() => {});
          const existing = tasks.findIndex((t) => t.id === task.id);
          if (existing >= 0) tasks.splice(existing, 1);
          tasks.unshift(task);
        }
      }
      cacheMemory(page.origin, site, tasks.slice(0, 100));
      if (
        session !== pinned ||
        !session.view ||
        session.documentId !== snapshot.documentId
      )
        return;
      session.view.memory = memorySummary(site);
      session.view.memoryError = undefined;
      // Late persistence must not replace a newer task's saved-route context.
      if (session.view.journey?.id !== journey?.id) savedTask = undefined;
      await chrome.tabs
        .sendMessage(session.tabId, {
          type: "UPDATE_MEMORY",
          sessionId: session.sessionId,
          memory: site,
          savedTask,
        })
        .catch(() => {});
    } catch {
      if (session === pinned && session.view)
        session.view.memoryError =
          "Site memory could not be saved. Live guidance remains available.";
      if (lastObservation === key) lastObservation = "";
    }
  });
}
async function acceptView(raw: unknown) {
  if (!session) throw new Error("No active session.");
  const view = validPinnedView(session, raw);
  if (!view) throw new Error("The website did not return a valid session.");
  view.memory = session.view?.memory;
  view.memoryError = session.view?.memoryError;
  session.view = view;
  if (view.page && session.documentId)
    session.ledger = appendLedger(
      session.ledger || [],
      view.page,
      session.tabId,
      session.documentId,
      ledgerNavigationEvent,
    );
  ledgerNavigationEvent = false;
}
async function attachSession() {
  if (!session) throw new Error("No pinned session.");
  const uiPresentation = await getSurfacePresentation(session);
  if (live()) refreshMemory(session.origin!);
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
    void startFrames(session).catch(() => {});
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
      !contextualTask(session.view.journey) &&
      session.view.request?.tasks[session.view.request.active]?.operation !==
        "search" &&
      session.view.goalPlan?.status === "guiding" &&
      session.view.goalPlan.steps.length <= 1 &&
      !session.view.goalPlan.exploration &&
      session.view.goalPlan.source !== "memory"
    )
      session.view.goalPlan = {
        ...session.view.goalPlan,
        status: "completed",
        steps: [],
        reason: "The linked destination loaded and was observed.",
      };
    if (session.view.request && session.view.goalPlan?.status === "completed")
      session.view.request = advanceQueue(session.view.request, "verified");
  }
  session.pendingNavigation = undefined;
  const reply = await chrome.tabs.sendMessage(session.tabId, {
    type: "BEGIN_SESSION",
    sessionId: session.sessionId,
    presentationVisible: uiPresentation?.visibility !== "launcher",
    presentationRevision: uiPresentation?.revision || 0,
    routeId: session.routeId,
    routeVersion: session.routeVersion,
    verifiedSteps: session.view?.verifiedSteps || 0,
    ...(live()
      ? {
          memory: knownSites.get(session.origin!),
          goalPlan: session.view?.goalPlan,
          journey: session.view?.journey,
          request: session.view?.request,
          savedTask: session.view?.journey
            ? (knownTasks.get(session.view.journey.origin) || []).find(
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
  const freshPresentation = await getSurfacePresentation(session);
  if (freshPresentation !== uiPresentation)
    await chrome.tabs
      .sendMessage(
        session.tabId,
        {
          type: "PRESENTATION_CHANGED",
          sessionId: session.sessionId,
          visible: freshPresentation?.visibility !== "launcher",
          revision: freshPresentation?.revision || 0,
        },
        { frameId: 0 },
      )
      .catch(() => {});
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
  if (live()) void startFrames(session).catch(() => {});
  return session;
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
  navigationStarts.clear();
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
  .setPanelBehavior({ openPanelOnActionClick: false })
  .catch(() => {});
let queue: Promise<unknown> = ready;
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation);
  queue = next.catch(() => {});
  return next;
}
chrome.runtime.onMessage.addListener((raw, sender, respond) => {
  if (raw?.type === "UI_RESET_SESSION") {
    if (!trustedUi(sender, session)) {
      respond({ error: "Trusted Tholi interface required." });
      return;
    }
    const captured = session;
    void enqueue(async () => {
      if (captured !== session)
        throw Error(
          "The task changed. Review the current session before resetting.",
        );
      cancelVision();
      goalGeneration++;
      await stopSession();
      const prior = session;
      session = undefined;
      await clearSurfacePresentation(prior);
      suspended = [];
      await chrome.storage.session.remove([
        "navigatorSession",
        "navigatorJourneys",
        "tholiConversation",
        "tholiDraft",
      ]);
      await chrome.storage.session.set({
        tholiSessionReset: crypto.randomUUID(),
      });
      invalidateUi();
      return { ok: true };
    })
      .then(respond)
      .catch((error) => respond({ error: error.message }));
    return true;
  }
  if (raw?.type === "UI_APPEARANCE") {
    // Appearance must stay responsive while navigation/inference owns the queue.
    void (async () => {
      if (!trustedUi(sender, session))
        throw Error("Trusted Tholi interface required.");
      for (let attempt = 0; attempt < 2; attempt++) {
        const pinned = isWidget(sender, session) ? session?.tabId : undefined;
        const tab =
          pinned === undefined
            ? await activeTab()
            : await chrome.tabs.get(pinned);
        const appearance = tab ? await tabAppearance(tab) : undefined;
        if (!trustedUi(sender, session)) throw Error("The website changed.");
        if (pinned !== undefined || (await activeTab())?.id === tab?.id)
          return { appearance };
      }
      return {};
    })()
      .then(respond)
      .catch(() => respond({ error: "Appearance unavailable." }));
    return true;
  }
  if (raw?.type === "PAGE_THEME_CHANGED") {
    void validThemeSender(sender)
      .then((valid) => {
        if (valid) invalidateUi();
        respond({ ok: valid });
      })
      .catch(() => respond({ ok: false }));
    return true;
  }
  if (raw?.type?.startsWith("UI_")) {
    if (raw.type === "UI_MINIMIZE" && trustedUi(sender, session))
      cancelVision();
    const operation = [
      "UI_OPEN_SIDEBAR",
      "UI_DOCK",
      "UI_MINIMIZE",
      "UI_DISMISS",
      "UI_RESTORE",
    ].includes(raw.type)
      ? uiMessage(raw, sender, session)
      : enqueue(() => uiMessage(raw, sender, session));
    void operation
      .then((result) => {
        if (raw.type === "UI_DISMISS") cancelVision();
        respond(result);
      })
      .catch((e) => respond({ error: e.message }));
    return true;
  }
  if (isWidget(sender, session) && !widgetCommands.has(raw?.type)) {
    respond({ error: "This setting is only available in the sidebar." });
    return;
  }

  if (raw?.target === "offscreen") return;
  if (raw?.type === "FRAME_VISIBILITY") {
    void enqueue(() => frameVisibilityMessage(raw, sender, session))
      .then(() => respond({ ok: true }))
      .catch(() => respond({ error: "Frame visibility unavailable" }));
    return true;
  }
  if (["FRAME_OBSERVATION", "FRAME_INTERACTION"].includes(raw?.type)) {
    void enqueue(async () => {
      const value = frameMessage(raw, sender, session);
      if (!value || !session) return { error: "Stale frame observation" };
      await chrome.tabs.sendMessage(session.tabId, {
        type:
          raw.type === "FRAME_OBSERVATION"
            ? "FRAME_OBSERVATION_PARENT"
            : "FRAME_INTERACTION_PARENT",
        sessionId: session.sessionId,
        frameId: value.frame.frameId,
        documentId: value.frame.documentId,
        tabId: session.tabId,
        ...(raw.type === "FRAME_OBSERVATION"
          ? { page: value.page }
          : {
              controlId: raw.controlId,
              signature: raw.signature,
              verified: raw.verified === true,
            }),
      });
      return { ok: true };
    })
      .then(respond)
      .catch(() => respond({ error: "Frame unavailable" }));
    return true;
  }
  if (["GUIDE_FRAME", "CLEAR_FRAME_GUIDANCE"].includes(raw?.type)) {
    void enqueue(async () => {
      if (
        !session ||
        sender.id !== chrome.runtime.id ||
        sender.tab?.id !== session.tabId ||
        sender.documentId !== session.documentId
      )
        return { error: "Stale frame request" };
      if (raw.type === "CLEAR_FRAME_GUIDANCE") {
        await clearFrames(session);
        return { ok: true };
      }
      const c = session.view?.page?.controls.find(
        (c) =>
          c.id === raw.reference?.controlId &&
          c.signature === raw.signature &&
          c.reference?.documentId === raw.reference?.documentId,
      );
      if (
        !c ||
        !c.visible ||
        c.occluded ||
        (c.risk === "consequential" && !raw.review)
      )
        return { error: "Frame target requires fresh evidence" };
      return routeFrameGuide(raw, session);
    })
      .then(respond)
      .catch(() => respond({ error: "Frame unavailable" }));
    return true;
  }
  if (
    sender.id === chrome.runtime.id &&
    trustedUi(sender, session) &&
    ["SET_GOAL", "CLARIFY", "STOP", "PAUSE", "RESUME_JOURNEY"].includes(
      raw?.type,
    )
  ) {
    goalGeneration++;
    cancelVision();
  }
  if (raw?.type === "VISION_INVALIDATED") {
    if (
      sender.id === chrome.runtime.id &&
      sender.tab?.id === session?.tabId &&
      sender.documentId === session?.documentId &&
      raw.sessionId === session?.sessionId
    )
      cancelVision();
    respond({ ok: true });
    return;
  }
  if (raw?.type === "GET_MEMORY") {
    if (
      sender.id !== chrome.runtime.id ||
      !trustedUi(sender, session) ||
      !messageSchema.safeParse(raw).success
    ) {
      respond({ error: "Trusted extension panel required." });
      return;
    }
    // Cold hydration may wait for disk; it must not occupy the guidance queue.
    void (async () => {
      await ready;
      const tab = await activeTab(),
        origin = originOf(tab?.url) || session?.origin;
      const epoch = memoryEpoch;
      if (origin && !knownSites.has(origin)) {
        const site = await memory.get(origin);
        if (epoch === memoryEpoch)
          cacheMemory(origin, site, knownTasks.get(origin) || []);
      }
      if (origin) refreshMemory(origin);
      return {
        origin,
        memory: origin ? knownSites.get(origin) : undefined,
        view: session?.view,
      };
    })()
      .then(respond)
      .catch(() =>
        respond({
          error: "Site memory is temporarily unavailable.",
          view: session?.view,
        }),
      );
    return true;
  }
  if (
    (raw?.type === "SET_GOAL" && !raw.proposal && !raw.journeyId) ||
    raw?.type === "NLP_REPLAN" ||
    raw?.type === "NLP_SUGGEST" ||
    raw?.type === "CLARIFY"
  ) {
    void handleNlp(raw, sender)
      .then(respond)
      .catch((error) =>
        respond({
          error:
            error instanceof Error ? error.message : "Local planning failed.",
        }),
      );
    return true;
  }
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
      if (session.view && incoming.verifiedSteps < session.view.verifiedSteps)
        return { error: "Older progress observation." };
      if (
        session.view?.page &&
        incoming.page &&
        incoming.page.revision < session.view.page.revision
      )
        return { error: "Older scan observation." };
      if (incoming.journey?.id !== session.view?.journey?.id) {
        const queueAdvance =
          incoming.request?.id === session.view?.request?.id &&
          incoming.request &&
          incoming.journey?.requestTaskId ===
            incoming.request.tasks[incoming.request.active]?.id &&
          incoming.journey?.requestTaskId !==
            session.view?.journey?.requestTaskId;
        if (!queueAdvance) return { error: "Older journey observation." };
      }
      if (
        session.view?.request &&
        session.view.status === "running" &&
        incoming.request?.id !== session.view.request.id
      )
        return { error: "Older request observation." };
      if (
        session.view?.request &&
        incoming.request &&
        incoming.request.id === session.view.request.id &&
        incoming.request.active < session.view.request.active
      )
        return { error: "Older task observation." };
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
      if (session.navigationPending && live()) {
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
    if (!trustedUi(sender, session))
      return { error: "Extension panel required." };
    const parsed = messageSchema.safeParse(raw);
    if (!parsed.success) return { error: "Invalid command." };
    const command = parsed.data;
    if (command.type === "CHECK_VISUAL_ACTION") {
      if (!session || session.view?.goalPlan?.action?.kind !== "visual")
        return { error: "No visual suggestion is pending." };
      const response = await chrome.tabs.sendMessage(session.tabId, {
        type: "RECHECK_JOURNEY",
        sessionId: session.sessionId,
      });
      if (response.view) await acceptView(response.view);
      await save();
      return session;
    }
    if (command.type === "GET_VISION")
      return {
        backend: !!(await chrome.storage.local.get("vision")).vision?.backend,
      };
    if (command.type === "SET_VISION") {
      await chrome.storage.local.setAccessLevel({
        accessLevel: "TRUSTED_CONTEXTS",
      });
      await chrome.storage.local.set({ vision: { backend: command.backend } });
      return { ok: true };
    }
    if (command.type === "REQUEST_VISION") {
      lastVisionKey = "";
      if (session?.view?.request)
        void attemptVision(session.sessionId, session.view.request.id);
      return { ok: true };
    }
    if (command.type === "GET_JOURNEYS")
      return {
        journeys: suspended.map((e) => ({
          id: e.id,
          goal: e.journey.goal,
          pausedAt: e.pausedAt,
        })),
      };
    if (command.type === "DELETE_JOURNEY") {
      suspended = suspended.filter((e) => e.id !== command.id);
      await save();
      return { ok: true };
    }
    if (command.type === "RESUME_JOURNEY") {
      const entry = suspended.find((e) => e.id === command.id);
      if (!entry || !session || !live())
        return { error: "Start navigation on the website before resuming." };
      const tab = await activeTab();
      if (tab?.id !== session.tabId || originOf(tab.url) !== entry.origin)
        return {
          error:
            "Open the journey's website and start navigation there, then resume this task.",
        };
      const parked =
        session.view?.journey &&
        session.view.request &&
        suspendJourney(
          session.view.journey,
          session.view.request,
          session.origin!,
          session.tabId,
        );
      suspended = suspended.filter((e) => e.id !== entry.id);
      if (parked && !suspended.some((e) => e.id === parked.id))
        suspended.push(parked);
      if (!session.view) return { error: "Fresh website handshake required." };
      session.view.journey = entry.journey;
      session.view.request = {
        ...entry.request,
        status: entry.request.resumeStatus || "active",
        resumeStatus: undefined,
      };
      session.view.goalPlan = undefined;
      const response = await chrome.tabs.sendMessage(session.tabId, {
        type: "RESTORE_JOURNEY",
        sessionId: session.sessionId,
        journey: entry.journey,
        request: session.view.request,
      });
      if (response?.view) await acceptView(response.view);
      await save();
      return session;
    }
    if (command.type === "CHECK_ROUTE_ACTION") {
      const action = session?.view?.goalPlan?.action;
      if (
        !session ||
        !action ||
        !["history-back", "tab-switch"].includes(action.kind)
      )
        return { error: "No return action is pending." };
      if (action.kind !== "history-back" && action.kind !== "tab-switch")
        return;
      const tab = await activeTab();
      const entry = session.ledger?.find((e) => e.id === action.entryId);
      if (
        !entry ||
        tab?.id !== action.tabId ||
        originOf(tab.url) !== entry.origin
      )
        return {
          error:
            "Return to the indicated website tab first. The destination is still retained.",
        };
      if (
        session.tabId !== tab.id ||
        !session.documentId ||
        session.navigationPending
      ) {
        session.tabId = tab.id;
        session.documentId = undefined;
      }
      await attachSession();
      const current = session.view?.page;
      if (!current || current.stateKey !== action.expectedState)
        return {
          error:
            "That page changed. Your task remains incomplete; fresh navigation will be recalculated.",
          view: session.view,
        };
      return session;
    }
    if (command.type === "GET_BACKEND")
      return isPanel(sender)
        ? backendSettings()
        : { error: "Sidebar required." };
    if (command.type === "SET_BACKEND")
      return isPanel(sender)
        ? setBackendSettings(command)
        : { error: "Sidebar required." };
    if (command.type === "GET_SESSION") return session || {};
    if (command.type === "GET_TASKS" || command.type === "DELETE_TASK") {
      const tab = await activeTab(),
        origin = originOf(tab?.url);
      if (!origin) return { tasks: [] };
      if (command.type === "DELETE_TASK") {
        await memoryJobs.cancelAndDrain();
        if ((await memory.tasks(origin)).some((t) => t.id === command.id)) {
          await memory.deleteTask(command.id);
          if (session) {
            session.forgottenTaskIds = [
              ...new Set([...(session.forgottenTaskIds || []), command.id]),
            ].slice(-100);
            await save();
          }
        }
        knownTasks.set(origin, await memory.tasks(origin));
        lastObservation = "";
      }
      refreshMemory(origin);
      return { tasks: knownTasks.get(origin) || [] };
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
      const siteAccessRequired =
        available &&
        !(await chrome.permissions.contains({
          origins: [
            new URL(tab!.url!).protocol +
              "//" +
              new URL(tab!.url!).hostname +
              "/*",
          ],
        }));
      return {
        tabId: tab?.id,
        origin: available ? origin : undefined,
        siteAccessRequired,
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
    if (command.type === "FORGET_SITE" || command.type === "CLEAR_MEMORY") {
      const tab = await activeTab(),
        origin = originOf(tab?.url) || session?.origin;
      if (
        live() &&
        (command.type === "CLEAR_MEMORY" || origin === session?.origin)
      )
        await stopSession(
          "Site memory cleared. Start navigation to learn this page again.",
        );
      await memoryJobs.cancelAndDrain();
      command.type === "CLEAR_MEMORY"
        ? await memory.clear()
        : origin && (await memory.forget(origin));
      memoryEpoch++;
      // Local deletion is authoritative even if the optional mirror is offline.
      if (command.type === "CLEAR_MEMORY") {
        knownSites.clear();
        knownTasks.clear();
      } else if (origin) {
        knownSites.delete(origin);
        // Forget also removes routes whose verified progress visited this site.
        knownTasks.clear();
      }
      lastObservation = "";
      if (session?.view && live()) {
        session.view.memory = memorySummary();
        session.view.goalPlan = undefined;
        session.view.journey = undefined;
        await save();
      }
      await cancelNlp();
      await new IndexedDBDerivedStore().clearDerived(
        command.type === "CLEAR_MEMORY" ? undefined : origin,
      );
      await deleteBackendMemory(
        command.type === "CLEAR_MEMORY" ? undefined : origin,
      );
      if (origin) refreshMemory(origin);
      return {
        origin,
        memory: origin ? knownSites.get(origin) : undefined,
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
      if (
        (command.tabId !== undefined && command.tabId !== tab.id) ||
        (command.origin && command.origin !== originOf(tab.url))
      )
        return {
          error:
            "The tab changed while granting access. Start navigation on the current website again.",
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
            "Tholi could not access this page. Click its toolbar icon on the website, refresh the page, then try again. If Chrome asks for this site's access, allow it to continue. Browser pages and documents without HTML controls are unsupported.",
        };
      }
    }
    if (!session)
      return command.type === "STOP"
        ? {}
        : { error: "Start navigation first." };
    if (command.type === "STOP") {
      await stopSession();
      return structuredClone(session);
    }
    const tab = await activeTab();
    if (
      command.type === "CONTINUE_TASK" &&
      session.view &&
      session.pendingNavigation &&
      continuesDestination(session.view.journey, session.view.request)
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
      if (
        tab.id !== session.tabId &&
        session.view.journey?.workflow &&
        !session.handoffReturn
      )
        session.handoffReturn = {
          tabId: session.tabId,
          origin: session.origin!,
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
      if (command.type === "PAUSE") await stopFrames();
      if (command.type === "RESUME" && live())
        void startFrames(session).catch(() => {});
      await remember();
      await save();
      return structuredClone(session);
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
async function handleNlp(raw: any, sender: chrome.runtime.MessageSender) {
  const startedGeneration = goalGeneration;
  if (sender.id !== chrome.runtime.id) throw new Error("Invalid sender.");
  const fromContent = raw.type === "NLP_REPLAN";
  if (!fromContent && !trustedUi(sender, session))
    throw new Error("Trusted extension panel required.");
  if (!fromContent && !messageSchema.safeParse(raw).success)
    throw new Error("Invalid request.");
  const captured = await enqueue(async () => {
    if (
      !session ||
      !live() ||
      session.navigationPending ||
      session.view?.status !== "running"
    )
      throw new Error("Start or resume navigation first.");
    if (
      fromContent &&
      (sender.tab?.id !== session.tabId ||
        sender.documentId !== session.documentId ||
        raw.sessionId !== session.sessionId ||
        !inScope(sender.url || ""))
    )
      throw new Error("Stale document.");
    let reply = await chrome.tabs.sendMessage(session.tabId, {
      type: "GET_PAGE",
      sessionId: session.sessionId,
    });
    if (!reply.page) throw new Error("Fresh page observation required.");
    if (raw.type === "SET_GOAL" && raw.revision !== reply.page.revision)
      throw new Error(
        "The page changed before this request. Use the current scan.",
      );
    if (raw.text || raw.goal || raw.request?.original)
      reply = await chrome.tabs.sendMessage(session.tabId, {
        type: "GET_PAGE",
        sessionId: session.sessionId,
        query: sanitizeGoal(raw.text || raw.goal || raw.request.original),
      });
    const request = fromContent
      ? requestSchema.parse(raw.request)
      : raw.type === "CLARIFY"
        ? session.view.request
        : undefined;
    return {
      sessionId: session.sessionId,
      documentId: session.documentId!,
      request,
      page: reply.page,
      origin: session.origin!,
      journey: session.view.journey,
      tabId: session.tabId,
      activeRequest: session.view.request,
      target: session.view.request?.tasks[session.view.request.active]?.target,
    };
  });
  let input: PlanInput = planInputSchema.parse({
    requestId: captured.request?.id || raw.requestId || crypto.randomUUID(),
    documentId: captured.documentId,
    revision: captured.page.revision,
    text: sanitizeGoal(captured.request?.original || raw.text || raw.goal),
    observation: captured.page,
    strategy: raw.strategy || captured.journey?.strategy || "fastest",
    request: captured.request,
    choice: raw.choice,
    context: {
      target: captured.target,
      verifiedDestination: fromContent ? raw.verifiedDestination : undefined,
    },
    protocolVersion: 2,
    tabId: captured.tabId,
    frameId: 0,
    navigationLedger: session?.ledger,
    workflow: captured.journey?.workflow,
    contextRevision: captured.journey?.workflow?.revision || 0,
  });
  if (
    raw.type === "SET_GOAL" &&
    captured.activeRequest &&
    !["completed", "canceled"].includes(captured.activeRequest.status)
  ) {
    const parsed = interpretRequest(input.text, input.context, {
      clauses: true,
    });
    if (sameDestination(parsed, captured.activeRequest)) {
      input.request = captured.activeRequest;
      input.requestId = captured.activeRequest.id;
      input.text = captured.activeRequest.original;
    }
  }
  const site = knownSites.get(captured.origin);
  input.journey = captured.journey;
  if (raw.savedRouteId) {
    const saved = (knownTasks.get(captured.origin) || []).find(
      (task) => task.id === raw.savedRouteId,
    );
    if (saved) {
      input.savedRoute = saved;
      input.context = { ...input.context, target: saved.objective.purpose };
    }
  }
  if (captured.journey?.savedRouteId)
    input.savedRoute = (knownTasks.get(captured.journey.origin) || []).find(
      (t) => t.id === captured.journey!.savedRouteId,
    );
  for (let attempt = 0; attempt < 4; attempt++) {
    let value;
    try {
      value = await backendNlp(input, raw.type === "NLP_SUGGEST", site);
    } catch {
      value = undefined;
    }
    if (startedGeneration !== goalGeneration)
      throw new Error("Planning was replaced or canceled.");
    value ??= await localNlp(input, site, raw.type === "NLP_SUGGEST");
    const applied = await enqueue(async () => {
      if (startedGeneration !== goalGeneration)
        throw new Error("This request was replaced or canceled.");
      if (fromContent && session?.view?.request?.id !== captured.request?.id)
        throw new Error("Older request result.");
      if (
        !session ||
        session.sessionId !== captured.sessionId ||
        session.view?.status !== "running" ||
        session.navigationPending
      )
        throw new Error("Planning canceled by navigation or Stop.");
      const fresh = await chrome.tabs.sendMessage(session.tabId, {
        type: "GET_PAGE",
        sessionId: session.sessionId,
      });
      if (
        fromContent &&
        input.journey &&
        fresh.view?.journey?.requestTaskId === input.journey.requestTaskId &&
        (fresh.view.journey.totalVerified ??
          fresh.view.journey.progress.length) !==
          (input.journey.totalVerified ?? input.journey.progress.length)
      ) {
        input = {
          ...input,
          journey: fresh.view.journey,
          observation: fresh.page,
          revision: fresh.page.revision,
          documentId: session.documentId!,
        };
        return undefined;
      }
      if (
        session.documentId !== input.documentId ||
        fresh.page.revision !== input.revision ||
        (input.workflow &&
          fresh.view?.journey?.workflow?.revision !== input.contextRevision)
      ) {
        input = {
          ...input,
          documentId: session.documentId!,
          observation: fresh.page,
          revision: fresh.page.revision,
          workflow: fresh.view?.journey?.workflow,
          contextRevision: fresh.view?.journey?.workflow?.revision || 0,
        };
        return undefined;
      }
      if (raw.type === "NLP_SUGGEST")
        return {
          requestId: input.requestId,
          documentId: input.documentId,
          revision: input.revision,
          contextRevision: input.contextRevision,
          suggestions: value,
        };
      const result = resultSchema.parse(value);
      if (
        result.documentId !== input.documentId ||
        result.revision !== input.revision ||
        result.requestId !== input.requestId ||
        result.contextRevision !== input.contextRevision
      )
        throw new Error("Stale planning result.");
      if (fromContent) {
        if (needsVision(result.plan, !!result.clarification))
          setTimeout(
            () => void attemptVision(captured.sessionId, result.requestId),
            100,
          );
        return result;
      }
      if (
        raw.type === "SET_GOAL" &&
        session.view?.journey &&
        session.view.request &&
        result.request?.id !== session.view.request.id
      ) {
        const correction =
          !!result.workflow &&
          result.workflow.id === session.view.journey.workflow?.id;
        const parked =
          !correction &&
          suspendJourney(
            session.view.journey,
            session.view.request,
            session.origin!,
            session.tabId,
          );
        if (parked && !suspended.some((e) => e.id === parked.id)) {
          if (suspended.length >= 5)
            throw new Error(
              "Five unfinished journeys are saved. Remove one from Resume previous task, then submit this destination again.",
            );
          suspended.push(parked);
        }
      }
      const reply = await chrome.tabs.sendMessage(session.tabId, {
        type: "INSTALL_REQUEST",
        sessionId: session.sessionId,
        result,
        strategy: raw.strategy,
        savedRouteId: raw.savedRouteId,
      });
      if (reply.error) return undefined;
      await acceptView(reply.view);
      await remember();
      await save();
      if (needsVision(result.plan, !!result.clarification))
        setTimeout(
          () => void attemptVision(captured.sessionId, result.requestId),
          100,
        );
      return structuredClone(session);
    });
    if (applied) return applied;
  }
  // Retain a first request too, rather than claiming retention while leaving the
  // previous task in the panel after a mutation storm exhausted stale retries.
  const request =
    input.request ||
    interpretRequest(input.text, input.context, { clauses: true });
  request.id = input.requestId;
  await enqueue(async () => {
    if (
      startedGeneration !== goalGeneration ||
      !session ||
      session.sessionId !== captured.sessionId ||
      session.view?.status !== "running" ||
      session.navigationPending
    )
      return;
    const fresh = await chrome.tabs.sendMessage(session.tabId, {
      type: "GET_PAGE",
      sessionId: session.sessionId,
    });
    if (!fresh.page) return;
    const reply = await chrome.tabs.sendMessage(session.tabId, {
      type: "INSTALL_REQUEST",
      sessionId: session.sessionId,
      result: {
        requestId: request.id,
        documentId: session.documentId!,
        revision: fresh.page.revision,
        protocolVersion: 2,
        contextRevision: input.contextRevision || 0,
        status: "pending-indexing",
        request,
        reason:
          "The page is changing. Your request is retained; recalculate on the current page.",
        activity: {
          embedded: 0,
          cacheHits: 0,
          llmCalls: 0,
          modelRevision: "751bff37182d3f1213fa05d7196b954e230abad9",
        },
      },
    });
    if (reply.view) {
      await acceptView(reply.view);
      await save();
    }
  });
  return {
    status: "pending-indexing",
    error: "The page is changing. Recalculate using the current scan.",
  };
}
chrome.tabs.onRemoved.addListener((tabId) => {
  void enqueue(async () => {
    if (session?.tabId === tabId) {
      if (session.handoffReturn) {
        const previous = await chrome.tabs
          .get(session.handoffReturn.tabId)
          .catch(() => undefined);
        const returned =
          previous && returnFromHandoff(session, tabId, previous);
        if (returned) {
          await stopFrames();
          session = returned;
          await save();
          return;
        }
      }
      session = undefined;
      await save();
    }
  });
});
chrome.webNavigation.onHistoryStateUpdated.addListener((details) => {
  if (
    details.frameId !== 0 ||
    details.tabId !== session?.tabId ||
    !session?.view ||
    !live()
  )
    return;
  ledgerNavigationEvent = true;
  void chrome.tabs
    .sendMessage(details.tabId, {
      type: "SPA_CHANGED",
      sessionId: session.sessionId,
    })
    .catch(() => {});
});
chrome.webNavigation.onCompleted.addListener((details) => {
  if (
    details.frameId === 0 ||
    details.tabId !== session?.tabId ||
    !live() ||
    session?.view?.status !== "running"
  )
    return;
  if (session) void startFrames(session).catch(() => {});
});
chrome.permissions.onAdded.addListener(() => {
  if (session && live() && session.view?.status === "running")
    void startFrames(session).catch(() => {});
  void recoverWebsiteAccess().catch(() => {});
});
async function recoverWebsiteAccess() {
  const tab = await activeTab();
  if (!session?.view?.request || !live() || !tab?.url || tab.id === undefined)
    return;
  const origin = originOf(tab.url);
  const expected = session.view.continuationOrigin;
  if (
    expected &&
    origin === expected &&
    (tab.id === session.tabId || tab.openerTabId === session.tabId)
  ) {
    const url = new URL(tab.url);
    if (
      !(await chrome.permissions.contains({
        origins: [url.protocol + "//" + url.hostname + "/*"],
      }))
    )
      return;
    await enqueue(async () => {
      if (!session?.view || session.view.continuationOrigin !== expected)
        return;
      session.tabId = tab.id!;
      session.origin = origin;
      session.view.status = "running";
      session.view.continuationOrigin = undefined;
      await attachSession();
    });
  }
  if (
    session?.tabId === tab.id &&
    session.view?.status === "running" &&
    origin === session.origin
  ) {
    lastVisionKey = "";
    if (session.view.request)
      void attemptVision(session.sessionId, session.view.request.id);
  }
}
chrome.action.onClicked.addListener((tab) => {
  if (
    tab.windowId !== undefined &&
    (preferredSurface(session) !== "widget" ||
      !session ||
      session.tabId !== tab.id ||
      !session.documentId ||
      session.navigationPending)
  )
    void chrome.sidePanel.open({ windowId: tab.windowId }).catch(() => {});
  void recoverWebsiteAccess()
    .then(async () => {
      const current = session;
      if (current && current.tabId === tab.id) await restoreSurface(current);
      await mountWidget(session, true);
    })
    .catch(() => {});
});
watchNativePanels(() => session);
// Follow browser-confirmed server redirects only for the active authentication
// task. This permission supplies navigation metadata, not access to the new DOM.
// Ignore unrelated tabs/subframes before parsing URLs; never persist raw queries.
chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.frameId !== 0) return;
  void enqueue(async () => {
    if (
      !session?.view?.journey ||
      !continuesDestination(session.view.journey, session.view.request) ||
      !sessionLocked(session) ||
      !["running", "waiting"].includes(session.view.status)
    )
      return;
    if (details.tabId !== session.tabId) {
      const tab = await chrome.tabs.get(details.tabId).catch(() => undefined);
      if (tab?.openerTabId !== session.tabId) return;
    }
    if (!supportsLiveUrl(details.url)) return;
    const url = new URL(details.url),
      key = hash(url.origin + url.pathname + url.search);
    const action = session.view.journey.workflow?.pendingAction;
    if (
      !session.pendingNavigation &&
      action?.acted &&
      Date.now() - action.startedAt < 120000 &&
      session.view.page
    ) {
      session.pendingNavigation = {
        from: session.view.page.stateKey,
        signature: action.signature,
        label: action.label,
        destinationKey: hash(url.origin + url.pathname),
        navigationKey: key,
        origin: url.origin,
        kind: "navigation",
        fromOrigin: session.origin,
        newTab: details.tabId !== session.tabId,
      };
    }
    const existing = navigationStarts.get(details.tabId);
    if (
      existing?.sessionId === session.sessionId &&
      existing.journeyId === session.view.journey.id &&
      details.timeStamp - existing.at < 15000 &&
      session.pendingNavigation?.navigationKey === existing.key
    )
      return;
    navigationStarts.clear();
    navigationStarts.set(details.tabId, {
      sessionId: session.sessionId,
      journeyId: session.view.journey.id,
      key,
      at: details.timeStamp,
    });
  });
});
chrome.webNavigation.onCommitted.addListener((details) => {
  if (details.frameId !== 0) return;
  void enqueue(async () => {
    const start = navigationStarts.get(details.tabId);
    navigationStarts.delete(details.tabId);
    const nav = session?.pendingNavigation;
    if (
      !session?.view?.journey ||
      (!session.view.journey.workflow &&
        !session.view.journey.objective.workflow) ||
      !continuesDestination(session.view.journey, session.view.request) ||
      !nav ||
      !start ||
      !sessionLocked(session) ||
      start.sessionId !== session.sessionId ||
      start.journeyId !== session.view.journey.id ||
      start.key !== nav.navigationKey ||
      details.timeStamp - start.at > 15000 ||
      !["link", "form_submit"].includes(details.transitionType) ||
      !details.transitionQualifiers.includes("server_redirect") ||
      details.transitionQualifiers.includes("from_address_bar") ||
      !supportsLiveUrl(details.url)
    )
      return;
    if (details.tabId !== session.tabId) {
      const tab = await chrome.tabs.get(details.tabId).catch(() => undefined);
      if (tab?.openerTabId !== session.tabId) return;
    }
    const url = new URL(details.url);
    session.pendingNavigation = {
      ...nav,
      origin: url.origin,
      destinationKey: hash(url.origin + url.pathname),
      navigationKey: hash(url.origin + url.pathname + url.search),
      redirected: true,
    };
    session.navigationPending = true;
    if (url.origin !== session.origin || details.tabId !== session.tabId) {
      session.view = {
        ...session.view,
        status: "paused",
        page: undefined,
        controls: [],
        selectedControlId: undefined,
        continuationOrigin: url.origin,
        instruction:
          "The account task redirected to another website. Review its address, then allow access to continue the same task.",
      };
    }
    await save();
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
      session.view &&
      continuesDestination(session.view.journey, session.view.request) &&
      session.pendingNavigation
    ) {
      const url = tab.url && new URL(tab.url),
        nav = session.pendingNavigation;
      if (
        nav.newTab &&
        (!url ||
          (url.origin === nav.origin &&
            hash(url.origin + url.pathname + url.search) === nav.navigationKey))
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
        // Same-document authored routes already publish their observed state.
        // Resuming here could release a login checkpoint or an explicit Pause.
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
        continuesDestination(session.view.journey, session.view.request) &&
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
      if (session.view.journey?.workflow) {
        await stopFrames();
        session.view = {
          ...session.view,
          status: "paused",
          page: undefined,
          controls: [],
          selectedControlId: undefined,
          instruction:
            "Navigation left the task's website. Return to that website and resume; your objective and details are retained.",
        };
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

chrome.webNavigation.onBeforeNavigate.addListener((details) => {
  if (details.tabId === session?.tabId && visionJob) cancelVision();
});
