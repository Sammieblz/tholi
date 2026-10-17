import { useEffect, useRef, useState } from "react";
import { Copy, Check } from "iconoir-react";
import type {
  ConversationMessage,
  GuidancePresentation,
} from "../presentation";

function Message({
  message,
  current,
  onWhy,
}: {
  message: ConversationMessage;
  current?: boolean;
  onWhy?: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [copyError, setCopyError] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <article className={"tholi-message " + message.role}>
      <span className="tholi-message-author">
        {message.role === "user" ? "You" : "Tholi"}
      </span>
      <p
        {...(current
          ? {
              role: "status",
              "aria-label": "Navigation status",
              "aria-live": "polite" as const,
              "aria-atomic": true,
            }
          : {})}
      >
        {message.text}
      </p>
      {message.role === "guide" && (
        <div className="tholi-message-tools">
          <button
            className="icon-button"
            aria-label={copied ? "Guidance copied" : "Copy guidance"}
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(message.text);
                setCopied(true);
                setCopyError(false);
                clearTimeout(timer.current);
                timer.current = setTimeout(() => setCopied(false), 2000);
              } catch {
                setCopyError(true);
              }
            }}
          >
            {copied ? (
              <Check width={16} aria-hidden="true" />
            ) : (
              <Copy width={16} aria-hidden="true" />
            )}
          </button>
          {onWhy && (
            <button className="tholi-why-step" onClick={onWhy}>
              Why this step?
            </button>
          )}
          {copyError && <span role="status">Select the text to copy it.</span>}
        </div>
      )}
    </article>
  );
}

export function Conversation({
  messages,
  presentation,
  onCommand,
}: {
  messages: ConversationMessage[];
  presentation: GuidancePresentation;
  onCommand: (type: string) => void;
}) {
  const [follow, setFollow] = useState(true);
  const list = useRef<HTMLElement>(null);
  const lastGuide = [...messages].reverse().find((m) => m.role === "guide");
  const showCurrent = lastGuide?.text !== presentation.instruction;
  useEffect(() => {
    const scroller = list.current?.closest<HTMLElement>(".tholi-body");
    if (!scroller) return;
    const onScroll = () =>
      setFollow(
        scroller.scrollTop + scroller.clientHeight >=
          scroller.scrollHeight - 64,
      );
    scroller.addEventListener("scroll", onScroll, { passive: true });
    return () => scroller.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    if (!follow || !list.current) return;
    const scroller = list.current.closest<HTMLElement>(".tholi-body");
    if (scroller)
      scroller.scrollTop = Math.max(
        0,
        list.current.offsetTop +
          list.current.offsetHeight -
          scroller.clientHeight,
      );
  }, [messages.length, presentation.stepId, follow]);
  return (
    <section className="tholi-messages" ref={list} aria-label="Conversation">
      {!messages.length && !presentation.destination && (
        <div className="tholi-conversation-welcome">
          <h2>Where shall we go?</h2>
          <p>
            Describe your destination in your own words. You can correct it as
            we go.
          </p>
        </div>
      )}
      {messages.map((m) => (
        <Message
          key={m.id}
          message={m}
          current={!showCurrent && m.id === lastGuide?.id}
          onWhy={
            !showCurrent && m.id === lastGuide?.id && presentation.destination
              ? () => onCommand("WHY")
              : undefined
          }
        />
      ))}
      {showCurrent && (
        <Message
          key={presentation.stepId}
          message={{
            id: presentation.stepId,
            role: "guide",
            text: presentation.instruction,
            at: 0,
          }}
          current
          onWhy={presentation.destination ? () => onCommand("WHY") : undefined}
        />
      )}
    </section>
  );
}
