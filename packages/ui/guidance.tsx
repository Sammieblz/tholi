import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import {
  Settings,
  Pause,
  Play,
  Square,
  Check,
  Expand,
  ChatBubble,
  NavArrowRight,
} from "iconoir-react";
import type { ConversationMessage, GuidancePresentation } from "./presentation";
import "./tokens.css";
import "./guidance.css";

export interface UIPreferences {
  mode: "guide" | "conversation";
  surface: "sidebar" | "widget";
  advanced: boolean;
}
export const defaultPreferences: UIPreferences = {
  mode: "guide",
  surface: "sidebar",
  advanced: false,
};
export function GuidanceApp(props: {
  presentation: GuidancePresentation;
  preferences: UIPreferences;
  onPreferences: (p: UIPreferences) => void;
  draft: string;
  onDraft: (v: string) => void;
  onSubmit: () => void;
  messages: ConversationMessage[];
  logo: string;
  active: boolean;
  paused: boolean;
  pending: boolean;
  disabled?: boolean;
  error?: string;
  verifiedSteps?: number;
  onCommand: (type: string) => void;
  primary?: ReactNode;
  details?: ReactNode;
  advanced?: ReactNode;
  widget?: boolean;
  onExpand?: () => void;
  onMoveAside?: () => void;
  children?: ReactNode;
}) {
  const { presentation: p, preferences: prefs } = props;
  const [activity, setActivity] = useState(false),
    [settings, setSettings] = useState(false);
  const end = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  useEffect(() => {
    setActivity(false);
    if (!p.busy) return;
    const id = setTimeout(() => setActivity(true), 200);
    return () => clearTimeout(id);
  }, [p.busy, p.phase]);
  useEffect(() => {
    if (follow && prefs.mode === "conversation")
      end.current?.scrollIntoView({ block: "nearest" });
  }, [props.messages.length, follow, prefs.mode]);
  return (
    <main className={"tholi-app" + (props.widget ? " tholi-widget-app" : "")}>
      <header className="tholi-header">
        <img className="tholi-logo" src={props.logo} alt="Tholi" />
        <div className="tholi-header-actions">
          {props.widget && (
            <button
              className="icon-button"
              aria-label="Expand widget"
              onClick={props.onExpand}
            >
              <Expand width={20} />
            </button>
          )}
          <Popover.Root open={settings} onOpenChange={setSettings}>
            <Popover.Trigger
              className="icon-button"
              aria-label="Tholi settings"
            >
              <Settings width={20} />
            </Popover.Trigger>
            <Popover.Portal>
              <Popover.Positioner sideOffset={8}>
                <Popover.Popup className="tholi-popover">
                  <Popover.Title>Make Tholi yours</Popover.Title>
                  <label>
                    <input
                      type="checkbox"
                      checked={prefs.advanced}
                      onChange={(e) =>
                        props.onPreferences({
                          ...prefs,
                          advanced: e.target.checked,
                        })
                      }
                    />
                    Advanced controls
                  </label>
                  <button
                    onClick={() => {
                      props.onPreferences({
                        ...prefs,
                        surface:
                          prefs.surface === "sidebar" ? "widget" : "sidebar",
                      });
                      setSettings(false);
                    }}
                  >
                    {prefs.surface === "sidebar"
                      ? "Use floating widget"
                      : "Use sidebar"}
                  </button>
                  {props.widget && (
                    <p className="small">
                      <button onClick={props.onMoveAside}>Move aside</button>
                      Backend credentials and advanced tools are available in
                      the sidebar.
                    </p>
                  )}
                </Popover.Popup>
              </Popover.Positioner>
            </Popover.Portal>
          </Popover.Root>
        </div>
      </header>
      <div className="tholi-view-switch" aria-label="Guidance view">
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
          <ChatBubble width={17} />
          Conversation
        </button>
      </div>
      <section
        className={"tholi-current " + (p.warning ? "tholi-warning" : "")}
        data-phase={p.phase}
        aria-label="Current guidance"
      >
        {p.destination && (
          <div className="tholi-destination">
            <span className="tholi-dot" />
            <span>{p.destination}</span>
          </div>
        )}
        <div className="tholi-phase">
          {activity && <span className="tholi-spinner" aria-hidden="true" />}
          {p.phase === "arrived" && (
            <Check className="tholi-arrival" width={24} aria-hidden="true" />
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
        {(props.active || props.paused) && (
          <div className="tholi-session-actions">
            <button
              disabled={props.pending || props.disabled}
              aria-label={
                props.paused ? "Resume navigation" : "Pause navigation"
              }
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
      <div className="tholi-body">
        {prefs.mode === "conversation" && (
          <section
            className="tholi-messages"
            aria-label="Conversation"
            onScroll={(e) => {
              const el = e.currentTarget;
              setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 50);
            }}
          >
            {props.messages.map((m) => (
              <article key={m.id} className={"tholi-message " + m.role}>
                <span className="sr-only">
                  {m.role === "user" ? "You" : "Tholi"}:{" "}
                </span>
                {m.text}
              </article>
            ))}
            <div ref={end} />
          </section>
        )}
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
