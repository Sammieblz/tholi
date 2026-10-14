import { ChatBubble } from "iconoir-react";
import { GuidanceHeader } from "./GuidanceHeader";
import { CurrentStep } from "./CurrentStep";
import { Conversation } from "./Conversation";
import { DestinationComposer } from "./DestinationComposer";
import type { GuidanceProps } from "./types";
import { useInputModality } from "../motion/useInputModality";
import "../tokens.css";
import "../styles/guidance.css";
export function GuidanceApp(props: GuidanceProps) {
  useInputModality();
  const prefs = props.preferences;
  return (
    <main className={"tholi-app" + (props.widget ? " tholi-widget-app" : "")}>
      <GuidanceHeader {...props} />
      <div
        className="tholi-view-switch"
        data-mode={prefs.mode}
        aria-label="Guidance view"
      >
        <span className="tholi-view-indicator" aria-hidden="true" />
        <button
          aria-pressed={prefs.mode === "guide"}
          onClick={() => props.onPreferences({ ...prefs, mode: "guide" })}
        >
          Guide
        </button>
        <button
          aria-pressed={prefs.mode === "conversation"}
          onClick={() =>
            props.onPreferences({ ...prefs, mode: "conversation" })
          }
        >
          <ChatBubble width={17} aria-hidden="true" />
          Conversation
        </button>
      </div>
      <CurrentStep {...props} />
      <div className="tholi-body" data-mode={prefs.mode}>
        {prefs.mode === "conversation" && (
          <Conversation messages={props.messages} />
        )}
        <DestinationComposer {...props} />
        {props.children}
        {props.details}
        {prefs.advanced && props.advanced && (
          <section className="tholi-advanced" aria-label="Advanced controls">
            {props.advanced}
          </section>
        )}
      </div>
    </main>
  );
}
