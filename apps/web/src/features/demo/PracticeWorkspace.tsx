import { Popover } from "@base-ui/react/popover";
import { Check, NavArrowDown, Refresh } from "iconoir-react";
import { type ReactNode } from "react";
import { createPortal } from "react-dom";
import { GuidanceApp } from "../../../../../packages/ui/guidance/GuidanceApp";
import guidanceStyles from "../../../../../packages/ui/styles/guidance.css?inline";
import motionStyles from "../../../../../packages/ui/styles/motion.css?inline";
import tokenStyles from "../../../../../packages/ui/styles/tokens.css?inline";
import "./demo.css";
import { goals } from "./practice";
import type { usePracticeAdapter } from "./usePracticeAdapter";
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
export function PracticeWorkspace({
  adapter,
}: {
  adapter: ReturnType<typeof usePracticeAdapter>;
}) {
  const {
    container,
    motionActive,
    start,
    menu,
    setMenu,
    recordStep,
    highlighted,
    screen,
    setScreen,
    language,
    languageMenu,
    setLanguageMenu,
    selection,
    task,
    setSelection,
    setLanguage,
    theme,
    setShadow,
    shadow,
    presentation,
    preferences,
    setPreferences,
    draft,
    setDraft,
    messages,
    active,
    paused,
    command,
    setTask,
    setComplete,
    setUnsupported,
    setPaused,
    onModeChange,
    verifiedPath,
    unsupported,
    nextSteps,
    complete,
    reset,
  } = adapter;
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
          Find account settings
        </button>
        <button onClick={() => start(goals.spanish)}>Switch to Spanish</button>
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
                Account settings
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
          data-tholi-theme={theme === "dark" ? "light" : "dark"}
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
