import { NavArrowRight } from "iconoir-react";
import type { GuidanceProps } from "./types";
export function DestinationComposer(props: GuidanceProps) {
  const prefs = props.preferences;
  return (
    <section className="tholi-composer" aria-label="Your destination">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit();
        }}
      >
        <label htmlFor="tholi-destination-input">
          {props.active
            ? prefs.mode === "conversation"
              ? "Reply or choose a new destination"
              : "Change your destination"
            : "What would you like to do?"}
        </label>
        <textarea
          id="tholi-destination-input"
          aria-label="Navigation goal"
          rows={2}
          maxLength={1000}
          value={props.draft}
          onChange={(e) => props.onDraft(e.target.value)}
          disabled={props.pending || props.disabled}
          placeholder="Show me my account settings"
        />
        <button
          className="primary"
          disabled={props.pending || props.disabled || !props.draft.trim()}
          type="submit"
        >
          {props.pending
            ? "Finding your next step"
            : prefs.mode === "conversation"
              ? "Send"
              : "Guide me"}
          <NavArrowRight width={18} />
        </button>
      </form>
      <p className="tholi-reassurance">
        You make the clicks. Tholi checks your progress.
      </p>
    </section>
  );
}
