import type { useGuidanceController } from "../../app/useGuidanceController";
export function JourneyDetails({
  controller,
}: {
  controller: ReturnType<typeof useGuidanceController>;
}) {
  const {
    view,
    setView,
    setError,
    busy,
    setGoal,
    setStrategy,
    journeys,
    savedTasks,
    setSavedTasks,
    command,
    active,
    route,
    displayedView,
    otherTab,
    controlsMode,
    submitGoal,
  } = controller;
  return (
    <>
      {route && !controlsMode && (
        <details className="route-card">
          <summary>Route details</summary>
          <h2>{route.title}</h2>
          <p className="evidence">
            {displayedView?.verifiedSteps || 0} verified transitions
          </p>
          <p className="notice">{route.safetyNote}</p>
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
      {journeys.length > 0 && (
        <details>
          <summary>Resume previous task</summary>{" "}
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
        </details>
      )}
    </>
  );
}
