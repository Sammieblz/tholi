import { api } from "../../../platform/api";
import { requestBackendAccess } from "../../../platform/site-access";
import type { RouteStrategy } from "../../../../../../packages/page-model";
import { LiveInspector } from "./LiveInspector";
import { unresolvedTitle } from "../../app/presentationLabels";
import { ConfirmAction } from "../../components/ConfirmAction";
import { Disclosure } from "../../components/Disclosure";
import type { useGuidanceController } from "../../app/useGuidanceController";
export function AdvancedTools({
  controller,
  widget,
}: {
  controller: ReturnType<typeof useGuidanceController>;
  widget: boolean;
}) {
  const {
    view,
    context,
    setSelectedId,
    setError,
    busy,
    setBusy,
    visionBackend,
    setVisionBackend,
    debug,
    setDebug,
    controlFilter,
    setControlFilter,
    setGoal,
    suggestions,
    backend,
    setBackend,
    strategy,
    setStrategy,
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
    otherTab,
    controlsMode,
    statusLabel,
    memoryStats,
    enableAI,
    guideControl,
    downloadReport,
    resetCurrentSession,
  } = controller;
  return !widget ? (
    <div className="tholi-advanced-tools">
      <p className="small tholi-tool-context">
        {statusLabel} · {api.runtime.getManifest().version}
      </p>
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
      {context && context.routes.length > 1 && (
        <label className="task-choice">
          Choose a task
          <select
            aria-label="Choose a task"
            value={route?.id || ""}
            disabled={locked}
            onChange={(e) => setSelectedId(e.target.value)}
          >
            {context.routes.map((r) => (
              <option key={r.id} value={r.id}>
                {r.title}
              </option>
            ))}
          </select>
        </label>
      )}
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
                  void command("SET_VISION", {
                    backend: e.target.checked,
                  });
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
                    const granted = await requestBackendAccess(url.origin);
                    if (!granted)
                      throw new Error("API access was not granted.");
                  }
                  const r = await api.runtime.sendMessage({
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
              : "Experimental LLM support runs locally where the browser provides it. Enabling it may download the browser's model. MiniLM works offline without this option."}
          </p>
        </details>
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
                {view.serviceNavigation?.state === "guiding" &&
                view.serviceNavigation.requestId === view.request?.id ? (
                  view.serviceNavigation.profile === "operator-evaluation" ? (
                    "Operator evaluation proposal · Verify on the website"
                  ) : (
                    "Development service proposal · Verify on the website"
                  )
                ) : (
                  <>
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
                  </>
                )}
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
                                : "Review required · Tholi stops before this action"}
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
            browse. You control the website.
          </p>
        </details>
      )}
      <details>
        <summary>Local route tools</summary>
        {view?.journey && (
          <p className="small">
            {view.journey.reroutes} route recalculations ·{" "}
            {view.journey.progress.length} verified steps
          </p>
        )}
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
      <Disclosure
        title="Your data"
        description="Session and local knowledge controls"
      >
        <p className="small">
          Resetting this session clears its unfinished tasks, draft and
          conversation. Learned website knowledge and saved routes have separate
          controls.
        </p>
        <div className="tholi-danger-zone">
          <ConfirmAction
            title="Reset current session"
            icon="reset"
            disabled={busy}
            description="Clear current and unfinished journeys, the draft and conversation from this browser session. Website knowledge and saved routes stay available."
            action={resetCurrentSession}
          />
          <ConfirmAction
            title="Forget this website"
            disabled={busy || otherTab}
            description="Delete this website’s learned structure and reusable routes. Active guidance on it will stop."
            action={() => command("FORGET_SITE")}
          />
          <ConfirmAction
            title="Clear all site memory"
            disabled={busy}
            description="Delete all learned website knowledge and reusable routes from this browser and the connected mirror. Active guidance will stop."
            action={() => command("CLEAR_MEMORY")}
          />
        </div>
      </Disclosure>
    </div>
  ) : undefined;
}
