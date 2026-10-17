import { ArrowRight, Check, FastArrowRight } from "iconoir-react";
import type { useGuidanceController } from "../../app/useGuidanceController";
import { Disclosure } from "../../components/Disclosure";
import { ConfirmAction } from "../../components/ConfirmAction";

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
  const arrived = controller.presentation.phase === "arrived";
  const progress = view?.journey?.progress || [];
  const predictions = arrived ? [] : view?.goalPlan?.route?.predictions || [];
  const estimate = view?.goalPlan?.route;
  return (
    <div className="tholi-journey-details">
      {route && !controlsMode && (
        <Disclosure
          title="Route details"
          description={arrived ? "Destination verified" : "Your guidance path"}
        >
          <p className="detail-destination">{route.title}</p>
          <p className="small">
            {displayedView?.verifiedSteps || 0} verified transitions
          </p>
          <p className="small">{route.safetyNote}</p>
        </Disclosure>
      )}
      {controlsMode && view?.journey && (
        <Disclosure
          title="Route details"
          description={arrived ? "Destination verified" : "Live discovery"}
        >
          <section aria-label="Task journey">
            <p className="detail-destination">{view.journey.goal}</p>
            {arrived ? (
              <p className="detail-verified">
                <Check width={17} aria-hidden="true" />
                Requested outcome verified
              </p>
            ) : (
              estimate && (
                <p className="small" aria-label="Route estimate">
                  {estimate.available !== false && estimate.clicks > 0 ? (
                    <>
                      {estimate.clicks}{" "}
                      {estimate.complete ? "remaining" : "currently estimated"}{" "}
                      clicks · about {estimate.minSeconds}–{estimate.maxSeconds}{" "}
                      seconds.{" "}
                      {!estimate.complete && "More screens may add steps."}
                    </>
                  ) : (
                    "An estimate is available once a usable next step is found."
                  )}
                </p>
              )
            )}
            <h3>Verified path</h3>
            {progress.length ? (
              <ol className="tholi-path">
                {progress.map((step, i) => (
                  <li key={i}>
                    <Check width={15} aria-hidden="true" />
                    <span>{step.label}</span>
                  </li>
                ))}
              </ol>
            ) : (
              <p className="small">Your verified steps will appear here.</p>
            )}
            {!!predictions.length && (
              <>
                <h3>Upcoming steps</h3>
                <ol className="tholi-path upcoming">
                  {predictions.map((step, i) => (
                    <li key={i}>
                      <ArrowRight width={15} aria-hidden="true" />
                      <span>
                        {step.label}
                        <small>
                          {step.evidence === "observed"
                            ? "Observed before, checked again on arrival"
                            : "Predicted, awaiting live evidence"}
                        </small>
                      </span>
                    </li>
                  ))}
                </ol>
              </>
            )}
            {view.goalPlan?.status === "unresolved" && (
              <p className="small" role="status">
                {view.goalPlan.reason}
              </p>
            )}
          </section>
        </Disclosure>
      )}
      {view?.request && view.request.status !== "canceled" && (
        <Disclosure
          title="Your tasks"
          label="Task queue"
          description={`${view.request.tasks.length} ordered ${view.request.tasks.length === 1 ? "destination" : "destinations"}`}
        >
          <ol className="tholi-task-list">
            {view.request.tasks.map((task) => (
              <li key={task.id}>
                <span>{task.original}</span>
                <small>{task.status.replaceAll("-", " ")}</small>
              </li>
            ))}
          </ol>
          {view.request.status !== "completed" && (
            <button
              className="tholi-quiet-action"
              disabled={otherTab || view.status !== "running"}
              onClick={async () => {
                const result = await chrome.runtime.sendMessage({
                  type: "SKIP_TASK",
                });
                if (result.view) setView(result.view);
                else if (result.error) setError(result.error);
              }}
            >
              <FastArrowRight width={17} aria-hidden="true" />
              Skip this task
            </button>
          )}
          <p className="small">
            Each requested result is checked before the next task starts.
            Skipping does not mark it successful.
          </p>
        </Disclosure>
      )}
      {controlsMode && !!savedTasks.length && (
        <Disclosure
          title="Saved routes"
          label="Saved routes"
          description="Rechecked against the current website"
        >
          <ul className="tholi-saved-list">
            {savedTasks.map((task) => (
              <li key={task.id}>
                <div>
                  <button
                    className="tholi-saved-action"
                    disabled={
                      !active || busy || otherTab || view?.status === "waiting"
                    }
                    onClick={() => {
                      setGoal(task.goal);
                      setStrategy(task.strategy);
                      void submitGoal(task);
                    }}
                  >
                    <span>
                      {task.goal}
                      <small>
                        {task.completed ? "Reached before" : "Learning route"}
                      </small>
                    </span>
                    <ArrowRight width={17} aria-hidden="true" />
                  </button>
                  <ConfirmAction
                    title="Forget route"
                    label={`Forget route: ${task.goal}`}
                    compact
                    disabled={busy}
                    description="Remove this reusable route from local knowledge. Your current destination stays with you."
                    action={async () => {
                      const result = await chrome.runtime.sendMessage({
                        type: "DELETE_TASK",
                        id: task.id,
                      });
                      if (result.error) setError(result.error);
                      else setSavedTasks(result.tasks || []);
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {!!journeys.length && (
        <Disclosure
          title="Resume previous task"
          description="Unfinished destinations from this session"
        >
          <section aria-label="Resume previous task">
            <ul className="tholi-saved-list">
              {journeys.map((journey) => (
                <li key={journey.id}>
                  <div>
                    <button
                      className="tholi-saved-action"
                      disabled={busy}
                      onClick={() =>
                        command("RESUME_JOURNEY", { id: journey.id })
                      }
                    >
                      <span>{journey.goal}</span>
                      <ArrowRight width={17} aria-hidden="true" />
                    </button>
                    <ConfirmAction
                      title="Remove task"
                      label={`Remove task: ${journey.goal}`}
                      compact
                      disabled={busy}
                      description="Remove this unfinished task from this browser session. Saved routes and website knowledge are kept."
                      action={() =>
                        command("DELETE_JOURNEY", { id: journey.id })
                      }
                    />
                  </div>
                </li>
              ))}
            </ul>
          </section>
        </Disclosure>
      )}
    </div>
  );
}
