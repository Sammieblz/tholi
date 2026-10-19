import { useId } from "react";
import { NavArrowRight, ArrowUp } from "iconoir-react";
import type { GuidanceProps } from "./types";
export function DestinationComposer(
  props: GuidanceProps & { compact?: boolean },
) {
  const conversation = props.preferences.mode === "conversation";
  const hintId = useId();
  return (
    <section
      className={
        "tholi-composer" + (conversation ? " tholi-chat-composer" : "")
      }
      aria-label="Your destination"
    >
      <form
        onSubmit={(e) => {
          e.preventDefault();
          props.onSubmit();
        }}
      >
        <label htmlFor="tholi-destination-input">
          {props.active
            ? conversation
              ? "Reply or choose a new destination"
              : "Change your destination"
            : "What would you like to do?"}
        </label>
        <div className="tholi-input-wrap">
          <textarea
            id="tholi-destination-input"
            aria-label="Navigation goal"
            aria-describedby={hintId}
            rows={2}
            maxLength={1000}
            value={props.draft}
            onChange={(e) => props.onDraft(e.target.value)}
            disabled={props.disabled}
            placeholder={
              conversation
                ? "Ask Tholi to guide you…"
                : "Show me my account settings"
            }
            onKeyDown={(e) => {
              if (
                (conversation || props.compact) &&
                e.key === "Enter" &&
                !e.shiftKey &&
                !e.nativeEvent.isComposing &&
                e.keyCode !== 229
              ) {
                e.preventDefault();
                if (!props.pending && !props.disabled && props.draft.trim())
                  props.onSubmit();
              }
            }}
          />
          <button
            className={"primary" + (conversation ? " tholi-send" : "")}
            disabled={props.pending || props.disabled || !props.draft.trim()}
            type="submit"
            aria-label={conversation || props.compact ? "Send" : undefined}
          >
            <span>
              {props.pending
                ? "Finding your next step"
                : conversation
                  ? "Send"
                  : "Guide me"}
            </span>
            {conversation ? (
              <ArrowUp width={19} aria-hidden="true" />
            ) : (
              <NavArrowRight width={18} aria-hidden="true" />
            )}
          </button>
        </div>
      </form>
      <p id={hintId} className="tholi-reassurance">
        {conversation
          ? "Enter to send · Shift + Enter for a new line"
          : props.preferences.assisted
            ? "Assisted navigation is on. You control final actions."
            : "You make the clicks. Tholi checks your progress."}
      </p>
    </section>
  );
}
