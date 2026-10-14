import { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import type { RoutePreview } from "../../../packages/route-registry";
import type { SessionView } from "../../../packages/shared-types";
import {
  LIVE_ROUTE_ID,
  pageSnapshotSchema,
  type GoalPlan,
  type SavedTask,
  type RouteStrategy,
} from "../../../packages/page-model";
import { beginJourney } from "../../../packages/goal-planner/task-journey";
import { sanitizeGoal } from "../../../packages/privacy-redaction";
import { LocalModel, modelAvailability } from "./local-model";
import { memorySummary } from "../../../packages/site-memory";
import { liveReport } from "../../../packages/live-diagnostics";
import { LiveInspector } from "./live-inspector";
import { WorkflowPanel } from "./workflow-panel";
import { requestCurrentSiteAccess } from "./site-access";
import "./sidepanel.css";
function unresolvedTitle(plan: GoalPlan) {
  switch (plan.issue) {
    case "consequential":
      return "Review required";
    case "unknown-effect":
      return "Control effect unclear";
    case "ambiguous":
      return "Choose a matching control";
    case "no-match":
      return "No clear route found";
    default:
      return "More context needed";
  }
}
function App() {
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
  const [busy, setBusy] = useState(false);
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
  const goalField = useRef<HTMLInputElement>(null);
  const sessionAction = useRef<HTMLButtonElement>(null);
  const previousStatus = useRef<string | undefined>(undefined);
  useEffect(() => {
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
    const refresh = () => {
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
    const interval = setInterval(refresh, 500);
    return () => {
      current = false;
      clearInterval(interval);
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
        (type === "START" && route?.id === LIVE_ROUTE_ID) ||
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
              routeId: route?.id,
              routeVersion: route?.version,
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
  const milestones = route?.milestoneStates || {};
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
  useEffect(() => {
    const status = displayedView?.status,
      previous = previousStatus.current;
    if (otherTab || busy) return;
    previousStatus.current = status;
    if (status === previous) return;
    if (
      status === "running" &&
      !["running", "waiting"].includes(previous || "")
    )
      (controlsMode ? goalField.current : sessionAction.current)?.focus();
    else if (status === "paused") sessionAction.current?.focus();
    else if (status === "stopped")
      (controlsMode ? goalField.current : sessionAction.current)?.focus();
  }, [displayedView?.status, otherTab, controlsMode, busy]);
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
          routeVersion: route?.version,
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
      if (reply.view) setView(reply.view);
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
    a.download = "navigator-route-report.json";
    a.hidden = true;
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  };
  return (
    <main>
      <header>
        <div className="symbol">↗</div>
        <div className="wordmark">
          internet
          <br />
          <strong>navigator</strong>
        </div>
        <span className={"indicator " + (active ? "on" : "")}>
          {active ? "ON" : "OFF"}
        </span>
      </header>
      {!controlsMode && (
        <>
          <div className="eyebrow">YOUR WEBSITE, WITH DIRECTIONS</div>
          <h1>
            A clear path
            <br />
            to your next step.
          </h1>
          <p className="intro">
            You make the clicks.
            <br />
            We help you find your way.
          </p>
        </>
      )}
      {controlsMode && (
        <h1 className="controls-heading">Navigate this website</h1>
      )}
      {!!context?.routes.length && context.routes.length > 1 && (
        <label className="task-choice">
          Choose a task
          <select
            aria-label="Choose a task"
            value={route?.id || ""}
            disabled={locked}
            onChange={(e) => {
              setSelectedId(e.target.value);
              setError("");
            }}
          >
            {context.routes.map((task) => (
              <option key={task.id} value={task.id}>
                {task.title}
              </option>
            ))}
          </select>
        </label>
      )}
      {!context?.routes.length && (
        <section className="unsupported" role="status">
          <h2>No supported tasks</h2>
          <p>{context?.reason || "Checking the current website…"}</p>
        </section>
      )}
      {otherTab && (
        <p role="status" className="tab-warning">
          This task is running on another tab. Return to that tab to continue,
          or Stop before choosing a new task.
        </p>
      )}
      {route && !controlsMode && (
        <section className="route-card">
          <div className="route-top">
            <span className="site-icon">✦</span>
            <div>
              <strong>{route.siteName}</strong>
              <small>Supported task · Coach mode</small>
            </div>
            <span className="tag">COACH</span>
          </div>
          <h2>{route.title}</h2>
          <p>{route.description}</p>
          <ol className="milestones">
            {route.milestones.map((m, i) => (
              <li
                key={m}
                className={
                  displayedView?.stateId &&
                  milestones[displayedView.stateId] >= i
                    ? "reached"
                    : ""
                }
              >
                <span>{i + 1}</span>
                {m}
              </li>
            ))}
          </ol>
          <div className="freshness">
            Route {route.version} · {route.lastVerified}
            <br />
            {route.origins.some((origin) => origin.startsWith("https://"))
              ? "Controls and page structure are verified before guidance."
              : "Controlled development demo."}
          </div>
        </section>
      )}
      {route && (
        <section className="notice">
          <span>◇</span>
          <p>{route.safetyNote}</p>
        </section>
      )}
      {controlsMode && (
        <section aria-label="Your destination">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submitGoal();
            }}
          >
            <label>
              What would you like to do?
              <input
                aria-label="Navigation goal"
                ref={goalField}
                disabled={otherTab || paused}
                value={goal}
                maxLength={1000}
                onChange={(e) => setGoal(e.target.value)}
                placeholder="Help me cancel my Prime membership…"
              />
            </label>
            <details>
              <summary>Route preference</summary>
              <label>
                Route preference
                <select
                  aria-label="Route preference"
                  value={strategy}
                  disabled={busy || otherTab}
                  onChange={(e) => setStrategy(e.target.value as RouteStrategy)}
                >
                  <option value="fastest">Fastest known route</option>
                  <option value="fewest-clicks">Fewest clicks</option>
                </select>
              </label>
            </details>
            <button
              className="primary"
              disabled={busy || otherTab || paused || !goal.trim()}
              type="submit"
            >
              Guide me
            </button>
          </form>
        </section>
      )}
      <section
        className={
          "current " + (displayedView?.status === "boundary" ? "boundary" : "")
        }
      >
        <div className="eyebrow">{statusLabel.toUpperCase()}</div>
        <p
          role="status"
          aria-label="Navigation status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="sr-only">{statusLabel}. </span>
          {displayedView?.instruction ||
            (route
              ? controlsMode
                ? "Enter your destination and select Guide me."
                : "Choose this task and Start when you are ready."
              : "Open a supported website to choose a task.")}
          {displayedView && (
            <span className="sr-only">
              {" "}
              {displayedView.verifiedSteps} verified{" "}
              {controlsMode ? "control interactions" : "transitions"}.
            </span>
          )}
        </p>
        {displayedView && (
          <div className="evidence">
            <span>
              {displayedView.verifiedSteps} verified{" "}
              {controlsMode ? "control interactions" : "transitions"}
            </span>
            <span>
              {controlsMode
                ? "Live page observation"
                : "Page landmarks checked"}
            </span>
          </div>
        )}
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {!active && !paused && controlsMode && context?.siteAccessRequired && (
        <p role="status">
          Allow access to {route.siteName} to scan its controls. Navigator only
          scans when you start navigation.
        </p>
      )}
      <div className="actions">
        {view?.continuationOrigin && (
          <button
            className="primary"
            disabled={busy || !context?.canContinueTask}
            onClick={() => command("CONTINUE_TASK")}
          >
            Continue task here
          </button>
        )}
        {!active && !paused && !controlsMode && (
          <button
            className="primary"
            ref={sessionAction}
            disabled={
              busy || !route || !context?.routes.some((r) => r.id === route.id)
            }
            onClick={() => command("START")}
          >
            {busy
              ? "Starting…"
              : context?.siteAccessRequired && controlsMode
                ? "Allow website access and start"
                : "Start navigation"}{" "}
            <span aria-hidden="true">↗</span>
          </button>
        )}
        {active && (
          <button
            className="primary"
            ref={sessionAction}
            disabled={busy}
            onClick={() => command("PAUSE")}
          >
            Pause navigation
          </button>
        )}
        {paused && !view?.continuationOrigin && (
          <button
            className="primary"
            ref={sessionAction}
            disabled={busy || otherTab}
            onClick={() => command("RESUME")}
          >
            Resume navigation
          </button>
        )}
        {(active || paused) && (
          <button className="stop" onClick={() => command("STOP")}>
            Stop
          </button>
        )}
      </div>
      {controlsMode && !active && !paused && (
        <details>
          <summary>Explore page controls</summary>
          <p className="small">
            Scan this page without choosing a destination.
          </p>
          <button disabled={busy || otherTab} onClick={() => command("START")}>
            Start navigation
          </button>
        </details>
      )}
      {view?.request && view.request.status !== "canceled" && (
        <details aria-label="Task queue" className="goal-plan">
          <summary>Your tasks</summary>
          <ol>
            {view.request.tasks.map((task) => (
              <li key={task.id}>
                {task.original} · {task.status}
              </li>
            ))}
          </ol>
          {view.request.status !== "completed" && (
            <button
              disabled={otherTab || view.status !== "running"}
              onClick={async () => {
                const r = await chrome.runtime.sendMessage({
                  type: "SKIP_TASK",
                });
                if (r.view) setView(r.view);
                else if (r.error) setError(r.error);
              }}
            >
              Skip this task
            </button>
          )}
          <p className="small">
            Each requested result is checked before the next task starts.
          </p>
        </details>
      )}
      {view?.clarification && (
        <section className="goal-plan" aria-label="Clarification">
          <h2>{view.clarification.question}</h2>
          {view.clarification.choices.map((choice) => (
            <button
              key={choice.id}
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  const r = await chrome.runtime.sendMessage({
                    type: "CLARIFY",
                    choice: choice.id,
                  });
                  if (r.view) setView(r.view);
                  if (r.error) setError(r.error);
                } finally {
                  setBusy(false);
                }
              }}
            >
              {choice.label}
            </button>
          ))}
        </section>
      )}
      {!!view?.frameAccess?.length && (
        <section className="goal-plan" aria-label="Embedded application access">
          <h2>Embedded application access</h2>
          <p>Allow access to an embedded website to guide its controls.</p>
          {view.frameAccess.map((origin) => (
            <button
              key={origin}
              disabled={busy || otherTab}
              onClick={async () => {
                const granted = await chrome.permissions.request({
                  origins: [origin + "/*"],
                });
                if (!granted)
                  setError(
                    "Access was not granted. Other page controls remain available.",
                  );
              }}
            >
              Allow {origin}
            </button>
          ))}
        </section>
      )}
      {view?.journey?.workflow && (
        <details>
          <summary>Workflow details</summary>
          <WorkflowPanel
            workflow={view.journey.workflow}
            disabled={busy || otherTab || view.status !== "running"}
            onMessage={async (message) => {
              const r = await chrome.runtime.sendMessage(message);
              if (r.view) setView(r.view);
              if (r.error) setError(r.error);
            }}
          />
        </details>
      )}
      {controlsMode && view?.journey && (
        <details className="goal-plan">
          <summary>Route details · Live discovery</summary>
          <section aria-label="Task journey">
            <h2>{view.journey.goal}</h2>
            <p>
              {view.journey.progress.length} verified steps ·{" "}
              {view.journey.reroutes} route recalculations
            </p>
            {view.goalPlan?.route &&
              (view.goalPlan.route.available !== false &&
              (view.goalPlan.route.clicks > 0 ||
                view.goalPlan.status === "completed") ? (
                <p aria-label="Route estimate">
                  {view.goalPlan.route.clicks}{" "}
                  {view.goalPlan.route.complete
                    ? "remaining"
                    : "currently estimated"}{" "}
                  clicks · about {view.goalPlan.route.minSeconds}–
                  {view.goalPlan.route.maxSeconds} seconds (
                  {view.goalPlan.route.basis}).
                  {!view.goalPlan.route.complete &&
                    " Further screens may add steps."}
                </p>
              ) : (
                <p aria-label="Route estimate">
                  Route estimate unavailable until a usable next step is found.
                </p>
              ))}
            {view.goalPlan?.status === "unresolved" && (
              <p role="status">{view.goalPlan.reason}</p>
            )}
            {!!view.goalPlan?.route?.predictions.length && (
              <details>
                <summary>Upcoming steps</summary>
                <ol>
                  {view.goalPlan.route.predictions.map((p, i) => (
                    <li key={i}>
                      {p.label}{" "}
                      <small>
                        {p.evidence === "observed"
                          ? "Previously observed; rechecked on arrival"
                          : "Predicted; awaiting live evidence"}
                      </small>
                    </li>
                  ))}
                </ol>
              </details>
            )}
            <details>
              <summary>Journey so far</summary>
              <ol>
                {view.journey.progress.map((p, i) => (
                  <li key={i}>{p.label} · verified</li>
                ))}
              </ol>
            </details>
          </section>
        </details>
      )}
      {controlsMode && !!savedTasks.length && (
        <details aria-label="Saved routes">
          <summary>Saved routes</summary>
          <p className="small">
            Routes are checked against the current website before reuse.
          </p>
          {savedTasks.map((task) => (
            <div key={task.id}>
              <button
                disabled={
                  !active || busy || otherTab || view?.status === "waiting"
                }
                onClick={() => {
                  setGoal(task.goal);
                  setStrategy(task.strategy);
                  void submitGoal(task);
                }}
              >
                {task.goal} ·{" "}
                {task.completed ? "Reached before" : "Learning route"}
              </button>
              <button
                aria-label={"Forget route: " + task.goal}
                disabled={busy}
                onClick={async () => {
                  const r = await chrome.runtime.sendMessage({
                    type: "DELETE_TASK",
                    id: task.id,
                  });
                  setSavedTasks(r.tasks || []);
                }}
              >
                Forget
              </button>
            </div>
          ))}
        </details>
      )}
      {controlsMode && (
        <details>
          <summary>Local site memory and AI</summary>
          <p className="small">
            OCR uses Tesseract. PaddleOCR evaluation is available in an
            experimental build and has not passed promotion gates.
          </p>
          <p>
            {memoryStats.pages} pages · {memoryStats.templates} layouts ·{" "}
            {memoryStats.observedTransitions} observed transitions
          </p>
          <p className="small">
            Structure and verified transitions stay in this browser. Form values
            are excluded. Stored data expires after 90 days.
          </p>
          {view?.embeddingActivity && (
            <p className="small" aria-label="Embedding activity">
              MiniLM: {view.embeddingActivity.embedded} embeddings ·{" "}
              {view.embeddingActivity.cacheHits} cache hits ·{" "}
              {view.embeddingActivity.llmCalls} LLM calls
            </p>
          )}
          <details>
            <summary>Optional private backend</summary>
            <label>
              <input
                type="checkbox"
                checked={visionBackend}
                onChange={(e) => {
                  setVisionBackend(e.target.checked);
                  void command("SET_VISION", { backend: e.target.checked });
                }}
              />
              Send temporary masked images to the connected backend for OCR
            </label>
            <p className="small">
              Connect your own single-owner API to mirror this website. Browser
              memory remains the source; connection failures use local
              processing.
            </p>
            <label>
              API address
              <input
                aria-label="API address"
                value={backend.url}
                onChange={(e) =>
                  setBackend({ ...backend, url: e.target.value })
                }
              />
            </label>
            <label>
              API token
              <input
                aria-label="API token"
                type="password"
                autoComplete="off"
                value={backend.token}
                onChange={(e) =>
                  setBackend({ ...backend, token: e.target.value })
                }
              />
            </label>
            <label>
              <input
                type="checkbox"
                checked={backend.enabled}
                onChange={(e) =>
                  setBackend({ ...backend, enabled: e.target.checked })
                }
              />
              Connect this browser
            </label>
            <button
              onClick={async () => {
                try {
                  if (backend.enabled) {
                    const url = new URL(backend.url);
                    const granted = await chrome.permissions.request({
                      origins: [url.protocol + "//" + url.hostname + "/*"],
                    });
                    if (!granted)
                      throw new Error("API access was not granted.");
                  }
                  const r = await chrome.runtime.sendMessage({
                    type: "SET_BACKEND",
                    ...backend,
                  });
                  if (r.error) throw new Error(r.error);
                  setError("");
                } catch (error) {
                  setError(
                    error instanceof Error
                      ? error.message
                      : "Could not save connection.",
                  );
                }
              }}
            >
              Save connection
            </button>
          </details>
          {view?.memoryError && <p role="status">{view.memoryError}</p>}
          <button
            disabled={busy || otherTab}
            onClick={() => command("FORGET_SITE")}
          >
            Forget this website
          </button>
          <button disabled={busy} onClick={() => command("CLEAR_MEMORY")}>
            Clear all site memory
          </button>
          {aiEnabled ? (
            <label className="debug-toggle">
              <input
                type="checkbox"
                checked={aiEnabled}
                onChange={(e) => setAiEnabled(e.target.checked)}
              />
              Use on-device AI
            </label>
          ) : (
            <button
              disabled={
                aiAvailability === "unavailable" ||
                aiAvailability === "checking" ||
                aiProgress !== undefined
              }
              onClick={enableAI}
            >
              {aiProgress !== undefined
                ? "Preparing local model… " + Math.round(aiProgress * 100) + "%"
                : "Enable on-device AI"}
            </button>
          )}
          <p className="small">
            {aiAvailability === "unavailable"
              ? "On-device AI is unavailable on this device. Semantic planning works without it."
              : "Experimental LLM support runs locally in Chrome. Enabling it may download the browser's model. MiniLM works offline without this option."}
          </p>
        </details>
      )}
      {view?.goalPlan?.action?.kind === "visual" && (
        <section aria-label="Visual review">
          <h2>Visual suggestion — review required</h2>
          <p>{view.goalPlan.reason}</p>
          <p>
            Make the interaction yourself. Navigator will check fresh website
            evidence; the highlighted text does not establish its effect.
          </p>
          <p className="small">
            I’ll observe your next interaction and check the page automatically.
          </p>
        </section>
      )}
      {journeys.length > 0 && (
        <section aria-label="Resume previous task">
          <h2>Resume previous task</h2>
          {journeys.map((j) => (
            <div key={j.id}>
              <button
                disabled={busy}
                onClick={() => command("RESUME_JOURNEY", { id: j.id })}
              >
                {j.goal}
              </button>
              <button
                disabled={busy}
                onClick={() => command("DELETE_JOURNEY", { id: j.id })}
              >
                Remove
              </button>
            </div>
          ))}
        </section>
      )}
      {view?.goalPlan?.action &&
        ["history-back", "tab-switch"].includes(view.goalPlan.action.kind) && (
          <section aria-label="Return navigation">
            <h2>Your destination is retained</h2>
            <p>{view.goalPlan.reason}</p>
            <p className="small">
              Guidance resumes when the indicated page is observed.
            </p>
          </section>
        )}
      {controlsMode && active && (
        <details className="page-controls" aria-label="Live page controls">
          <summary>Advanced controls and route evidence</summary>

          {!!suggestions.length && (
            <div aria-label="Request suggestions">
              {suggestions.map((s) => (
                <button key={s.signature} onClick={() => setGoal(s.label)}>
                  {s.label}
                </button>
              ))}
            </div>
          )}
          {planning.current && (
            <button
              onClick={() => {
                planning.current?.abort();
                planning.current = undefined;
                setBusy(false);
              }}
            >
              Cancel planning
            </button>
          )}
          {view?.goalPlan && (
            <section aria-label="Goal plan" className="goal-plan">
              <h2>
                {view.goalPlan.status === "completed"
                  ? "Goal verified"
                  : view.goalPlan.status === "awaiting-choice"
                    ? "Choose your next option"
                    : view.goalPlan.status === "unresolved"
                      ? unresolvedTitle(view.goalPlan)
                      : "Your route"}
              </h2>
              <p>{view.goalPlan.reason}</p>
              <ol>
                {view.goalPlan.steps.map((step, i) => (
                  <li key={i}>
                    <strong>{step.label}</strong>
                    <small>{step.outcome}</small>
                  </li>
                ))}
              </ol>
              <p className="small">
                {view.goalPlan.source === "on-device"
                  ? "On-device AI"
                  : view.goalPlan.source === "memory"
                    ? "Verified site memory"
                    : "Live page semantics"}{" "}
                ·{" "}
                {view.goalPlan.issue === "consequential"
                  ? "Action boundary"
                  : view.goalPlan.issue === "unknown-effect"
                    ? "Effect not declared"
                    : view.goalPlan.confidence >= 0.85
                      ? "Strong match"
                      : view.goalPlan.confidence >= 0.6
                        ? "Moderate match"
                        : "Uncertain match"}
              </p>
            </section>
          )}
          {view?.page?.partial && (
            <p role="status">
              This large page was partially scanned. Navigate closer to reveal
              more controls.
            </p>
          )}
          <h2>Choose a control to highlight</h2>
          <label>
            Filter controls
            <input
              type="search"
              aria-label="Filter controls"
              value={controlFilter}
              onChange={(e) => setControlFilter(e.target.value)}
              placeholder="Search, References, Dark…"
            />
          </label>
          {!view?.controls?.length && (
            <p>
              Checking the current page. Open a menu to reveal its controls.
            </p>
          )}
          {[...new Set(view?.controls?.map((c) => c.group) || [])].map(
            (group) => {
              const controls =
                view?.controls?.filter(
                  (c) =>
                    c.group === group &&
                    c.label.toLowerCase().includes(controlFilter.toLowerCase()),
                ) || [];
              return controls.length ? (
                <details
                  className="control-group"
                  key={group}
                  open={group !== "Page links" && group !== "Page sections"}
                >
                  <summary>
                    {group} · {controls.length}
                  </summary>
                  <div>
                    {controls.map((c) => (
                      <button
                        key={c.id}
                        data-control-id={c.id}
                        className={
                          view?.selectedControlId === c.id
                            ? "control-selected"
                            : ""
                        }
                        disabled={
                          busy || otherTab || view?.status === "waiting"
                        }
                        onClick={() => guideControl(c.id)}
                      >
                        <span>
                          {c.label}
                          {c.risk === "consequential" && (
                            <small>
                              {c.riskReason === "unknown-edit-effect"
                                ? "Effect unclear · Review this control on the website"
                                : "Review required · Navigator stops before this action"}
                            </small>
                          )}
                          {c.kind === "navigation" && c.destination && (
                            <small className="control-destination">
                              {c.destination.path}
                            </small>
                          )}
                        </span>
                        <span aria-hidden="true">↗</span>
                      </button>
                    ))}
                  </div>
                </details>
              ) : null;
            },
          )}
          <p className="small">
            Open menus to reveal more controls. The list refreshes as you
            browse. You make every click.
          </p>
        </details>
      )}
      <details>
        <summary>Local route tools</summary>
        <label className="debug-toggle">
          <input
            type="checkbox"
            checked={debug}
            onChange={(e) => setDebug(e.target.checked)}
          />
          Show route debug inspector
        </label>
        {debug && (
          <section className="inspector" aria-label="Route debug inspector">
            <h2>Route debug inspector</h2>
            <p>
              {view
                ? view.routeId + " · " + view.routeVersion
                : "Start a task to collect evidence."}
            </p>
            {view?.diagnostics && (
              <>
                <h3>Detected state</h3>
                <p>
                  {view.diagnostics.localization?.stateId || "Unknown"} ·{" "}
                  {Math.round(view.confidence * 100)}%
                </p>
                <p>{view.diagnostics.localization?.reason}</p>
                <table>
                  <caption>State candidates</caption>
                  <thead>
                    <tr>
                      <th>State</th>
                      <th>Score</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.diagnostics.localization?.scores.map((s) => (
                      <tr key={s.id}>
                        <td>{s.id}</td>
                        <td>{Math.round(s.score * 100)}%</td>
                        <td>{s.reasons.join(", ") || "Matched"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3>Target candidates</h3>
                <p>
                  {view.diagnostics.target?.reason ||
                    "No target evaluated yet."}
                </p>
                <table>
                  <thead>
                    <tr>
                      <th>Control ID</th>
                      <th>Score</th>
                      <th>Evidence</th>
                    </tr>
                  </thead>
                  <tbody>
                    {view.diagnostics.target?.candidates.map((c) => (
                      <tr key={c.id}>
                        <td>{c.id}</td>
                        <td>{Math.round(c.score * 100)}%</td>
                        <td>{c.reasons.join(", ") || "Matched"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                <h3>Expected next states</h3>
                <p>{view.diagnostics.expected.join(", ") || "None"}</p>
                <h3>Transition history</h3>
                <ol>
                  {view.diagnostics.transitions.map((t, i) => (
                    <li key={i}>
                      {t.transitionId}: {t.from} → {t.expected.join(" / ")} ·
                      observed {t.observed || "pending"} · {t.outcome}
                    </li>
                  ))}
                </ol>
                <h3>Session history</h3>
                <p>{view.history.join(" → ") || "None"}</p>
                <button onClick={() => downloadReport("diagnostics")}>
                  Export diagnostics
                </button>
                <p className="small">
                  Control IDs are temporary. No page text, URLs or field values
                  are exported. Up to 50 target candidates and 30 transitions
                  are retained.
                </p>
              </>
            )}
            {view?.liveDiagnostics && (
              <LiveInspector
                view={view}
                download={() => downloadReport("diagnostics")}
              />
            )}
          </section>
        )}
        <label>
          Report a route issue
          <select
            defaultValue=""
            onChange={(e) => {
              if (e.target.value) downloadReport(e.target.value);
              e.target.value = "";
            }}
          >
            <option value="">Export local report…</option>
            <option value="target-missing">Target missing</option>
            <option value="wrong-screen">Wrong screen</option>
            <option value="instruction-unclear">Instruction unclear</option>
            <option value="route-outdated">Route outdated</option>
          </select>
        </label>
        <p className="small">
          Reports stay local. No browsing history or field values are included.
        </p>
      </details>
      <footer>
        <span>LOCAL FIRST</span>
        <span>VERSION {chrome.runtime.getManifest().version}</span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
