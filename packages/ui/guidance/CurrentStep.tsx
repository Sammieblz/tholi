import { Pause, Play, Square, Plus } from "iconoir-react";
import type { GuidanceProps } from "./types";
import { Wayfinder } from "../WayfinderMark";
import { markerForPhase } from "../presentation";

export function CurrentStep(props: GuidanceProps) {
  const p = props.presentation;
  return (
    <section
      className={"tholi-current" + (p.warning ? " tholi-warning" : "")}
      data-phase={p.phase}
      aria-label="Current guidance"
    >
      <div className="tholi-step-content">
        {props.widget && (
          <Wayfinder
            className="tholi-message-marker"
            state={p.marker || markerForPhase(p.phase)}
            animate={!props.draft.trim() || p.phase !== "idle"}
          />
        )}
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
      </div>
    </section>
  );
}

/** Actions follow the actual journey phase, never a stale running prop. */
export function SessionActions(props: GuidanceProps) {
  if (props.presentation.phase === "arrived")
    return (
      <div className="tholi-session-actions tholi-arrived-actions">
        <button
          onClick={() => {
            if (props.onNewDestination) props.onNewDestination();
            else {
              props.onDraft("");
              document.getElementById("tholi-destination-input")?.focus();
            }
          }}
        >
          <Plus width={17} aria-hidden="true" />
          New destination
        </button>
      </div>
    );
  if (!(props.active || props.paused)) return null;
  return (
    <div className="tholi-session-actions">
      <button
        disabled={props.paused && (props.pending || props.disabled)}
        aria-label={props.paused ? "Resume navigation" : "Pause navigation"}
        onClick={() => props.onCommand(props.paused ? "RESUME" : "PAUSE")}
      >
        {props.paused ? (
          <Play width={16} aria-hidden="true" />
        ) : (
          <Pause width={16} aria-hidden="true" />
        )}
        <span>{props.paused ? "Resume" : "Pause"}</span>
      </button>
      <button onClick={() => props.onCommand("STOP")}>
        <Square width={15} aria-hidden="true" />
        Stop
      </button>
    </div>
  );
}
