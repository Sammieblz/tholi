import { useId, useState } from "react";
import {
  workflowCaptureSchema,
  type CapturedMilestone,
  type WorkflowCapture,
} from "../navigation-core/workflow-capture";

/** Presentation only. The extension supplies current evidence and owns file delivery. */
export function WorkflowCapture({
  origin,
  platform,
  current,
  onExport,
}: {
  origin: string;
  platform: "github" | "jira";
  current?: CapturedMilestone;
  onExport: (value: WorkflowCapture) => void;
}) {
  const [steps, setSteps] = useState<CapturedMilestone[]>([]),
    [purpose, setPurpose] = useState("");
  const [error, setError] = useState("");
  const id = useId();
  return (
    <details>
      <summary>Capture a workflow draft</summary>
      <p>
        Capture the current instruction deliberately. Review every label before
        exporting. Nothing is uploaded, and captured steps are not verified task
        outcomes.
      </p>
      <label htmlFor={id}>Workflow name</label>
      <input
        id={id}
        value={purpose}
        maxLength={160}
        onChange={(e) => setPurpose(e.target.value)}
      />
      <p>Application: {origin}</p>
      <button
        type="button"
        disabled={!current || steps.length >= 64}
        onClick={() => {
          if (current) setSteps((previous) => [...previous, current]);
        }}
      >
        Add current instruction
      </button>
      {!current && (
        <p>
          No fresh bound instruction is available. Start guidance and review its
          current target.
        </p>
      )}
      <ol>
        {steps.map((step, index) => (
          <li key={index}>
            {step.label} ({step.kind})
            {step.context.length > 0 && (
              <small>Region: {step.context.join(" / ")}</small>
            )}
          </li>
        ))}
      </ol>
      <div className="tholi-actions">
        <button
          type="button"
          disabled={!steps.length}
          onClick={() => setSteps((previous) => previous.slice(0, -1))}
        >
          Remove last step
        </button>
        <button
          type="button"
          disabled={!steps.length}
          onClick={() => {
            const result = workflowCaptureSchema.safeParse({
              kind: "organization-workflow-capture",
              schemaVersion: 1,
              origin,
              purpose,
              platform,
              steps,
              evidence: "author-draft",
            });
            if (!result.success) {
              setError(
                "Give the draft a name and remove private values before export.",
              );
              return;
            }
            setError("");
            onExport(result.data);
          }}
        >
          Export reviewed draft
        </button>
      </div>
      {error && <p role="alert">{error}</p>}
    </details>
  );
}
