import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Accordion } from "@base-ui/react/accordion";
import { ChatBubble, NavArrowDown } from "iconoir-react";
import { GuidanceHeader } from "./GuidanceHeader";
import { CurrentStep, ProcessingStatus, SessionActions } from "./CurrentStep";
import { Conversation } from "./Conversation";
import { DestinationComposer } from "./DestinationComposer";
import type { GuidanceProps } from "./types";
import { useInputModality } from "../motion/useInputModality";
import { markerForPhase } from "../presentation";
import { Wayfinder } from "../WayfinderMark";
import { RoutineNotice } from "./RoutineNotice";
import { RouteSteps } from "./RouteSteps";
import { useWidgetDensity } from "./useWidgetDensity";
import { WidgetAttention } from "./WidgetAttention";
import "../tokens.css";
import "../styles/guidance.css";
import "../styles/widget.css";

export function GuidanceApp(props: GuidanceProps) {
  useInputModality();
  const prefs = props.preferences;
  const p = props.presentation;
  const Root = props.embedded ? "section" : "main";
  const appRoot = useRef<HTMLElement>(null);
  const attentionRoot = useRef<HTMLDivElement>(null);
  const [blockingAttention, setBlockingAttention] = useState(false);
  const [instructionInAttention, setInstructionInAttention] = useState(false);
  const scroller = useRef<HTMLDivElement>(null);
  const density = useWidgetDensity(appRoot, props.widget);
  const [detailsOpen, setDetailsOpen] = useState<string[]>([]);
  const widgetRequired =
    props.attentionRequired ?? (p.warning || !!props.error);
  useLayoutEffect(() => {
    // Conversation follows its transcript. Guide always returns to the current
    // instruction, rather than inheriting the transcript's scroll position.
    if (prefs.mode === "guide" && scroller.current)
      scroller.current.scrollTop = 0;
  }, [prefs.mode]);
  const scrollTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  useEffect(() => () => clearTimeout(scrollTimer.current), []);
  useLayoutEffect(() => {
    if (props.widget) return;
    const text =
      attentionRoot.current?.textContent?.replace(/\s+/g, " ").trim() || "";
    const populated =
      !!text || !!attentionRoot.current?.querySelector("input,select,button");
    const required =
      populated && (props.attentionRequired ?? (p.warning || !!props.error));
    setBlockingAttention(required);
    setInstructionInAttention(
      required &&
        !!p.instruction.trim() &&
        text.includes(p.instruction.replace(/\s+/g, " ").trim()),
    );
  }, [
    props.attentionRequired,
    props.attention,
    props.primary,
    props.error,
    props.widget,
    p.stepId,
    p.instruction,
    p.warning,
  ]);
  return (
    <Root
      ref={appRoot}
      className={
        "tholi-app" +
        (props.widget ? " tholi-widget-app" : "") +
        (props.embedded ? " tholi-embedded-app" : "")
      }
      data-density={props.widget ? density : undefined}
      data-phase={p.phase}
      data-attention={props.widget ? widgetRequired : blockingAttention}
      data-mode={prefs.mode}
      aria-label={props.embedded ? "Tholi practice guide" : undefined}
    >
      {!props.embedded && <h1 className="sr-only">Tholi guidance</h1>}
      {props.showHeader !== false && (
        <GuidanceHeader
          {...props}
          density={density}
          onShowDetails={() => {
            setDetailsOpen(["journey"]);
            if (props.widget && density !== "expanded") props.onExpand?.(false);
          }}
        />
      )}
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
      {props.widget ? (
        widgetRequired ? (
          <WidgetAttention {...props} density={density} />
        ) : null
      ) : (
        (props.error || props.attention || props.primary || props.children) && (
          <section
            className={
              "tholi-attention" +
              (blockingAttention ? " tholi-attention-required" : "")
            }
            aria-label="Important guidance"
            aria-live={blockingAttention ? "polite" : undefined}
          >
            {blockingAttention &&
              !instructionInAttention &&
              p.phase !== "clarification" && (
                <p className="tholi-attention-instruction">{p.instruction}</p>
              )}
            <div ref={attentionRoot}>
              {props.error && (
                <p className="tholi-error error" role="alert">
                  {props.error}
                </p>
              )}
              {props.attention || props.children}
              {props.primary}
            </div>
          </section>
        )
      )}
      <RoutineNotice
        notice={
          !props.widget || density === "expanded" || density === "standard"
            ? props.notice
            : undefined
        }
      />
      <Accordion.Root
        className="tholi-workspace"
        value={detailsOpen}
        onValueChange={setDetailsOpen}
      >
        <Accordion.Item value="journey" className="tholi-journey">
          <Accordion.Header className="tholi-journey-heading" render={<h2 />}>
            <Accordion.Trigger
              className="tholi-journey-summary"
              aria-label="Journey summary and details"
            >
              <Wayfinder
                state={p.marker || markerForPhase(p.phase)}
                animate={!props.draft.trim() || p.phase !== "idle"}
              />
              <span className="tholi-summary-copy">
                <span className="tholi-summary-destination">
                  {p.destination || "Your next step"}
                </span>
                <span className="tholi-summary-state">{p.title}</span>
              </span>
              <NavArrowDown
                className="tholi-disclosure-chevron"
                width={17}
                aria-hidden="true"
              />
            </Accordion.Trigger>
          </Accordion.Header>
          {props.progress && (
            <RouteSteps progress={props.progress} presentation={p} />
          )}
          <div
            ref={scroller}
            className="tholi-body"
            data-mode={prefs.mode}
            onScroll={(e) => {
              const region = e.currentTarget;
              region.dataset.scrolling = "true";
              clearTimeout(scrollTimer.current);
              scrollTimer.current = setTimeout(() => {
                delete region.dataset.scrolling;
              }, 800);
            }}
          >
            <div className="tholi-view-content" key={prefs.mode}>
              {prefs.mode === "guide" ? (
                instructionInAttention ? (
                  <p
                    className="sr-only"
                    role="status"
                    aria-label="Navigation status"
                  >
                    {p.instruction}
                  </p>
                ) : (
                  <CurrentStep {...props} />
                )
              ) : (
                <>
                  {props.widget && (
                    <div className="tholi-compact-current">
                      <CurrentStep {...props} />
                    </div>
                  )}
                  <Conversation
                    messages={props.messages}
                    presentation={p}
                    onCommand={props.onCommand}
                  />
                </>
              )}
            </div>
            <ProcessingStatus {...props} />
            <Accordion.Panel className="tholi-journey-panel">
              <div className="tholi-route-context">
                <h2>Journey details</h2>
                <p>
                  {props.verifiedSteps || 0} verified{" "}
                  {props.verifiedSteps === 1 ? "step" : "steps"}
                  {p.phase === "arrived"
                    ? " · Outcome verified"
                    : " · Your destination stays with you"}
                </p>
              </div>
              {props.details || (
                <p className="small">
                  More route information appears as you navigate.
                </p>
              )}
            </Accordion.Panel>
            {prefs.advanced && props.advanced && (
              <section
                className="tholi-advanced"
                aria-label="Advanced controls"
              >
                {props.advanced}
              </section>
            )}
          </div>
        </Accordion.Item>
      </Accordion.Root>
      <div className="tholi-compose-dock">
        <SessionActions {...props} />
        <DestinationComposer
          {...props}
          compact={
            props.widget && (density === "compact" || density === "minimal")
          }
        />
      </div>
    </Root>
  );
}
