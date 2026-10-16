import { unresolvedTitle } from "./presentationLabels";
import { applyAppearance } from "../theme/apply-appearance";
import { useEffect, useState, useRef } from "react";
import type { RoutePreview } from "../../../../../packages/route-registry";
import type { SessionView } from "../../../../../packages/shared-types";
import {
  LIVE_ROUTE_ID,
  LIVE_VERSION,
  pageSnapshotSchema,
  type SavedTask,
  type RouteStrategy,
} from "../../../../../packages/page-model";
import { beginJourney } from "../../../../../packages/goal-planner/task-journey";
import { sanitizeGoal } from "../../../../../packages/privacy-redaction";
import { LocalModel, modelAvailability } from "../../local-model";
import { memorySummary } from "../../../../../packages/site-memory";
import { liveReport } from "../../../../../packages/live-diagnostics";
import { requestCurrentSiteAccess } from "../../site-access";
import {
  defaultPreferences,
  type UIPreferences,
} from "../../../../../packages/ui/guidance";
import {
  present,
  appendMessage,
  conversationCommand,
  clarificationReply,
  explainStep,
  type ConversationMessage,
} from "../../../../../packages/ui/presentation";
export function useGuidanceController(widget = false) {
  const [preferences, setPreferences] =
    useState<UIPreferences>(defaultPreferences);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [hydrated, setHydrated] = useState(false);
  const preferencesPending = useRef(false);
  const lastSurface = useRef<"sidebar" | "widget" | undefined>(undefined);
  const [view, setView] = useState<SessionView>();
  const [context, setContext] = useState<{
    tabId?: number;
    origin?: string;
    siteAccessRequired?: boolean;
    canContinueTask?: boolean;
    routes: RoutePreview[];
    reason?: string;
    sessionRoute?: RoutePreview;
    session?: { tabId: number; view?: SessionView };
  }>();
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState<{
    id: string;
    text: string;
    tone?: "info" | "success";
  }>();
  const [busy, setBusy] = useState(false);
  const focusIntent = useRef<"composer" | "resume" | undefined>(undefined);
  useEffect(() => {
    if (busy || !focusIntent.current) return;
    const frame = requestAnimationFrame(() => {
      let target =
        focusIntent.current === "resume"
          ? document.querySelector<HTMLButtonElement>(
              'button[aria-label="Resume navigation"]',
            )
          : (document.getElementById(
              "tholi-destination-input",
            ) as HTMLTextAreaElement | null);
      if (
        focusIntent.current === "resume" &&
        (!target || !target.getClientRects().length)
      )
        target = document.querySelector<HTMLButtonElement>(
          'button[aria-label="Widget menu"]',
        );
      if (target && !target.disabled && target.getClientRects().length) {
        target.focus();
        focusIntent.current = undefined;
      }
    });
    return () => cancelAnimationFrame(frame);
  }, [busy, view?.status, hydrated]);
  const [visionBackend, setVisionBackend] = useState(false);
  const [debug, setDebug] = useState(false);
  const [controlFilter, setControlFilter] = useState("");
  const [goal, setGoal] = useState("");
  const [suggestions, setSuggestions] = useState<
    { label: string; signature: string }[]
  >([]);
  const [backend, setBackend] = useState({
    url: "http://127.0.0.1:8787",
    token: "",
    enabled: false,
  });
  const [strategy, setStrategy] = useState<RouteStrategy>("fastest");
  const [journeys, setJourneys] = useState<{ id: string; goal: string }[]>([]);
  const [savedTasks, setSavedTasks] = useState<SavedTask[]>([]);
  const automaticAttempts = useRef(new Set<string>());
  const [aiAvailability, setAiAvailability] = useState("checking");
  const [aiEnabled, setAiEnabled] = useState(false);
  const [aiProgress, setAiProgress] = useState<number>();
  const [storedMemory, setStoredMemory] = useState(memorySummary());
  useEffect(() => {
    if (widget) return;
    void chrome.runtime
      .sendMessage({ type: "GET_VISION" })
      .then((r) => setVisionBackend(!!r.backend))
      .catch(() => {});
    void chrome.runtime
      .sendMessage({ type: "GET_BACKEND" })
      .then((r) => {
        if (!r.error) setBackend(r);
      })
      .catch(() => {});
  }, []);
  useEffect(() => {
    let current = true;
    if (!goal.trim() || view?.status !== "running") {
      setSuggestions([]);
      return;
    }
    const timer = setTimeout(() => {
      void chrome.runtime
        .sendMessage({
          type: "NLP_SUGGEST",
          text: goal,
          requestId: crypto.randomUUID(),
        })
        .then((r) => {
          if (current) setSuggestions(r.suggestions || []);
        })
        .catch(() => {});
    }, 400);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [goal, view?.status]);
  useEffect(() => {
    let current = true;
    void chrome.runtime
      .sendMessage({ type: "GET_MEMORY" })
      .then((r) => {
        if (current) setStoredMemory(memorySummary(r.memory));
      })
      .catch(() => {});
    return () => {
      current = false;
    };
  }, [context?.origin]);
  useEffect(() => {
    let current = true;
    let reading = false;
    const refresh = () => {
      if (reading) return;
      reading = true;
      void chrome.runtime
        .sendMessage({ type: "GET_TASKS" })
        .then((r) => {
          if (current) setSavedTasks(r.tasks || []);
        })
        .catch(() => {})
        .finally(() => {
          reading = false;
        });
    };
    const refreshJourneys = async () => {
      if (!current) return;
      refresh();
      try {
        const r = await chrome.runtime.sendMessage({ type: "GET_JOURNEYS" });
        if (current) setJourneys(r.journeys || []);
      } catch {
        // The worker may be restarting.
      }
    };
    void refreshJourneys();
    const timer = setInterval(() => void refreshJourneys(), 2000);
    return () => {
      current = false;
      clearInterval(timer);
    };
  }, [context?.origin]);
  const model = useRef(new LocalModel());
  const planning = useRef<AbortController | undefined>(undefined);
  useEffect(() => {
    void modelAvailability().then(setAiAvailability);
    return () => {
      planning.current?.abort();
      void model.current.close().catch(() => {});
    };
  }, []);
  useEffect(() => {
    let current = true;
    let reading = false;
    let readingAppearance = false;
    const refreshAppearance = () => {
      if (readingAppearance) return;
      readingAppearance = true;
      void chrome.runtime
        .sendMessage({ type: "UI_APPEARANCE" })
        .then((r) => {
          if (current && !r?.error)
            applyAppearance(
              r?.appearance === "light" || r?.appearance === "dark"
                ? r.appearance
                : undefined,
            );
        })
        .catch(() => {})
        .finally(() => {
          readingAppearance = false;
        });
    };
    const refresh = () => {
      refreshAppearance();
      if (reading) return;
      reading = true;
      chrome.runtime
        .sendMessage({ type: "GET_CONTEXT" })
        .then((r) => {
          if (current && r?.routes) {
            setContext(r);
            setView(r.session?.view);
          }
        })
        .catch(() => {})
        .finally(() => {
          reading = false;
        });
    };
    refresh();
    const port = chrome.runtime.connect({
      name: widget ? "tholi-widget" : "tholi-panel",
    });
    port?.onMessage.addListener(refresh);
    chrome.tabs.onActivated.addListener(refresh);
    const interval = setInterval(refresh, 1000);
    return () => {
      current = false;
      clearInterval(interval);
      chrome.tabs.onActivated.removeListener(refresh);
      port?.disconnect();
    };
  }, []);
  const command = async (
    type: string,
    payload: Record<string, unknown> = {},
  ) => {
    planning.current?.abort();
    setBusy(true);
    setError("");
    try {
      let startTarget: { tabId: number; origin: string } | undefined;
      if (
        (type === "START" && (!route || route.id === LIVE_ROUTE_ID)) ||
        (type === "CONTINUE_TASK" && view?.continuationOrigin)
      ) {
        startTarget = await requestCurrentSiteAccess(
          type === "CONTINUE_TASK" ? view!.continuationOrigin! : undefined,
        );
      }
      const r = await chrome.runtime.sendMessage(
        type === "START"
          ? {
              type,
              routeId: route?.id || LIVE_ROUTE_ID,
              routeVersion: route?.version || LIVE_VERSION,
              ...startTarget,
            }
          : { type, ...payload },
      );
      if (r?.error) setError(r.error);
      if (r?.view) setView(r.view);
      if (type === "FORGET_SITE" || type === "CLEAR_MEMORY") {
        setStoredMemory(memorySummary());
        setAiEnabled(false);
        await model.current.close().catch(() => {});
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Command failed.");
    } finally {
      if (["STOP", "RESUME"].includes(type)) focusIntent.current = "composer";
      if (type === "PAUSE") focusIntent.current = "resume";
      setBusy(false);
    }
  };
  const active =
    !!view && ["running", "waiting", "rerouting"].includes(view.status);
  const paused = !!view && ["paused", "checkpoint"].includes(view.status);
  const locked = active || paused || busy;
  const preview =
    context?.routes.find((r) => r.id === selectedId) || context?.routes[0];
  const keepEndedRoute =
    view &&
    context?.sessionRoute?.id === view.routeId &&
    context.sessionRoute.origins.includes(context.origin || "") &&
    (!selectedId || selectedId === view.routeId);
  const route =
    active || paused || keepEndedRoute
      ? context?.sessionRoute || preview
      : preview;
  const displayedView =
    view &&
    (!route ||
      (route.id === view.routeId &&
        route.version === view.routeVersion &&
        (active ||
          paused ||
          route.id !== LIVE_ROUTE_ID ||
          context?.sessionRoute?.origins.includes(context.origin || ""))))
      ? view
      : undefined;
  const otherTab =
    (active || paused) && context?.tabId !== context?.session?.tabId;
  const controlsMode = route?.id === LIVE_ROUTE_ID;
  const statusLabel =
    displayedView?.status === "running"
      ? controlsMode && displayedView.page?.screen?.kind === "two-factor"
        ? "Waiting for verification"
        : controlsMode && displayedView.page?.screen?.kind === "credentials"
          ? "Waiting for sign-in"
          : controlsMode && displayedView.goalPlan?.recoveryStage
            ? "Finding your next step"
            : !controlsMode
              ? "Guiding"
              : displayedView.goalPlan?.status === "completed"
                ? "Goal verified"
                : displayedView.goalPlan?.status === "awaiting-choice"
                  ? "Choose an option"
                  : displayedView.goalPlan?.status === "unresolved"
                    ? unresolvedTitle(displayedView.goalPlan)
                    : displayedView.selectedControlId
                      ? "Guiding"
                      : "Ready to guide"
      : displayedView?.status === "waiting"
        ? "Waiting for the website"
        : displayedView?.status === "boundary"
          ? "Review required"
          : displayedView?.status || "Ready when you are";
  const memoryStats =
    active ||
    paused ||
    context?.sessionRoute?.origins.includes(context.origin || "")
      ? view?.memory || storedMemory
      : storedMemory;
  const submitGoal = async (saved?: SavedTask) => {
    const safeGoal = sanitizeGoal(saved?.goal || goal);
    if (!safeGoal) return;
    planning.current?.abort();
    const controller = new AbortController();
    planning.current = controller;
    setBusy(true);
    setError("");
    try {
      if (!active) {
        const startTarget = await requestCurrentSiteAccess();
        const started = await chrome.runtime.sendMessage({
          type: "START",
          routeId: LIVE_ROUTE_ID,
          routeVersion: LIVE_VERSION,
          ...startTarget,
        });
        if (started.error) throw new Error(started.error);
        if (started.view) setView(started.view);
      }
      const context = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
      if (context.error) throw new Error(context.error);
      const page = pageSnapshotSchema.parse(context.page);
      let proposal;
      if (aiEnabled) {
        try {
          proposal = await model.current.propose(
            page,
            safeGoal,
            controller.signal,
            beginJourney(safeGoal, page.origin, saved?.strategy || strategy),
          );
        } catch (error) {
          if (controller.signal.aborted) return;
          setError(
            "On-device interpretation failed; using live semantic matching.",
          );
        }
      }
      if (controller.signal.aborted) return;
      const current = await chrome.runtime.sendMessage({ type: "GET_SESSION" });
      if (
        current.sessionId !== context.sessionId ||
        current.documentId !== context.documentId
      )
        throw new Error(
          "The document changed while planning. Try again on the current page.",
        );
      const reply = await chrome.runtime.sendMessage({
        type: "SET_GOAL",
        goal: safeGoal,
        revision: page.revision,
        strategy: saved?.strategy || strategy,
        ...(saved ? { savedRouteId: saved.id } : {}),
        ...(proposal ? { proposal } : {}),
      });
      if (reply.error) throw new Error(reply.error);
      if (reply.view) {
        setView(reply.view);
        if (preferences.mode === "conversation") setGoal("");
        focusIntent.current = "composer";
      }
    } catch (error) {
      if (!controller.signal.aborted)
        setError(
          error instanceof Error ? error.message : "Could not plan this goal.",
        );
    } finally {
      if (planning.current === controller) {
        planning.current = undefined;
        setBusy(false);
      }
    }
  };
  useEffect(() => {
    const task = view?.journey,
      page = view?.page;
    if (
      !aiEnabled ||
      busy ||
      otherTab ||
      view?.status !== "running" ||
      !task ||
      task.status !== "active" ||
      !page
    )
      return;
    const key = task.id + ":" + page.stateKey + ":" + task.progress.length;
    if (automaticAttempts.current.has(key)) return;
    automaticAttempts.current.add(key);
    if (automaticAttempts.current.size > 50)
      automaticAttempts.current.delete(
        automaticAttempts.current.values().next().value!,
      );
    const controller = new AbortController();
    planning.current = controller;
    void (async () => {
      try {
        const current = await chrome.runtime.sendMessage({ type: "GET_PAGE" });
        if (current.error || current.journey?.id !== task.id) return;
        const fresh = pageSnapshotSchema.parse(current.page);
        const proposal = await model.current.propose(
          fresh,
          task.goal,
          controller.signal,
          current.journey,
        );
        if (controller.signal.aborted) return;
        const latest = await chrome.runtime.sendMessage({
          type: "GET_SESSION",
        });
        if (
          latest.sessionId !== current.sessionId ||
          latest.documentId !== current.documentId ||
          latest.view?.journey?.id !== task.id
        )
          return;
        const reply = await chrome.runtime.sendMessage({
          type: "SET_GOAL",
          goal: task.goal,
          revision: fresh.revision,
          journeyId: task.id,
          proposal,
        });
        if (reply.view) setView(reply.view);
      } catch {
        /* Live planning continues if the optional model fails. */
      } finally {
        if (planning.current === controller) planning.current = undefined;
      }
    })();
    return () => controller.abort();
  }, [
    aiEnabled,
    busy,
    otherTab,
    view?.status,
    view?.journey?.id,
    view?.journey?.progress.length,
    view?.page?.stateKey,
  ]);
  const enableAI = async () => {
    setError("");
    setAiProgress(0);
    try {
      await model.current.enable(setAiProgress);
      setAiEnabled(true);
      setAiAvailability("available");
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "On-device AI could not start.",
      );
    } finally {
      setAiProgress(undefined);
    }
  };
  const guideControl = async (controlId: string) => {
    setBusy(true);
    setError("");
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "GUIDE_CONTROL",
        controlId,
      });
      if (reply?.error) setError(reply.error);
      if (reply?.view) setView(reply.view);
    } catch {
      setError(
        "Could not locate this control. Refresh the page controls and try again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const downloadReport = (category: string) => {
    const report =
      controlsMode && view
        ? liveReport(view, category)
        : {
            category,
            routeId: view?.routeId || route?.id,
            routeVersion: view?.routeVersion || route?.version,
            stateId: view?.stateId,
            status: view?.status,
            verifiedSteps: view?.verifiedSteps,
            reportedAt: new Date().toISOString(),
            ...(category === "diagnostics"
              ? { diagnostics: view?.diagnostics, history: view?.history }
              : {}),
          };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "tholi-route-report.json";
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  const presentation = present(
    displayedView,
    busy
      ? active
        ? "Finding your route"
        : "Starting"
      : !context
        ? "Starting"
        : undefined,
    otherTab || !!view?.continuationOrigin,
  );
  useEffect(() => {
    const refresh = () =>
      void chrome.runtime
        .sendMessage({ type: "UI_GET" })
        .then((r) => {
          if (r.error) return;
          if (!preferencesPending.current) setPreferences(r.preferences);
          setMessages(r.messages);
          const becomingVisible =
            lastSurface.current !== r.preferences.surface &&
            r.preferences.surface === (widget ? "widget" : "sidebar");
          lastSurface.current = r.preferences.surface;
          // Handoffs hydrate the destination without overwriting active typing.
          if (!hydrated || becomingVisible) {
            setGoal(r.draft);
            setHydrated(true);
          }
        })
        .catch(() => {});
    refresh();
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ) => {
      if (area === "session" && changes.tholiSessionReset) {
        planning.current?.abort();
        setGoal("");
        setMessages([]);
        setView(undefined);
        setJourneys([]);
        setError("");
      }
      if (
        (area === "session" &&
          (changes.tholiConversation ||
            changes.tholiDraft ||
            changes.tholiSurfacePresentation ||
            changes.tholiSessionReset)) ||
        (area === "local" && changes.tholiPreferences)
      )
        refresh();
    };
    chrome.storage.onChanged.addListener(listener);
    return () => chrome.storage.onChanged.removeListener(listener);
  }, [hydrated]);
  useEffect(() => {
    if (!hydrated) return;
    const id = setTimeout(
      () => void chrome.runtime.sendMessage({ type: "UI_SAVE", draft: goal }),
      200,
    );
    return () => clearTimeout(id);
  }, [goal, hydrated]);
  const addMessage = async (
    role: "user" | "guide",
    text: string,
    id: string = crypto.randomUUID(),
  ) => {
    const message = { id, role, text: text.slice(0, 1500), at: Date.now() };
    setMessages((m) => appendMessage(m, message));
    await chrome.runtime.sendMessage({ type: "UI_APPEND", message });
  };
  const explainCurrentStep = async () => {
    await addMessage("guide", explainStep(view));
  };
  const newDestination = () => {
    setGoal("");
    setError("");
    requestAnimationFrame(() =>
      document.getElementById("tholi-destination-input")?.focus(),
    );
  };
  const resetCurrentSession = async () => {
    planning.current?.abort();
    setBusy(true);
    try {
      const reply = await chrome.runtime.sendMessage({
        type: "UI_RESET_SESSION",
      });
      if (reply.error) throw Error(reply.error);
      setView(undefined);
      setGoal("");
      setMessages([]);
      setJourneys([]);
      setError("");
      setNotice({
        id: crypto.randomUUID(),
        text: "Session reset. Your saved routes and website knowledge are kept.",
        tone: "success",
      });
      requestAnimationFrame(() =>
        document.getElementById("tholi-destination-input")?.focus(),
      );
    } catch (error) {
      setError(
        error instanceof Error
          ? error.message
          : "Could not reset this session.",
      );
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (!hydrated || !displayedView) return;
    void addMessage(
      "guide",
      presentation.instruction,
      "step:" + presentation.stepId,
    );
  }, [presentation.stepId, hydrated]);
  const submit = async () => {
    const text = goal.trim();
    if (!text) return;
    void addMessage("user", text);
    if (preferences.mode === "conversation") {
      const action = conversationCommand(text);
      if (action === "WHY") {
        await addMessage("guide", explainStep(view));
        setGoal("");
        return;
      }
      if (action) {
        await command(action);
        setGoal("");
        return;
      }
      const choice =
        view?.clarification &&
        clarificationReply(text, view.clarification.choices);
      if (choice) {
        await command("CLARIFY", { choice });
        setGoal("");
        return;
      }
      if (
        /^(?:what is|who is|tell me a joke|write me|explain quantum|what's the weather)/i.test(
          text,
        )
      ) {
        await addMessage(
          "guide",
          "I can guide website tasks and explain the selected step. Tell me where you want to go on this website.",
        );
        setGoal("");
        return;
      }
    }
    await submitGoal();
  };
  const changePreferences = async (next: UIPreferences) => {
    const previous = preferences;
    preferencesPending.current = true;
    setPreferences(next);
    try {
      if (next.surface === "sidebar" && widget) {
        const opened = await chrome.runtime.sendMessage({
          type: "UI_OPEN_SIDEBAR",
        });
        if (opened.error) {
          setPreferences(previous);
          setError(opened.error);
          return;
        }
      }

      if (next.surface === "widget" && !view) {
        await command("START");
      }
      const r = await chrome.runtime.sendMessage({
        type: "UI_SAVE",
        preferences: next,
      });
      if (r.error) {
        setPreferences(previous);
        setError(r.error);
        return;
      }
      setPreferences(next);
      if (next.surface === "widget" && !widget) {
        let ready = false;
        for (let attempt = 0; attempt < 30; attempt++) {
          const state = await chrome.runtime.sendMessage({
            type: "UI_WIDGET_STATUS",
          });
          if (state.ready) {
            ready = true;
            break;
          }
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        if (!ready) {
          const restored = { ...next, surface: "sidebar" as const };
          await chrome.runtime.sendMessage({
            type: "UI_SAVE",
            preferences: restored,
          });
          setPreferences(restored);
          setError(
            "The widget could not load on this website. Your task is ready in the sidebar.",
          );
          return;
        }

        const tab = await chrome.tabs.get(context!.tabId!);
        const close = (
          chrome.sidePanel as typeof chrome.sidePanel & {
            close?: (options: { windowId: number }) => Promise<void>;
          }
        ).close;
        if (close) await close({ windowId: tab.windowId }).catch(() => {});
        else
          setError(
            "The widget is ready. Close Chrome's sidebar to make more room.",
          );
      }
    } catch {
      setPreferences(previous);
      setError("Could not change the view. Your destination is retained.");
    } finally {
      preferencesPending.current = false;
    }
  };
  return {
    preferences,
    messages,
    hydrated,
    view,
    setView,
    context,
    setSelectedId,
    error,
    notice,
    setError,
    busy,
    setBusy,
    visionBackend,
    setVisionBackend,
    debug,
    setDebug,
    controlFilter,
    setControlFilter,
    goal,
    setGoal,
    suggestions,
    backend,
    setBackend,
    strategy,
    setStrategy,
    journeys,
    savedTasks,
    setSavedTasks,
    aiAvailability,
    aiEnabled,
    setAiEnabled,
    aiProgress,
    planning,
    command,
    active,
    paused,
    locked,
    route,
    displayedView,
    otherTab,
    controlsMode,
    statusLabel,
    memoryStats,
    submitGoal,
    enableAI,
    guideControl,
    downloadReport,
    presentation,
    submit,
    changePreferences,
    explainCurrentStep,
    newDestination,
    resetCurrentSession,
  };
}
