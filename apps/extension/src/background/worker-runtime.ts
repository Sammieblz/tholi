import {
  configureNativeSidebar,
  openNativeSidebar,
  hasNativeSidebar,
} from "../platform/sidebar";
import { api, browserTarget } from "../platform/api";
import { resumeJourney } from "../../../../packages/goal-planner/task-journey";
import {
  suspendedJourneySchema,
  type SuspendedJourney,
} from "../../../../packages/navigation-core/continuity";
import {
  LIVE_ROUTE_ID,
  type SavedTask,
  type SiteMemory,
} from "../../../../packages/page-model/index";
import {
  restoreSession,
  type PinnedSession,
} from "../../../../packages/route-registry/session";
import { BackgroundMemory } from "../../../../packages/site-memory/background";
import { IndexedDBSiteMemory } from "../../../../packages/site-memory/index";
import { createJourneyService } from "./journey-service";
import { createMemoryService } from "./memory-service";
import { registerMessages } from "./message-router";
import { registerNavigationEvents } from "./navigation-events";
import { createSessionService } from "./session-service";
import {
  invalidateUi,
  mountWidget,
  preferredSurface,
  rememberSurface,
  restoreSurface,
  watchNativePanels,
  restoreSurface as restoreWidgetSurface,
} from "./ui-transport";
import { createVisionService } from "./vision-service";
let session: PinnedSession | undefined;
let suspended: SuspendedJourney[] = [];
const memory = new IndexedDBSiteMemory();
const memoryJobs = new BackgroundMemory();
const knownSites = new Map<string, SiteMemory | undefined>();
const knownTasks = new Map<string, SavedTask[]>();
let memoryEpoch = 0;
type ContextForcreateMemoryService = Parameters<typeof createMemoryService>[0];
const { cacheMemory, refreshMemory, remember } = createMemoryService({
  get knownSites() {
    return knownSites;
  },
  get knownTasks() {
    return knownTasks;
  },
  get memoryJobs() {
    return memoryJobs;
  },
  get memory() {
    return memory;
  },
  get session() {
    return session;
  },
  set session(value: ContextForcreateMemoryService["session"]) {
    session = value;
  },
  get live() {
    return live;
  },
  get lastObservation() {
    return lastObservation;
  },
  set lastObservation(value: ContextForcreateMemoryService["lastObservation"]) {
    lastObservation = value;
  },
});

let lastObservation = "";
let ledgerNavigationEvent = false;
let goalGeneration = 0;
let visionJob: AbortController | undefined;
let lastCapture = 0;
let lastVisionKey = "";

type ContextForcreateVisionService = Parameters<typeof createVisionService>[0];
const { cancelVision, attemptVision, withMaskedNavigation, captureWindowId } =
  createVisionService({
    get visionJob() {
      return visionJob;
    },
    set visionJob(value: ContextForcreateVisionService["visionJob"]) {
      visionJob = value;
    },
    get lastVisionKey() {
      return lastVisionKey;
    },
    set lastVisionKey(value: ContextForcreateVisionService["lastVisionKey"]) {
      lastVisionKey = value;
    },
    get session() {
      return session;
    },
    set session(value: ContextForcreateVisionService["session"]) {
      session = value;
    },
    get goalGeneration() {
      return goalGeneration;
    },
    set goalGeneration(value: ContextForcreateVisionService["goalGeneration"]) {
      goalGeneration = value;
    },
    get originOf() {
      return originOf;
    },
    get lastCapture() {
      return lastCapture;
    },
    set lastCapture(value: ContextForcreateVisionService["lastCapture"]) {
      lastCapture = value;
    },
    get knownSites() {
      return knownSites;
    },
    get save() {
      return save;
    },
    get acceptView() {
      return acceptView;
    },
  });

const navigationStarts = new Map<
  number,
  { sessionId: string; journeyId: string; key: string; at: number }
>();
const ready = api.storage.session
  .get(["navigatorSession", "navigatorJourneys"])
  .then((data) => {
    session = restoreSession(data.navigatorSession);
    if (session?.view) delete session.view.serviceNavigation;
    suspended = (data.navigatorJourneys || [])
      .map((v: unknown) => suspendedJourneySchema.safeParse(v))
      .filter((v: any) => v.success)
      .map((v: any) => v.data)
      .slice(0, 5);
    if (session?.view?.journey)
      session.view.journey = resumeJourney(session.view.journey);
  });
api.runtime.onInstalled.addListener((details) => {
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
  await api.storage.session.set({ navigatorJourneys: suspended });
  if (session) {
    const persisted = structuredClone(session);
    if (persisted.view) delete persisted.view.serviceNavigation;
    await api.storage.session.set({ navigatorSession: persisted });
  } else await api.storage.session.remove("navigatorSession");
};
void ready.then(() => mountWidget(session, true));
const live = () => session?.routeId === LIVE_ROUTE_ID;
const activeTab = async () =>
  (await api.tabs.query({ active: true, lastFocusedWindow: true }))[0];
const originOf = (url?: string) => {
  try {
    return url ? new URL(url).origin : undefined;
  } catch {
    return undefined;
  }
};
type ContextForcreateSessionService = Parameters<
  typeof createSessionService
>[0];
const {
  inScope,
  acceptView,
  attachSession,
  startFrames,
  stopSession,
  interruptSession,
  startSession,
} = createSessionService({
  get goalGeneration() {
    return goalGeneration;
  },
  get activeTab() {
    return activeTab;
  },
  get lastObservation() {
    return lastObservation;
  },
  set lastObservation(value: string) {
    lastObservation = value;
  },
  get session() {
    return session;
  },
  set session(value: ContextForcreateSessionService["session"]) {
    session = value;
  },
  get live() {
    return live;
  },
  get originOf() {
    return originOf;
  },
  get ledgerNavigationEvent() {
    return ledgerNavigationEvent;
  },
  set ledgerNavigationEvent(
    value: ContextForcreateSessionService["ledgerNavigationEvent"],
  ) {
    ledgerNavigationEvent = value;
  },
  get refreshMemory() {
    return refreshMemory;
  },
  get remember() {
    return remember;
  },
  get save() {
    return save;
  },
  get knownSites() {
    return knownSites;
  },
  get knownTasks() {
    return knownTasks;
  },
  get navigationStarts() {
    return navigationStarts;
  },
});

void configureNativeSidebar();
let queue: Promise<unknown> = ready;
function enqueue<T>(operation: () => Promise<T>): Promise<T> {
  const next = queue.then(operation);
  queue = next.catch(() => {});
  return next;
}
type ContextForregisterMessages = Parameters<typeof registerMessages>[0];
registerMessages({
  get interruptSession() {
    return interruptSession;
  },
  get startSession() {
    return startSession;
  },
  get session() {
    return session;
  },
  set session(value: ContextForregisterMessages["session"]) {
    session = value;
  },
  get enqueue() {
    return enqueue;
  },
  get cancelVision() {
    return cancelVision;
  },
  get goalGeneration() {
    return goalGeneration;
  },
  set goalGeneration(value: ContextForregisterMessages["goalGeneration"]) {
    goalGeneration = value;
  },
  get stopSession() {
    return stopSession;
  },
  get suspended() {
    return suspended;
  },
  set suspended(value: ContextForregisterMessages["suspended"]) {
    suspended = value;
  },
  get activeTab() {
    return activeTab;
  },
  get ready() {
    return ready;
  },
  get originOf() {
    return originOf;
  },
  get memoryEpoch() {
    return memoryEpoch;
  },
  set memoryEpoch(value: ContextForregisterMessages["memoryEpoch"]) {
    memoryEpoch = value;
  },
  get knownSites() {
    return knownSites;
  },
  get memory() {
    return memory;
  },
  get cacheMemory() {
    return cacheMemory;
  },
  get knownTasks() {
    return knownTasks;
  },
  get refreshMemory() {
    return refreshMemory;
  },
  get handleNlp() {
    return handleNlp;
  },
  get inScope() {
    return inScope;
  },
  get live() {
    return live;
  },
  get save() {
    return save;
  },
  get acceptView() {
    return acceptView;
  },
  get remember() {
    return remember;
  },
  get lastVisionKey() {
    return lastVisionKey;
  },
  set lastVisionKey(value: ContextForregisterMessages["lastVisionKey"]) {
    lastVisionKey = value;
  },
  get attemptVision() {
    return attemptVision;
  },
  get attachSession() {
    return attachSession;
  },
  get memoryJobs() {
    return memoryJobs;
  },
  get lastObservation() {
    return lastObservation;
  },
  set lastObservation(value: ContextForregisterMessages["lastObservation"]) {
    lastObservation = value;
  },
  get startFrames() {
    return startFrames;
  },
});
type ContextForcreateJourneyService = Parameters<
  typeof createJourneyService
>[0];
const { handleNlp } = createJourneyService({
  withMaskedNavigation,
  get goalGeneration() {
    return goalGeneration;
  },
  set goalGeneration(value: ContextForcreateJourneyService["goalGeneration"]) {
    goalGeneration = value;
  },
  get session() {
    return session;
  },
  set session(value: ContextForcreateJourneyService["session"]) {
    session = value;
  },
  get enqueue() {
    return enqueue;
  },
  get live() {
    return live;
  },
  get inScope() {
    return inScope;
  },
  get knownSites() {
    return knownSites;
  },
  get knownTasks() {
    return knownTasks;
  },
  get attemptVision() {
    return attemptVision;
  },
  get suspended() {
    return suspended;
  },
  set suspended(value: ContextForcreateJourneyService["suspended"]) {
    suspended = value;
  },
  get acceptView() {
    return acceptView;
  },
  get remember() {
    return remember;
  },
  get save() {
    return save;
  },
});
type ContextForregisterNavigationEvents = Parameters<
  typeof registerNavigationEvents
>[0];
registerNavigationEvents({
  get enqueue() {
    return enqueue;
  },
  get session() {
    return session;
  },
  set session(value: ContextForregisterNavigationEvents["session"]) {
    session = value;
  },
  get save() {
    return save;
  },
  get live() {
    return live;
  },
  get ledgerNavigationEvent() {
    return ledgerNavigationEvent;
  },
  set ledgerNavigationEvent(
    value: ContextForregisterNavigationEvents["ledgerNavigationEvent"],
  ) {
    ledgerNavigationEvent = value;
  },
  get startFrames() {
    return startFrames;
  },
  get navigationStarts() {
    return navigationStarts;
  },
  get inScope() {
    return inScope;
  },
  get stopSession() {
    return stopSession;
  },
  get attachSession() {
    return attachSession;
  },
  get visionJob() {
    return visionJob;
  },
  set visionJob(value: ContextForregisterNavigationEvents["visionJob"]) {
    visionJob = value;
  },
  get cancelVision() {
    return cancelVision;
  },
  get captureWindowId() {
    return captureWindowId;
  },
});

api.permissions.onAdded.addListener(() => {
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
      !(await api.permissions.contains({
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
async function showWidgetForTab(tab: { id?: number; url?: string }) {
  if (tab.id === undefined || !tab.url || !/^https?:/.test(tab.url)) return;
  await enqueue(async () => {
    if (!session) {
      const result = await startSession({
        routeId: LIVE_ROUTE_ID,
        routeVersion: "1.0.0",
        tabId: tab.id,
        origin: originOf(tab.url),
      });
      if (result && "error" in result) return;
    }
    if (!session || session.tabId !== tab.id) return;
    await restoreWidgetSurface(session, "widget");
    await mountWidget(session, true);
  });
}
api.action.onClicked.addListener((tab) => {
  const captured = session;
  const native =
    hasNativeSidebar() &&
    tab.windowId !== undefined &&
    (browserTarget() === "firefox" ||
      preferredSurface(session) !== "widget" ||
      !session ||
      session.tabId !== tab.id ||
      !session.documentId ||
      session.navigationPending);
  // Firefox's embedded widget cannot call sidebarAction. The toolbar is the
  // explicit native user action; do not remove its widget until opening succeeds.
  const opened = native ? openNativeSidebar(tab.windowId!) : Promise.resolve();
  void opened
    .then(async () => {
      await recoverWebsiteAccess();
      if (captured && captured === session && captured.tabId === tab.id) {
        const frame = await api.webNavigation.getFrame({
          tabId: captured.tabId,
          frameId: 0,
        });
        if (captured !== session || frame?.documentId !== captured.documentId)
          return;
        await restoreSurface(captured, native ? "sidebar" : undefined);
      }
      if (native && !session) await rememberSurface("sidebar");
      if (!hasNativeSidebar()) await showWidgetForTab(tab);
      await mountWidget(session, true);
    })
    .catch(() => showWidgetForTab(tab));
});
watchNativePanels(() => session);
// Follow browser-confirmed server redirects only for the active authentication
// task. This permission supplies navigation metadata, not access to the new DOM.
// Ignore unrelated tabs/subframes before parsing URLs; never persist raw queries.
