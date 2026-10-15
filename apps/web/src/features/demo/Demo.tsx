import { useEffect, useRef, useState, type ReactNode } from "react";
import { Popover } from "@base-ui/react/popover";
import { createPortal } from "react-dom";
import { Check, NavArrowDown, ArrowRight, Refresh } from "iconoir-react";
import { GuidanceApp } from "../../../../../packages/ui/guidance/GuidanceApp";
import {
  conversationCommand,
  type ConversationMessage,
  type GuidancePresentation,
} from "../../../../../packages/ui/presentation";
import type { UIPreferences } from "../../../../../packages/ui/guidance/types";
import tokenStyles from "../../../../../packages/ui/styles/tokens.css?inline";
import motionStyles from "../../../../../packages/ui/styles/motion.css?inline";
import guidanceStyles from "../../../../../packages/ui/styles/guidance.css?inline";
import "./demo.css";

type Task = "settings" | "spanish";
const initialPreferences: UIPreferences = {
  mode: "guide",
  surface: "sidebar",
  advanced: false,
};
const goals: Record<Task, string> = {
  settings: "Show me my account settings",
  spanish: "Change my language to Spanish",
};

function PracticePopover({
  open,
  onOpenChange,
  container,
  label,
  trigger,
  className = "",
  language = false,
  children,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  container: HTMLElement | null;
  label: string;
  trigger: ReactNode;
  className?: string;
  language?: boolean;
  children: ReactNode;
}) {
  return (
    <Popover.Root open={open} onOpenChange={onOpenChange}>
      <Popover.Trigger className={className}>{trigger}</Popover.Trigger>
      <Popover.Portal container={container || undefined}>
        <Popover.Positioner
          sideOffset={12}
          align="end"
          className="demo-positioner"
        >
          <Popover.Popup
            className={`demo-popover ${language ? "demo-language" : "demo-menu"}`}
          >
            <Popover.Title className="sr-only">{label}</Popover.Title>
            {children}
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  );
}

/** A controlled sample adapter. Website clicks, not timers, supply outcome evidence. */
export function Demo({
  mode,
  onModeChange,
  onDone,
}: {
  mode?: UIPreferences["mode"];
  onModeChange?: (mode: UIPreferences["mode"]) => void;
  onDone?: () => void;
}) {
  const [shadow, setShadow] = useState<ShadowRoot | null>(null);
  const [preferences, setPreferences] = useState(initialPreferences);
  const [draft, setDraft] = useState(goals.settings);
  const [task, setTask] = useState<Task>();
  const [screen, setScreen] = useState<"overview" | "settings">("overview");
  const [menu, setMenu] = useState(false);
  const [languageMenu, setLanguageMenu] = useState(false);
  const [language, setLanguage] = useState("English");
  const [selection, setSelection] = useState("English");
  const [paused, setPaused] = useState(false);
  const [complete, setComplete] = useState(false);
  const [unsupported, setUnsupported] = useState(false);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [verifiedPath, setVerifiedPath] = useState<string[]>([]);
  const [motionActive, setMotionActive] = useState(false);
  const container = useRef<HTMLDivElement>(null);
  const id = useRef(0),
    lastStep = useRef("");
  const append = (role: ConversationMessage["role"], text: string) =>
    setMessages((previous) =>
      [
        ...previous,
        { id: `sample-${++id.current}`, role, text, at: Date.now() },
      ].slice(-40),
    );
  useEffect(() => {
    if (mode) setPreferences((previous) => ({ ...previous, mode }));
  }, [mode]);
  useEffect(() => {
    let inView = false;
    const update = () =>
      setMotionActive(inView && document.visibilityState !== "hidden");
    const observer = new IntersectionObserver(([entry]) => {
      inView = entry.isIntersecting;
      update();
    });
    if (container.current) observer.observe(container.current);
    document.addEventListener("visibilitychange", update);
    return () => {
      observer.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  useEffect(() => {
    if (!task || paused || complete) return;
    if (
      (task === "settings" && screen === "settings") ||
      (task === "spanish" && language === "Español")
    ) {
      setComplete(true);
      onDone?.();
    }
  }, [task, paused, complete, screen, language, onDone]);
  const active = !!task && !complete;
  const recordStep = (label: string) => {
    if (active && !paused) setVerifiedPath((path) => [...path, label]);
  };
  const nextSteps =
    task && !complete
      ? [
          ...(screen === "overview"
            ? [...(!menu ? ["Open account menu"] : []), "Account settings"]
            : []),
          ...(task === "spanish"
            ? selection === "Español"
              ? ["Save changes"]
              : [
                  ...(!languageMenu ? ["Open Language"] : []),
                  "Choose Español",
                  "Save changes",
                ]
            : []),
        ]
      : [];
  let instruction =
    "Choose a sample destination, then use the highlighted controls in the practice website.";
  let phase: GuidancePresentation["phase"] = "idle";
  if (unsupported) {
    phase = "clarification";
    instruction =
      "This practice website supports account settings and changing the language to Spanish. Choose one of those destinations below.";
  } else if (task) {
    phase = complete ? "arrived" : paused ? "paused" : "guiding";
    instruction = complete
      ? task === "spanish"
        ? "The saved language is Español. Your requested change is verified in this sample website."
        : "Account settings are open. Your destination is verified in this sample website."
      : paused
        ? "Your destination is saved. Resume when you are ready to continue."
        : screen !== "settings"
          ? menu
            ? "Choose Account settings in the open account menu."
            : "Open the Account menu in the practice website."
          : !languageMenu
            ? selection === "Español"
              ? "Select Save changes to apply the language you chose."
              : "Open the Language control in account settings."
            : "Choose Español from the available languages.";
  }
  const presentation: GuidancePresentation = {
    phase,
    stepId: `practice:${task || "idle"}:${phase}:${screen}:${menu}:${languageMenu}:${selection}`,
    title: complete
      ? "Arrived"
      : paused
        ? "Paused"
        : unsupported
          ? "Choose a practice destination"
          : task
            ? "Your next step"
            : "Meet your guide",
    instruction,
    destination: task ? goals[task] : undefined,
    warning: unsupported,
    busy: false,
  };
  useEffect(() => {
    if (lastStep.current === presentation.stepId || !task) return;
    lastStep.current = presentation.stepId;
    append("guide", instruction);
  }, [presentation.stepId, task, instruction]);
  const command = (type: string) => {
    if (type === "PAUSE") setPaused(true);
    if (type === "RESUME") setPaused(false);
    if (type === "STOP") {
      setTask(undefined);
      setPaused(false);
      setComplete(false);
      setUnsupported(false);
      append(
        "guide",
        "Practice guidance stopped. Your conversation is still here.",
      );
    }
  };
  const start = (value: string) => {
    if (!value.trim()) return;
    append("user", value.trim());
    const parsed = conversationCommand(value);
    if (parsed === "WHY") {
      append(
        "guide",
        task
          ? "This step points to a visible control in the sample website. Arrival is checked against the open settings screen or the saved language, not the click alone."
          : "Choose a destination first. This is a local, controlled demonstration, not a general question answering assistant.",
      );
      setDraft("");
      return;
    }
    if (parsed) {
      command(parsed);
      setDraft("");
      return;
    }
    const excluded = /\b(?:don't|do not|never|without|avoid|not)\b/i.test(
      value,
    );
    const languageRequest = /language|spanish|espa[nñ]ol|french|german/i.test(
      value,
    );
    const next = excluded
      ? undefined
      : languageRequest
        ? /spanish|espa[nñ]ol/i.test(value)
          ? "spanish"
          : undefined
        : /account|settings|profile/i.test(value)
          ? "settings"
          : undefined;
    setTask(next);
    setVerifiedPath([]);
    setUnsupported(!next);
    setComplete(false);
    setPaused(false);
    setDraft("");
  };
  const reset = () => {
    setTask(undefined);
    setScreen("overview");
    setMenu(false);
    setLanguageMenu(false);
    setLanguage("English");
    setSelection("English");
    setComplete(false);
    setPaused(false);
    setUnsupported(false);
    setDraft(goals.settings);
    setMessages([]);
    setVerifiedPath([]);
    lastStep.current = "";
  };
  const highlighted = active && !paused;
  return (
    <div
      className="demo"
      ref={container}
      data-motion-active={motionActive}
      aria-label="Interactive Tholi demonstration"
    >
      <div className="demo-caption">
        <span>CONTROLLED PRACTICE</span>
        <span>The actual Tholi interface. A safe sample website.</span>
      </div>
      <div className="demo-destinations" aria-label="Practice destinations">
        <button onClick={() => start(goals.settings)}>
          Find account settings <ArrowRight width={15} aria-hidden="true" />
        </button>
        <button onClick={() => start(goals.spanish)}>
          Switch to Spanish <ArrowRight width={15} aria-hidden="true" />
        </button>
      </div>
      <div className="demo-stage">
        <div className="demo-browser" aria-label="Practice website">
          <div className="demo-chrome">
            <span>fieldnote.workspace</span>
            <span>SAMPLE SITE</span>
          </div>
          <div className="demo-top">
            <strong>
              fieldnote<span>.</span>
            </strong>
            <PracticePopover
              open={menu}
              onOpenChange={(open) => {
                setMenu(open);
                if (open && !menu) recordStep("Open account menu");
              }}
              container={container.current}
              label="Account actions"
              trigger={
                <>
                  Account menu <NavArrowDown width={16} aria-hidden="true" />
                </>
              }
              className={
                highlighted && screen === "overview" && !menu
                  ? "demo-target"
                  : ""
              }
            >
              <span className="small">Demo explorer</span>
              <button
                className={
                  highlighted && screen !== "settings" ? "demo-target" : ""
                }
                onClick={() => {
                  if (screen !== "settings") recordStep("Account settings");
                  setScreen("settings");
                  setMenu(false);
                }}
              >
                Account settings <ArrowRight width={16} aria-hidden="true" />
              </button>
              <span className="small">This is a practice website.</span>
            </PracticePopover>
          </div>
          <div className="demo-workspace">
            <div className="demo-screen" key={screen}>
              <p className="eyebrow">
                {screen === "settings" ? "YOUR ACCOUNT" : "YOUR WORKSPACE"}
              </p>
              <h3>
                {screen === "settings"
                  ? "Account settings"
                  : "Room for your next idea."}
              </h3>
              {screen === "overview" ? (
                <>
                  <p>A calm space to work, plan, and make something yours.</p>
                  <div className="demo-project">
                    <span>Personal workspace</span>
                    <strong>A fresh start</strong>
                    <span>Everything is right where you left it.</span>
                  </div>
                </>
              ) : (
                <div className="demo-preferences">
                  <div>
                    <span>Profile</span>
                    <span>Demo explorer</span>
                  </div>
                  <div>
                    <span>Saved language</span>
                    <strong data-testid="saved-language">{language}</strong>
                  </div>
                  <PracticePopover
                    open={languageMenu}
                    onOpenChange={(open) => {
                      setLanguageMenu(open);
                      if (open && !languageMenu) recordStep("Open Language");
                    }}
                    container={container.current}
                    label="Language choices"
                    language
                    trigger={
                      <>
                        Language: {selection}
                        <NavArrowDown width={16} aria-hidden="true" />
                      </>
                    }
                    className={
                      highlighted &&
                      task === "spanish" &&
                      !languageMenu &&
                      selection !== "Español"
                        ? "demo-target"
                        : ""
                    }
                  >
                    {["English", "Español"].map((option) => (
                      <button
                        key={option}
                        className={
                          highlighted &&
                          task === "spanish" &&
                          option === "Español"
                            ? "demo-target"
                            : ""
                        }
                        onClick={() => {
                          if (option !== selection)
                            recordStep(`Choose ${option}`);
                          setSelection(option);
                          setLanguageMenu(false);
                        }}
                      >
                        {option}
                        {selection === option && (
                          <Check width={16} aria-hidden="true" />
                        )}
                      </button>
                    ))}
                  </PracticePopover>
                  <button
                    className={`primary ${highlighted && task === "spanish" && selection === "Español" && !languageMenu ? "demo-target" : ""}`}
                    onClick={() => {
                      if (language !== selection) recordStep("Save changes");
                      setLanguage(selection);
                    }}
                  >
                    Save changes
                  </button>
                  <p role="status" className="small">
                    {language === "Español"
                      ? "Changes saved. Language: Español."
                      : "Changes stay inside this sample website."}
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>
        <div
          className="demo-guidance-host"
          data-tholi-theme="light"
          ref={(host) => {
            if (host && !host.shadowRoot)
              setShadow(host.attachShadow({ mode: "open" }));
          }}
        />
        {shadow &&
          createPortal(
            <>
              <style>
                {tokenStyles +
                  motionStyles +
                  guidanceStyles +
                  `:host{display:block;color-scheme:light;font-family:Manrope,system-ui,sans-serif} .tholi-app{height:100%;min-height:0;max-width:none;width:100%;margin:0;border:0} .tholi-header{flex:none} .tholi-body{min-height:0} .tholi-logo{max-width:80px} :host-context(html[data-input=keyboard]) *:not(.wf-seed):not(.wf-piece):not(.wf-route-orbit):not(.wf-checking):not(.tholi-route-signal){animation-duration:0ms!important;transition-duration:0ms!important}`}
              </style>
              <GuidanceApp
                embedded
                hideSettings
                showHeader
                presentation={presentation}
                preferences={preferences}
                onPreferences={(next) => {
                  setPreferences(next);
                  onModeChange?.(next.mode);
                }}
                draft={draft}
                onDraft={setDraft}
                onSubmit={() => start(draft)}
                messages={messages}
                logo="/media/tholi_brand_logo.png"
                active={active && !paused}
                paused={paused}
                pending={false}
                onCommand={command}
                onNewDestination={() => {
                  setTask(undefined);
                  setComplete(false);
                  setUnsupported(false);
                  setPaused(false);
                  setDraft("");
                  shadow
                    .querySelector<HTMLTextAreaElement>("textarea")
                    ?.focus();
                }}
                verifiedSteps={verifiedPath.length}
                progress={
                  task && !unsupported
                    ? {
                        journeyId: `practice:${task}`,
                        verified: verifiedPath.length,
                        recentLabels: verifiedPath,
                        next: nextSteps.map((label, index) => ({
                          id: `practice:${label}`,
                          label,
                          evidence: index === 0 ? "live" : "predicted",
                        })),
                        complete: true,
                        arrived: complete,
                      }
                    : undefined
                }
              />
            </>,
            shadow,
          )}
      </div>
      <div className="demo-bottom">
        <span>Manual clicks. Visible evidence. No real account changes.</span>
        <button onClick={reset}>
          <Refresh width={15} aria-hidden="true" />
          Reset practice
        </button>
      </div>
    </div>
  );
}
