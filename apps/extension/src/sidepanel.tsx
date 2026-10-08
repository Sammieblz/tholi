import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { demoRoute } from "../../../routes/demo/cancellation";
import type { SessionView } from "../../../packages/shared-types";
import "./sidepanel.css";
function App() {
  const [view, setView] = useState<SessionView>();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [debug, setDebug] = useState(false);
  useEffect(() => {
    const refresh = () => {
      chrome.runtime
        .sendMessage({ type: "GET_SESSION" })
        .then((r) => {
          setView(r?.view);
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
      const r = await chrome.runtime.sendMessage({ type });
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
  const milestones: Record<string, number> = {
    home: 0,
    profile: 0,
    account: 0,
    billing: 1,
    plan: 2,
    retention: 2,
    confirmation: 3,
    success: 3,
  };
  const downloadReport = (category: string) => {
    const report = {
      category,
      routeId: demoRoute.id,
      routeVersion: demoRoute.version,
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
      <section className="route-card">
        <div className="route-top">
          <span className="site-icon">✦</span>
          <div>
            <strong>Northstar demo</strong>
            <small>Local controlled environment</small>
          </div>
          <span className="tag">COACH</span>
        </div>
        <h2>{demoRoute.title}</h2>
        <p>Account → billing → plan → final confirmation</p>
        <ol className="milestones">
          {demoRoute.milestones.map((m, i) => (
            <li
              key={m}
              className={
                view?.stateId && milestones[view.stateId] >= i ? "reached" : ""
              }
            >
              <span>{i + 1}</span>
              {m}
            </li>
          ))}
        </ol>
        <div className="freshness">
          Route {demoRoute.version} · Development fixture
          <br />
          Live-site coverage has not been verified.
        </div>
      </section>
      <section className="notice">
        <span>◇</span>
        <p>
          Navigator stops before the final cancellation. It never clicks or
          submits for you.
        </p>
      </section>
      <section
        className={"current " + (view?.status === "boundary" ? "boundary" : "")}
        aria-live="polite"
        aria-atomic="true"
      >
        <div className="eyebrow">
          {view
            ? view.status.replace("-", " ").toUpperCase()
            : "READY WHEN YOU ARE"}
        </div>
        <p>
          {view?.instruction ||
            "Open the local demo, choose your goal, then start."}
        </p>
        {view && (
          <div className="evidence">
            <span>{view.verifiedSteps} verified transitions</span>
            <span>{Math.round(view.confidence * 100)}% state evidence</span>
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
            disabled={busy}
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
            disabled={busy}
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
        <span>PROTOTYPE 0.1</span>
      </footer>
    </main>
  );
}
createRoot(document.getElementById("root")!).render(<App />);
