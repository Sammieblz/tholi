import React, { useEffect, useState } from "react";
import type { WorkflowContext } from "../../../packages/navigation-core/workflow-contracts";
import { workflowGuides } from "../../../packages/navigation-core/guides";

export function WorkflowPanel({
  workflow,
  disabled,
  onMessage,
}: {
  workflow: WorkflowContext;
  disabled: boolean;
  onMessage: (message: Record<string, unknown>) => Promise<void>;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  useEffect(
    () =>
      setValues(
        Object.fromEntries(workflow.entities.map((e) => [e.type, e.value])),
      ),
    [workflow.id, JSON.stringify(workflow.entities)],
  );
  const guide = workflowGuides.find((g) => g.id === workflow.guideId);
  if (!guide) return null;
  const milestone = guide.milestones[workflow.activeMilestone];
  const slots = [
    ...new Set(
      guide.milestones
        .map((m) => m.entity)
        .filter((v): v is NonNullable<typeof v> => !!v),
    ),
  ];
  const labels: Record<string, string> = {
    repository: "Repository name",
    project: "Project name",
    issue: "Work item title",
    branch: "Desired default branch",
    plan: "Desired plan",
    language: "Captions language",
    speed: "Playback speed",
  };
  return (
    <section className="goal-plan" aria-label="Workflow navigation">
      <h2>{workflow.objective}</h2>
      <p role="status">
        {workflow.status === "completed"
          ? "Outcome verified"
          : milestone?.purpose || "Checking the outcome"}
      </p>
      <p>
        {workflow.verified.length} verified milestones · {workflow.status}
      </p>
      {slots.length > 0 && (
        <details>
          <summary>Task details</summary>
          <p className="small">
            These details stay in this browser session. Saved routes ask for
            them again.
          </p>
          {slots.map((type) => (
            <form
              key={type}
              onSubmit={(e) => {
                e.preventDefault();
                void onMessage({
                  type: "WORKFLOW_ENTITY",
                  entity: type,
                  value: values[type],
                });
              }}
            >
              <label>
                {labels[type] || type}
                <input
                  aria-label={labels[type] || type}
                  value={values[type] || ""}
                  maxLength={1000}
                  onChange={(e) =>
                    setValues({ ...values, [type]: e.target.value })
                  }
                />
              </label>
              <button disabled={disabled || !values[type]?.trim()}>
                Use this value
              </button>
            </form>
          ))}
        </details>
      )}
      {workflow.status === "review" && (
        <>
          <p>
            Review this action on the website and make the click yourself.
            Navigator checks the result afterward.
          </p>
          <button
            disabled={disabled}
            onClick={() =>
              void onMessage({ type: "WORKFLOW_ACTION", action: "CONTINUE" })
            }
          >
            I performed the action — check the result
          </button>
        </>
      )}
      {milestone?.kind === "input" && workflow.status !== "completed" && (
        <button
          disabled={disabled}
          onClick={() =>
            void onMessage({ type: "WORKFLOW_ACTION", action: "CONTINUE" })
          }
        >
          Continue after entering details
        </button>
      )}
      {workflow.waitExpired && (
        <>
          <p>The result is still unverified.</p>
          <button
            disabled={disabled}
            onClick={() =>
              void onMessage({ type: "WORKFLOW_ACTION", action: "WAIT" })
            }
          >
            Keep waiting
          </button>
          <button
            disabled={disabled}
            onClick={() =>
              void onMessage({ type: "WORKFLOW_ACTION", action: "RETRY" })
            }
          >
            Replan this step
          </button>
        </>
      )}
      {workflow.status === "failed" && (
        <button
          disabled={disabled}
          onClick={() =>
            void onMessage({ type: "WORKFLOW_ACTION", action: "RETRY" })
          }
        >
          Review the error and retry
        </button>
      )}
      <details>
        <summary>Upcoming milestones</summary>
        <ol>
          {guide.milestones
            .slice(workflow.activeMilestone + 1)
            .filter(
              (m) =>
                !m.branch ||
                m.branch ===
                  workflow.entities.find((e) => e.type === "method")?.value,
            )
            .map((m) => (
              <li key={m.id}>{m.purpose} · checked when reached</li>
            ))}
        </ol>
      </details>
    </section>
  );
}
