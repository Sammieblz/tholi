import { useEffect, useState } from "react";
import { Check, Play, Pause, Square } from "iconoir-react";
import type { GuidanceProps } from "./types";
export function CurrentStep(props: GuidanceProps) {
  const p = props.presentation;
  const [activity, setActivity] = useState(false);
  useEffect(() => {
    setActivity(false);
    if (!p.busy) return;
    const id = setTimeout(() => setActivity(true), 200);
    return () => clearTimeout(id);
  }, [p.busy, p.phase]);
  return (
    <section
      className={"tholi-current " + (p.warning ? "tholi-warning" : "")}
      data-phase={p.phase}
      aria-label="Current guidance"
    >
      <div className="tholi-step-rail" aria-hidden="true">
        <span />
        <span />
      </div>
      <div className="tholi-step-content">
        {p.destination && (
          <div className="tholi-destination">
            <span className="tholi-dot" />
            <span>{p.destination}</span>
          </div>
        )}
        <div className="tholi-phase">
          {activity && <span className="tholi-spinner" aria-hidden="true" />}
          {p.phase === "arrived" && (
            <Check
              className="tholi-arrival"
              key={p.stepId}
              width={24}
              aria-hidden="true"
            />
          )}
          {p.title}
        </div>
        <p
          key={p.stepId}
          className="tholi-instruction"
          role="status"
          aria-label="Navigation status"
          aria-live="polite"
          aria-atomic="true"
        >
          <span className="sr-only">{p.title}. </span>
          {p.instruction}
          {props.verifiedSteps !== undefined && (
            <span className="sr-only">
              {" "}
              {props.verifiedSteps} verified control interactions.
            </span>
          )}
        </p>
        {props.error && (
          <p className="tholi-error error" role="alert">
            {props.error}
          </p>
        )}
        {props.primary}
      </div>
      {(props.active || props.paused) && (
        <div className="tholi-session-actions">
          <button
            disabled={props.pending || props.disabled}
            aria-label={props.paused ? "Resume navigation" : "Pause navigation"}
            onClick={() => props.onCommand(props.paused ? "RESUME" : "PAUSE")}
          >
            {props.paused ? <Play width={17} /> : <Pause width={17} />}
            <span className="long-label">
              {props.paused ? "Resume navigation" : "Pause navigation"}
            </span>
            <span className="short-label">
              {props.paused ? "Resume" : "Pause"}
            </span>
          </button>
          <button onClick={() => props.onCommand("STOP")}>
            <Square width={16} />
            Stop
          </button>
        </div>
      )}
    </section>
  );
}
