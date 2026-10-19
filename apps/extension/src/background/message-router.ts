import type { createSessionService } from "./session-service";
import {
  getPrivateSetting,
  setPrivateSetting,
} from "../platform/private-settings";
import { api, type Tabs } from "../platform/api";
import type { createJourneyService } from "./journey-service";
import type { SuspendedJourney } from "../../../../packages/navigation-core/continuity";
import { taskKey } from "../../../../packages/goal-planner/task-journey";
import { suspendJourney } from "../../../../packages/navigation-core/continuity";
import { continuesDestination } from "../../../../packages/navigation-core/queue";
import {
  hash,
  livePreview,
  supportsLiveUrl,
  type SavedTask,
  type SiteMemory,
} from "../../../../packages/page-model/index";
import {
  previewRoute,
  routeRegistry,
} from "../../../../packages/route-registry/index";
import {
  sessionSchema,
  validPinnedView,
  type PinnedSession,
} from "../../../../packages/route-registry/session";
import { messageSchema } from "../../../../packages/route-schema/index";
import { BackgroundMemory } from "../../../../packages/site-memory/background";
import { IndexedDBDerivedStore } from "../../../../packages/site-memory/derived";
import {
  IndexedDBSiteMemory,
  memorySummary,
} from "../../../../packages/site-memory/index";
import { cancelNlp } from "../inference/client";
import {
  backendSettings,
  deleteBackendMemory,
  setBackendSettings,
} from "../platform/backend-client";
import { tabAppearance, validThemeSender } from "../ui/theme/theme-worker";
import {
  clearFrames,
  frameMessage,
  frameVisibilityMessage,
  routeFrameGuide,
  stopFrames,
} from "./frame-coordinator";
import {
  clearSurfacePresentation,
  invalidateUi,
  isPanel,
  isWidget,
  trustedUi,
  uiMessage,
  widgetCommands,
} from "./ui-transport";

interface Context {
  session: PinnedSession | undefined;
  enqueue: <T>(operation: () => Promise<T>) => Promise<T>;
  cancelVision: () => void;
  goalGeneration: number;
  stopSession: (reason?: string) => Promise<void>;
  suspended: SuspendedJourney[];
  activeTab: () => Promise<Tabs.Tab>;
  ready: Promise<void>;
  originOf: (url?: string) => string | undefined;
  memoryEpoch: number;
  knownSites: Map<string, SiteMemory | undefined>;
  memory: IndexedDBSiteMemory;
  cacheMemory: (
    origin: string,
    site: SiteMemory | undefined,
    tasks: SavedTask[],
  ) => void;
  knownTasks: Map<string, SavedTask[]>;
  refreshMemory: (origin: string) => void;
  handleNlp: ReturnType<typeof createJourneyService>["handleNlp"];
  inScope: (url: string) => boolean;
  live: () => boolean;
  save: () => Promise<void>;
  acceptView: (raw: unknown) => Promise<void>;
  remember: (observed?: unknown) => Promise<void>;
  lastVisionKey: string;
  attemptVision: (sessionId: string, requestId: string) => Promise<void>;
  attachSession: () => Promise<PinnedSession | undefined>;
  startSession: ReturnType<typeof createSessionService>["startSession"];
  memoryJobs: BackgroundMemory;
  lastObservation: string;
  startFrames: (current: PinnedSession) => Promise<void>;
}

export function registerMessages(context: Context) {
  api.runtime.onMessage.addListener((raw, sender, respond) => {
    if (raw?.type === "UI_RESET_SESSION") {
      if (!trustedUi(sender, context.session)) {
        respond({ error: "Trusted Tholi interface required." });
        return;
      }
      const captured = context.session;
      void context
        .enqueue(async () => {
          if (captured !== context.session)
            throw Error(
              "The task changed. Review the current session before resetting.",
            );
          context.cancelVision();
          context.goalGeneration++;
          await context.stopSession();
          const prior = context.session;
          context.session = undefined;
          await clearSurfacePresentation(prior);
          context.suspended = [];
          await api.storage.session.remove([
            "navigatorSession",
            "navigatorJourneys",
            "tholiConversation",
            "tholiDraft",
          ]);
          await api.storage.session.set({
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
        if (!trustedUi(sender, context.session))
          throw Error("Trusted Tholi interface required.");
        for (let attempt = 0; attempt < 2; attempt++) {
          const pinned = isWidget(sender, context.session)
            ? context.session?.tabId
            : undefined;
          const tab =
            pinned === undefined
              ? await context.activeTab()
              : await api.tabs.get(pinned);
          const appearance = tab ? await tabAppearance(tab) : undefined;
          if (!trustedUi(sender, context.session))
            throw Error("The website changed.");
          if (
            pinned !== undefined ||
            (await context.activeTab())?.id === tab?.id
          )
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
      if (raw.type === "UI_MINIMIZE" && trustedUi(sender, context.session))
        context.cancelVision();
      const operation = [
        "UI_OPEN_SIDEBAR",
        "UI_DOCK",
        "UI_MINIMIZE",
        "UI_DISMISS",
        "UI_RESTORE",
      ].includes(raw.type)
        ? uiMessage(raw, sender, context.session)
        : context.enqueue(() => uiMessage(raw, sender, context.session));
      void operation
        .then((result) => {
          if (raw.type === "UI_DISMISS") context.cancelVision();
          respond(result);
        })
        .catch((e) => respond({ error: e.message }));
      return true;
    }
    if (isWidget(sender, context.session) && !widgetCommands.has(raw?.type)) {
      respond({ error: "This setting is only available in the sidebar." });
      return;
    }

    if (raw?.target === "offscreen") return;
    if (raw?.type === "FRAME_VISIBILITY") {
      void context
        .enqueue(() => frameVisibilityMessage(raw, sender, context.session))
        .then(() => respond({ ok: true }))
        .catch(() => respond({ error: "Frame visibility unavailable" }));
      return true;
    }
    if (["FRAME_OBSERVATION", "FRAME_INTERACTION"].includes(raw?.type)) {
      void context
        .enqueue(async () => {
          const value = frameMessage(raw, sender, context.session);
          if (!value || !context.session)
            return { error: "Stale frame observation" };
          await api.tabs.sendMessage(context.session.tabId, {
            type:
              raw.type === "FRAME_OBSERVATION"
                ? "FRAME_OBSERVATION_PARENT"
                : "FRAME_INTERACTION_PARENT",
            sessionId: context.session.sessionId,
            frameId: value.frame.frameId,
            documentId: value.frame.documentId,
            tabId: context.session.tabId,
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
      void context
        .enqueue(async () => {
          if (
            !context.session ||
            sender.id !== api.runtime.id ||
            sender.tab?.id !== context.session.tabId ||
            sender.documentId !== context.session.documentId
          )
            return { error: "Stale frame request" };
          if (raw.type === "CLEAR_FRAME_GUIDANCE") {
            await clearFrames(context.session);
            return { ok: true };
          }
          const c = context.session.view?.page?.controls.find(
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
          return routeFrameGuide(raw, context.session);
        })
        .then(respond)
        .catch(() => respond({ error: "Frame unavailable" }));
      return true;
    }
    // Reject stale UI intent before it can cancel work for the current document.
    // Queued handlers recheck identity after asynchronous observation as well.
    if (
      raw?.type === "SET_GOAL" &&
      trustedUi(sender, context.session) &&
      ((raw.sessionId && raw.sessionId !== context.session?.sessionId) ||
        (raw.documentId && raw.documentId !== context.session?.documentId))
    ) {
      respond({
        error:
          "This destination belongs to a previous page. Send it on the current page.",
      });
      return;
    }
    if (
      sender.id === api.runtime.id &&
      trustedUi(sender, context.session) &&
      ["SET_GOAL", "CLARIFY", "STOP", "PAUSE", "RESUME_JOURNEY"].includes(
        raw?.type,
      )
    ) {
      context.goalGeneration++;
      context.cancelVision();
    }
    if (raw?.type === "VISION_INVALIDATED") {
      if (
        sender.id === api.runtime.id &&
        sender.tab?.id === context.session?.tabId &&
        sender.documentId === context.session?.documentId &&
        raw.sessionId === context.session?.sessionId
      )
        context.cancelVision();
      respond({ ok: true });
      return;
    }
    if (raw?.type === "GET_MEMORY") {
      if (
        sender.id !== api.runtime.id ||
        !trustedUi(sender, context.session) ||
        !messageSchema.safeParse(raw).success
      ) {
        respond({ error: "Trusted extension panel required." });
        return;
      }
      // Cold hydration may wait for disk; it must not occupy the guidance queue.
      void (async () => {
        await context.ready;
        const tab = await context.activeTab(),
          origin = context.originOf(tab?.url) || context.session?.origin;
        const epoch = context.memoryEpoch;
        if (origin && !context.knownSites.has(origin)) {
          const site = await context.memory.get(origin);
          if (epoch === context.memoryEpoch)
            context.cacheMemory(
              origin,
              site,
              context.knownTasks.get(origin) || [],
            );
        }
        if (origin) context.refreshMemory(origin);
        return {
          origin,
          memory: origin ? context.knownSites.get(origin) : undefined,
          view: context.session?.view,
        };
      })()
        .then(respond)
        .catch(() =>
          respond({
            error: "Site memory is temporarily unavailable.",
            view: context.session?.view,
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
      void context
        .handleNlp(raw, sender)
        .then(respond)
        .catch((error) =>
          respond({
            error:
              error instanceof Error ? error.message : "Local planning failed.",
          }),
        );
      return true;
    }
    context
      .enqueue(async () => {
        if (sender.id !== api.runtime.id) return { error: "Invalid sender." };
        if (raw?.type === "SESSION_UPDATE") {
          if (
            !context.session ||
            raw.sessionId !== context.session.sessionId ||
            sender.tab?.id !== context.session.tabId ||
            sender.documentId !== context.session.documentId ||
            !context.inScope(sender.url || "")
          )
            return { error: "Stale or invalid session update." };
          if (
            context.session.view?.status === "stopped" ||
            (context.session.view?.status === "paused" &&
              raw.view?.status === "running")
          )
            return { error: "Inactive session update." };
          const incoming = validPinnedView(context.session, raw.view);
          if (!incoming) return { error: "Invalid page observation." };
          if (
            context.session.view &&
            incoming.verifiedSteps < context.session.view.verifiedSteps
          )
            return { error: "Older progress observation." };
          if (
            context.session.view?.page &&
            incoming.page &&
            incoming.page.revision < context.session.view.page.revision
          )
            return { error: "Older scan observation." };
          if (incoming.journey?.id !== context.session.view?.journey?.id) {
            const queueAdvance =
              incoming.request?.id === context.session.view?.request?.id &&
              incoming.request &&
              incoming.journey?.requestTaskId ===
                incoming.request.tasks[incoming.request.active]?.id &&
              incoming.journey?.requestTaskId !==
                context.session.view?.journey?.requestTaskId;
            if (!queueAdvance) return { error: "Older journey observation." };
          }
          if (
            context.session.view?.request &&
            context.session.view.status === "running" &&
            incoming.request?.id !== context.session.view.request.id
          )
            return { error: "Older request observation." };
          if (
            context.session.view?.request &&
            incoming.request &&
            incoming.request.id === context.session.view.request.id &&
            incoming.request.active < context.session.view.request.active
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
              context.session.pendingNavigation = nav.data;
          }
          // A click publication may arrive after Chrome's loading event. Preserve its intent
          // without restoring the previous document's running state or controls.
          if (context.session.navigationPending && context.live()) {
            await context.save();
            return { ok: true };
          }
          await context.acceptView(incoming);
          if (
            !incoming.selectedControlId &&
            (incoming.stateId === "verified" ||
              (incoming.status === "running" &&
                incoming.goalPlan?.status === "unresolved"))
          )
            context.session.pendingNavigation = undefined;
          await context.remember(raw.observed);
          await context.save();
          return { ok: true };
        }
        if (!trustedUi(sender, context.session))
          return { error: "Extension panel required." };
        const parsed = messageSchema.safeParse(raw);
        if (!parsed.success) return { error: "Invalid command." };
        const command = parsed.data;
        if (command.type === "CHECK_VISUAL_ACTION") {
          if (
            !context.session ||
            context.session.view?.goalPlan?.action?.kind !== "visual"
          )
            return { error: "No visual suggestion is pending." };
          const response = await api.tabs.sendMessage(context.session.tabId, {
            type: "RECHECK_JOURNEY",
            sessionId: context.session.sessionId,
          });
          if (response.view) await context.acceptView(response.view);
          await context.save();
          return context.session;
        }
        if (command.type === "GET_VISION")
          return {
            backend: !!(await getPrivateSetting<{ backend: boolean }>("vision"))
              ?.backend,
          };
        if (command.type === "SET_VISION") {
          await setPrivateSetting("vision", { backend: command.backend });
          return { ok: true };
        }
        if (command.type === "REQUEST_VISION") {
          context.lastVisionKey = "";
          if (context.session?.view?.request)
            void context.attemptVision(
              context.session.sessionId,
              context.session.view.request.id,
            );
          return { ok: true };
        }
        if (command.type === "GET_JOURNEYS")
          return {
            journeys: context.suspended.map((e) => ({
              id: e.id,
              goal: e.journey.goal,
              pausedAt: e.pausedAt,
            })),
          };
        if (command.type === "DELETE_JOURNEY") {
          context.suspended = context.suspended.filter(
            (e) => e.id !== command.id,
          );
          await context.save();
          return { ok: true };
        }
        if (command.type === "RESUME_JOURNEY") {
          const entry = context.suspended.find((e) => e.id === command.id);
          if (!entry || !context.session || !context.live())
            return {
              error: "Start navigation on the website before resuming.",
            };
          const tab = await context.activeTab();
          if (
            tab?.id !== context.session.tabId ||
            context.originOf(tab.url) !== entry.origin
          )
            return {
              error:
                "Open the journey's website and start navigation there, then resume this task.",
            };
          const parked =
            context.session.view?.journey &&
            context.session.view.request &&
            suspendJourney(
              context.session.view.journey,
              context.session.view.request,
              context.session.origin!,
              context.session.tabId,
            );
          context.suspended = context.suspended.filter(
            (e) => e.id !== entry.id,
          );
          if (parked && !context.suspended.some((e) => e.id === parked.id))
            context.suspended.push(parked);
          if (!context.session.view)
            return { error: "Fresh website handshake required." };
          context.session.view.journey = entry.journey;
          context.session.view.request = {
            ...entry.request,
            status: entry.request.resumeStatus || "active",
            resumeStatus: undefined,
          };
          context.session.view.goalPlan = undefined;
          const response = await api.tabs.sendMessage(context.session.tabId, {
            type: "RESTORE_JOURNEY",
            sessionId: context.session.sessionId,
            journey: entry.journey,
            request: context.session.view.request,
          });
          if (response?.view) await context.acceptView(response.view);
          await context.save();
          return context.session;
        }
        if (command.type === "CHECK_ROUTE_ACTION") {
          const action = context.session?.view?.goalPlan?.action;
          if (
            !context.session ||
            !action ||
            !["history-back", "tab-switch"].includes(action.kind)
          )
            return { error: "No return action is pending." };
          if (action.kind !== "history-back" && action.kind !== "tab-switch")
            return;
          const tab = await context.activeTab();
          const entry = context.session.ledger?.find(
            (e) => e.id === action.entryId,
          );
          if (
            !entry ||
            tab?.id !== action.tabId ||
            context.originOf(tab.url) !== entry.origin
          )
            return {
              error:
                "Return to the indicated website tab first. The destination is still retained.",
            };
          if (
            context.session.tabId !== tab.id ||
            !context.session.documentId ||
            context.session.navigationPending
          ) {
            context.session.tabId = tab.id;
            context.session.documentId = undefined;
          }
          await context.attachSession();
          const current = context.session.view?.page;
          if (!current || current.stateKey !== action.expectedState)
            return {
              error:
                "That page changed. Your task remains incomplete; fresh navigation will be recalculated.",
              view: context.session.view,
            };
          return context.session;
        }
        if (command.type === "GET_BACKEND")
          return isPanel(sender)
            ? backendSettings()
            : { error: "Sidebar required." };
        if (command.type === "SET_BACKEND")
          return isPanel(sender)
            ? setBackendSettings(command)
            : { error: "Sidebar required." };
        if (command.type === "GET_SESSION") return context.session || {};
        if (command.type === "GET_TASKS" || command.type === "DELETE_TASK") {
          const tab = await context.activeTab(),
            origin = context.originOf(tab?.url);
          if (!origin) return { tasks: [] };
          if (command.type === "DELETE_TASK") {
            await context.memoryJobs.cancelAndDrain();
            if (
              (await context.memory.tasks(origin)).some(
                (t) => t.id === command.id,
              )
            ) {
              await context.memory.deleteTask(command.id);
              if (context.session) {
                context.session.forgottenTaskIds = [
                  ...new Set([
                    ...(context.session.forgottenTaskIds || []),
                    command.id,
                  ]),
                ].slice(-100);
                await context.save();
              }
            }
            context.knownTasks.set(origin, await context.memory.tasks(origin));
            context.lastObservation = "";
          }
          context.refreshMemory(origin);
          return { tasks: context.knownTasks.get(origin) || [] };
        }
        if (command.type === "GET_CONTEXT") {
          const tab = await context.activeTab(),
            origin = context.originOf(tab?.url),
            available = supportsLiveUrl(tab?.url || ""),
            continuation = context.session?.view?.continuationOrigin
              ? context.session.pendingNavigation
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
            !(await api.permissions.contains({
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
              context.session &&
              tab?.id &&
              (tab.id === context.session.tabId ||
                tab.openerTabId === context.session.tabId) &&
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
            session: context.session || null,
            sessionRoute: context.session
              ? context.live()
                ? livePreview(context.session.origin!)
                : previewRoute(
                    routeRegistry.get(
                      context.session.routeId,
                      context.session.routeVersion,
                    )!,
                  )
              : undefined,
          };
        }
        if (command.type === "FORGET_SITE" || command.type === "CLEAR_MEMORY") {
          const tab = await context.activeTab(),
            origin = context.originOf(tab?.url) || context.session?.origin;
          if (
            context.live() &&
            (command.type === "CLEAR_MEMORY" ||
              origin === context.session?.origin)
          )
            await context.stopSession(
              "Site memory cleared. Start navigation to learn this page again.",
            );
          await context.memoryJobs.cancelAndDrain();
          command.type === "CLEAR_MEMORY"
            ? await context.memory.clear()
            : origin && (await context.memory.forget(origin));
          context.memoryEpoch++;
          // Local deletion is authoritative even if the optional mirror is offline.
          if (command.type === "CLEAR_MEMORY") {
            context.knownSites.clear();
            context.knownTasks.clear();
          } else if (origin) {
            context.knownSites.delete(origin);
            // Forget also removes routes whose verified progress visited this site.
            context.knownTasks.clear();
          }
          context.lastObservation = "";
          if (context.session?.view && context.live()) {
            context.session.view.memory = memorySummary();
            context.session.view.goalPlan = undefined;
            context.session.view.journey = undefined;
            await context.save();
          }
          await cancelNlp();
          await new IndexedDBDerivedStore().clearDerived(
            command.type === "CLEAR_MEMORY" ? undefined : origin,
          );
          await deleteBackendMemory(
            command.type === "CLEAR_MEMORY" ? undefined : origin,
          );
          if (origin) context.refreshMemory(origin);
          return {
            origin,
            memory: origin ? context.knownSites.get(origin) : undefined,
            view: context.session?.view,
          };
        }
        if (command.type === "START") return context.startSession(command);
        if (!context.session)
          return command.type === "STOP"
            ? {}
            : { error: "Start navigation first." };
        if (
          command.type === "SET_GOAL" &&
          ((command.sessionId &&
            command.sessionId !== context.session.sessionId) ||
            (command.documentId &&
              command.documentId !== context.session.documentId))
        )
          return {
            error:
              "This destination belongs to a previous page. Send it on the current page.",
          };
        if (command.type === "STOP") {
          await context.stopSession();
          return structuredClone(context.session);
        }
        const tab = await context.activeTab();
        if (
          command.type === "CONTINUE_TASK" &&
          context.session.view &&
          context.session.pendingNavigation &&
          continuesDestination(
            context.session.view.journey,
            context.session.view.request,
          )
        ) {
          const nav = context.session.pendingNavigation;
          if (
            !tab?.id ||
            (tab.id !== context.session.tabId &&
              tab.openerTabId !== context.session.tabId)
          )
            return {
              error:
                "Return to the expected destination tab to continue this task.",
            };
          // Chrome withholds a destination tab's URL until its host access is
          // granted. Request only the clicked link's origin; validate the actual
          // destination after that grant, before observing or advancing the task.
          const expected = new URL(nav.origin);
          const granted = await api.permissions.contains({
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
            hash(url.origin + url.pathname + url.search) !==
              nav.navigationKey ||
            url.origin !== nav.origin
          )
            return {
              error:
                "Return to the expected destination tab to continue this task.",
            };
          if (
            tab.id !== context.session.tabId &&
            context.session.view.journey?.workflow &&
            !context.session.handoffReturn
          )
            context.session.handoffReturn = {
              tabId: context.session.tabId,
              origin: context.session.origin!,
            };
          context.session.tabId = tab.id;
          context.session.origin = url.origin;
          context.session.documentId = undefined;
          context.session.view.continuationOrigin = undefined;
          context.session.view.status = "running";
          return await context.attachSession();
        }
        if (command.type !== "PAUSE" && tab?.id !== context.session.tabId)
          return { error: "Return to the tab where this task started." };
        if (
          command.type === "RESUME" &&
          context.session.navigationPending &&
          context.live()
        ) {
          if (!context.inScope(tab.url || ""))
            return {
              error:
                "This page is outside the session's website. Start a new session here.",
            };
          return await context.attachSession();
        }
        if (
          ["GUIDE_CONTROL", "GET_PAGE", "SET_GOAL"].includes(command.type) &&
          (!context.live() ||
            context.session.navigationPending ||
            context.session.view?.status !== "running")
        )
          return {
            error: "Start or resume live navigation on the current page first.",
          };
        const outgoing =
          command.type === "PAUSE" || command.type === "RESUME"
            ? {
                type: "CONTROL_SESSION",
                action: command.type,
                sessionId: context.session.sessionId,
              }
            : { ...command, sessionId: context.session.sessionId };
        try {
          const reply = await api.tabs.sendMessage(
            context.session.tabId,
            outgoing,
          );
          if (reply?.error) return reply;
          if (command.type === "GET_PAGE")
            return {
              page: reply.page,
              sessionId: context.session.sessionId,
              documentId: context.session.documentId,
              journey: context.session.view?.journey,
            };
          if (
            command.type === "SET_GOAL" &&
            !command.journeyId &&
            context.session.view?.journey
          )
            context.session.forgottenTaskIds =
              context.session.forgottenTaskIds?.filter(
                (id) => id !== taskKey(context.session!.view!.journey!),
              );
          await context.acceptView(reply?.view);
          if (command.type === "PAUSE") await stopFrames();
          if (command.type === "RESUME" && context.live())
            void context.startFrames(context.session).catch(() => {});
          await context.remember();
          await context.save();
          return structuredClone(context.session);
        } catch {
          await context.stopSession(
            "Page unavailable. Click the extension icon on the website and start again.",
          );
          return {
            error: "The website is unavailable. Start navigation again.",
          };
        }
      })
      .then(respond)
      .catch((error) =>
        respond({
          error:
            error instanceof Error
              ? error.message
              : "Navigation command failed.",
        }),
      );
    return true;
  });
}
