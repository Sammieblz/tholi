import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { RoutePreview } from "../../../packages/route-registry";
import type { SessionView } from "../../../packages/shared-types";
import "./sidepanel.css";
function App() {
  const [view, setView] = useState<SessionView>();
  const [context, setContext] = useState<{
    tabId?: number;
    routes: RoutePreview[];
    reason?: string;
    sessionRoute?: RoutePreview;
    session?: { tabId: number; view?: SessionView };
  }>();
  const [selectedId, setSelectedId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    const refresh = () => {
      chrome.runtime
        .sendMessage({ type: "GET_CONTEXT" })
        .then((r) => {
          if (r?.routes) {
            setContext(r);
            setView(r.session?.view);
          }
        })
        .catch(() => {});
    };
    refresh();
    const interval = setInterval(refresh, 500);
    return () => clearInterval(interval);
  }, []);
  const command = async (type: string) => {
    setBusy(true);
    setError("");
    try {
      const r = await chrome.runtime.sendMessage(
        type === "START"
          ? { type, routeId: route?.id, routeVersion: route?.version }
          : { type },
      );
      if (r?.error) setError(r.error);
      if (r?.view) setView(r.view);
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
  const route = active || paused ? context?.sessionRoute : preview;
  const displayedView =
    view &&
    (!route ||
      (route.id === view.routeId && route.version === view.routeVersion))
      ? view
      : undefined;
  const milestones = route?.milestoneStates || {};
  const otherTab =
    (active || paused) && context?.tabId !== context?.session?.tabId;
  const downloadReport = (category: string) => {
    const report = {
      category,
      routeId: view?.routeId || route?.id,
      routeVersion: view?.routeVersion || route?.version,
      stateId: view?.stateId,
      status: view?.status,
      verifiedSteps: view?.verifiedSteps,
      reportedAt: new Date().toISOString(),
    };
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(report, null, 2)], { type: "application/json" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "navigator-route-report.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
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
      {context?.routes.length ? (
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
      ) : (
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
      {route && (
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
            Live-site coverage has not been verified.
          </div>
        </section>
      )}
      {route && (
        <section className="notice">
          <span>◇</span>
          <p>{route.safetyNote}</p>
        </section>
      )}
      <section
        className={
          "current " + (displayedView?.status === "boundary" ? "boundary" : "")
        }
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="eyebrow">
          {displayedView
            ? displayedView.status.replace("-", " ").toUpperCase()
            : "READY WHEN YOU ARE"}
        </div>
        <p>
          {displayedView?.instruction ||
            (route
              ? "Choose this task and Start when you are ready."
              : "Open a supported website to choose a task.")}
        </p>
        {displayedView && (
          <div className="evidence">
            <span>{displayedView.verifiedSteps} verified transitions</span>
            <span>
              {Math.round(displayedView.confidence * 100)}% state evidence
            </span>
          </div>
        )}
      </section>
      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      <div className="actions">
        {!active && !paused && (
          <button
            className="primary"
            disabled={
              busy || !route || !context?.routes.some((r) => r.id === route.id)
            }
            onClick={() => command("START")}
          >
            {busy ? "Starting…" : "Start navigation"} <span>↗</span>
          </button>
        )}
        {active && (
          <button
            className="primary"
            disabled={busy}
            onClick={() => command("PAUSE")}
          >
            Pause navigation
          </button>
        )}
        {paused && (
          <button
            className="primary"
            disabled={busy || otherTab}
            onClick={() => command("RESUME")}
          >
            Resume navigation
          </button>
        )}
        {(active || paused) && (
          <button
            className="stop"
            disabled={busy}
            onClick={() => command("STOP")}
          >
            Stop
          </button>
        )}
      </div>
      <details>
        <summary>Local route tools</summary>
        <label className="debug-toggle">
          <input
            type="checkbox"
            checked={debug}
            onChange={(e) => setDebug(e.target.checked)}
          />
          Show session evidence
        </label>
        {debug && (
          <pre>
            {JSON.stringify(
              view
                ? {
                    stateId: view.stateId,
                    confidence: view.confidence,
                    history: view.history,
                    routeVersion: view.routeVersion,
                  }
                : { status: "No active session" },
              null,
              2,
            )}
          </pre>
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
        <span>PROTOTYPE 0.2</span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
