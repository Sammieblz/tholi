import { JourneyDetails } from "../features/journey/JourneyDetails";
import { AdvancedTools } from "../features/advanced/AdvancedTools";
import { WorkflowPanel } from "../features/journey/WorkflowPanel";
import {
  currentAttentionWorkflow,
  workflowRequiresAttention,
} from "../features/journey/workflow-presentation";
import { GuidanceApp } from "../../../../../packages/ui/guidance";
import "../styles/advanced.css";
import { useGuidanceController } from "./useGuidanceController";
import { presentRouteProgress } from "../../../../../packages/ui/route-progress";
import { currentTaskNotices } from "../features/journey/current-task-notices";

export function GuidanceController({ widget = false }: { widget?: boolean }) {
  const controller = useGuidanceController(widget);
  const {
    preferences,
    messages,
    hydrated,
    setView,
    context,
    error,
    notice,
    setError,
    busy,
    setBusy,
    goal,
    setGoal,
    command,
    active,
    paused,
    route,
    displayedView,
    otherTab,
    controlsMode,
    presentation,
    submit,
    changePreferences,
    explainCurrentStep,
    newDestination,
    resetCurrentSession,
  } = controller;
  const attentionWorkflow = currentAttentionWorkflow(displayedView, busy, goal);
  const noticeView = currentTaskNotices(displayedView, presentation);
  return (
    <GuidanceApp
      presentation={presentation}
      verifiedSteps={displayedView?.verifiedSteps}
      progress={presentRouteProgress(displayedView, presentation)}
      preferences={preferences}
      onPreferences={(next) => void changePreferences(next)}
      draft={goal}
      onDraft={setGoal}
      onSubmit={() => void submit()}
      messages={messages}
      logo={chrome.runtime.getURL("media/tholi_brand_logo.png")}
      active={active}
      paused={paused}
      pending={busy || !hydrated || !context}
      disabled={otherTab}
      error={error}
      attentionRequired={
        !!(
          error ||
          otherTab ||
          noticeView?.continuationOrigin ||
          noticeView?.frameAccess?.length ||
          noticeView?.clarification ||
          noticeView?.goalPlan?.action?.kind === "visual" ||
          (attentionWorkflow && workflowRequiresAttention(attentionWorkflow))
        )
      }
      notice={notice}
      widget={widget}
      onMinimize={() =>
        void chrome.runtime.sendMessage({ type: "UI_MINIMIZE" }).then((r) => {
          if (r.error) setError(r.error);
        })
      }
      onNewDestination={newDestination}
      onResetSession={() => void resetCurrentSession()}
      onExpand={() =>
        void chrome.runtime.sendMessage({ type: "UI_WIDGET_EXPAND" })
      }
      onMoveAside={() =>
        void chrome.runtime.sendMessage({ type: "UI_WIDGET_MOVE" })
      }
      onWidgetLayout={(action) =>
        void chrome.runtime
          .sendMessage({ type: "UI_WIDGET_LAYOUT", action })
          .then((r) => {
            if (r.error) setError(r.error);
          })
      }
      onDock={() =>
        void chrome.runtime.sendMessage({ type: "UI_DOCK" }).then((r) => {
          if (r.error) setError(r.error);
        })
      }
      onCommand={(type) =>
        type === "WHY" ? void explainCurrentStep() : void command(type)
      }
      primary={
        <>
          {context && !context.routes.length && <h2>Open a website</h2>}
          {otherTab && (
            <p className="tab-warning">
              Your task is open in another tab. Return there to continue.
            </p>
          )}
          {noticeView?.continuationOrigin && (
            <button
              disabled={busy || !context?.canContinueTask}
              onClick={() => command("CONTINUE_TASK")}
            >
              Continue task here
            </button>
          )}
          {!route && (
            <p className="small">
              {context?.reason || "Open an HTTP or HTTPS website to begin."}
            </p>
          )}
          {!controlsMode && route && !active && !paused && (
            <button
              className="primary"
              disabled={busy}
              onClick={() => command("START")}
            >
              Start navigation
            </button>
          )}
        </>
      }
      details={<JourneyDetails controller={controller} />}
      advanced={<AdvancedTools controller={controller} widget={widget} />}
      attention={
        <>
          {!otherTab &&
            !noticeView?.continuationOrigin &&
            !noticeView?.frameAccess?.length &&
            noticeView?.clarification && (
              <section className="goal-plan" aria-label="Clarification">
                <h2>{noticeView.clarification.question}</h2>
                {noticeView.clarification.choices.map((choice) => (
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
                        if (r.noticeView) setView(r.noticeView);
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
          {!otherTab &&
            !noticeView?.continuationOrigin &&
            !!noticeView?.frameAccess?.length && (
              <section
                className="goal-plan"
                aria-label="Embedded application access"
              >
                <h2>Embedded application access</h2>
                <p>
                  Allow access to an embedded website to guide its controls.
                </p>
                {noticeView.frameAccess.map((origin) => (
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
          {!otherTab &&
            !noticeView?.continuationOrigin &&
            !noticeView?.frameAccess?.length &&
            !noticeView?.clarification &&
            attentionWorkflow && (
              <WorkflowPanel
                key={`${attentionWorkflow.id}:${attentionWorkflow.activeMilestone}`}
                compact
                workflow={attentionWorkflow}
                disabled={busy || otherTab || noticeView?.status !== "running"}
                onMessage={async (message) => {
                  const r = await chrome.runtime.sendMessage(message);
                  if (r.noticeView) setView(r.noticeView);
                  if (r.error) setError(r.error);
                }}
              />
            )}
          {!otherTab &&
            !noticeView?.continuationOrigin &&
            !noticeView?.frameAccess?.length &&
            !noticeView?.clarification &&
            noticeView?.journey?.workflow?.status !== "review" &&
            noticeView?.goalPlan?.action?.kind === "visual" && (
              <section aria-label="Visual review">
                <h2>Visual suggestion / review required</h2>
                <p>{noticeView.goalPlan.reason}</p>
                <p>
                  Make the interaction yourself. Tholi will check fresh website
                  evidence; the highlighted text does not establish its effect.
                </p>
                <p className="small">
                  I’ll observe your next interaction and check the page
                  automatically.
                </p>
              </section>
            )}
          {noticeView?.goalPlan?.action &&
            ["history-back", "tab-switch"].includes(
              noticeView.goalPlan.action.kind,
            ) && (
              <section aria-label="Return navigation">
                <h2>Your destination is retained</h2>
                <p>{noticeView.goalPlan.reason}</p>
                <p className="small">
                  Guidance resumes when the indicated page is observed.
                </p>
              </section>
            )}
        </>
      }
    />
  );
}
