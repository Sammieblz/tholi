import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  Pause,
  ShieldCheck,
  Computer,
  UserCircle,
  ChatBubble,
} from "iconoir-react";
import { Wayfinder } from "./WayfinderMark";
import { useVisibleMotion } from "./motion/useVisibleMotion";
import "./styles/onboarding.css";

export const introductionChapters = [
  {
    label: "Your destination",
    title: "Tell Tholi where you want to go.",
    text: "Less hunting through unfamiliar menus. More getting on with your day. Describe the result you want in your own words, and Tholi helps you find a next step on the website in front of you.",
  },
  {
    label: "Your next step",
    title: "Find your next step. Stay in control.",
    text: "A clear instruction. A highlight on the page. Follow along in Guide, ask a question in Conversation, or keep Tholi close in the floating widget. You make the clicks. Tholi checks your progress, and you can pause or stop whenever you need.",
  },
  {
    label: "Your choice",
    title: "Your account is optional.",
    text: "Start with local guidance, with no account required. An account gives you a place to manage available connected features. Sharing local data and enabling cloud processing remain separate choices.",
  },
] as const;

export function introductionStep(value: string | null) {
  return value === "2" ? 2 : value === "3" ? 3 : 1;
}

/** Shared explanation only. Each host owns navigation, credentials and completion. */
export function Introduction({
  step,
  onStep,
  register,
  local,
  signIn,
  notice,
}: {
  step: number;
  onStep: (step: number) => void;
  register: ReactNode;
  local: ReactNode;
  signIn: ReactNode;
  notice?: ReactNode;
}) {
  const chapter = introductionChapters[step - 1] ?? introductionChapters[0];
  const section = useRef<HTMLElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(step);
  useEffect(() => {
    if (previous.current !== step) {
      const keyboard = document.documentElement.dataset.input === "keyboard";
      heading.current?.focus({ preventScroll: !keyboard });
      if (!keyboard)
        section.current?.scrollIntoView({
          block: "start",
          behavior: "instant",
        });
    }
    previous.current = step;
  }, [step]);
  return (
    <section
      ref={section}
      className="tholi-introduction"
      aria-label="An introduction to Tholi"
    >
      <ol
        className="tholi-introduction-progress"
        aria-label="Introduction progress"
      >
        {introductionChapters.map((item, index) => (
          <li
            key={item.label}
            aria-current={step === index + 1 ? "step" : undefined}
          >
            <span aria-hidden="true">0{index + 1}</span>
            {item.label}
          </li>
        ))}
      </ol>
      <div className="tholi-introduction-layout">
        <IntroductionPreview key={step} step={step} />
        <div className="tholi-introduction-copy">
          <p className="tholi-introduction-eyebrow">
            A LITTLE DIRECTION GOES A LONG WAY
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {chapter.title}
          </h1>
          <p>{chapter.text}</p>
          {step === 1 && (
            <div className="tholi-introduction-examples">
              <p>A few ways to begin</p>
              <ul>
                <li>
                  <q>Find the language settings.</q>
                </li>
                <li>
                  <q>Show me where to create a new repository.</q>
                </li>
              </ul>
            </div>
          )}
          <div className="tholi-introduction-actions">
            {step > 1 && (
              <button type="button" onClick={() => onStep(step - 1)}>
                Back
              </button>
            )}
            {step < 3 ? (
              <button
                type="button"
                className="tholi-introduction-primary"
                onClick={() => onStep(step + 1)}
              >
                Next
              </button>
            ) : (
              register
            )}
          </div>
          {step < 3 && (
            <div className="tholi-introduction-skip">{register}</div>
          )}
          {notice}
          <div className="tholi-introduction-alternatives">
            {local}
            <span>No account required</span>
            {signIn}
          </div>
        </div>
      </div>
    </section>
  );
}

/** An explanatory preview only. These scenes never control a website or extension. */
export function IntroductionPreview({ step }: { step: number }) {
  const { ref, visible } = useVisibleMotion<HTMLElement>();
  const [surface, setSurface] = useState<"sidebar" | "widget">("sidebar");
  const layout = step === 2 ? surface : "sidebar";
  return (
    <figure
      ref={ref}
      className="tholi-introduction-scene"
      data-playing={visible}
    >
      <div className="tholi-introduction-art" aria-hidden="true">
        {step < 3 ? (
          <div className="tholi-scene-browser" data-surface={layout}>
            <div className="tholi-scene-toolbar">
              <span className="tholi-scene-window-dots">
                <i />
                <i />
                <i />
              </span>
              <span>Example workspace</span>
              <ShieldCheck />
            </div>
            <div className="tholi-scene-browser-body">
              <div className="tholi-scene-page">
                <div className="tholi-scene-workspace-header">
                  <span className="tholi-scene-workspace-mark">
                    <Computer />
                  </span>
                  <strong>Your workspace</strong>
                </div>
                <div className="tholi-scene-workspace-layout">
                  <div className="tholi-scene-menu">
                    <span>Overview</span>
                    <span>Projects</span>
                    <span className={step === 2 ? "tholi-scene-highlight" : ""}>
                      <UserCircle /> Account settings
                    </span>
                  </div>
                  <div className="tholi-scene-workspace-content">
                    <span>RECENT ACTIVITY</span>
                    <strong>A place for your next idea.</strong>
                    <div className="tholi-scene-document">
                      <i />
                      <i />
                      <i />
                    </div>
                    <div className="tholi-scene-document">
                      <i />
                      <i />
                    </div>
                  </div>
                </div>
              </div>
              <GuidePreview step={step} />
            </div>
          </div>
        ) : (
          <div className="tholi-scene-choice">
            <div className="tholi-scene-choice-heading">
              <Wayfinder state="idle" animate={false} />
              <span>A little direction. On your terms.</span>
            </div>
            <div className="tholi-scene-choice-area">
              <Computer />
              <strong>On your device</strong>
              <span>Start guiding without an account.</span>
              <div className="tholi-scene-private-record">
                <span>Saved routes</span>
                <small>Kept in this browser</small>
              </div>
            </div>
            <div className="tholi-scene-choice-area">
              <UserCircle />
              <strong>Your account</strong>
              <span>Explore available connected features.</span>
              <div className="tholi-scene-private-record">
                <span>Sharing and processing</span>
                <small>Separate choices</small>
              </div>
            </div>
            <p>
              <ShieldCheck /> Nothing uploads automatically.
            </p>
          </div>
        )}
      </div>
      {step === 2 && (
        <div
          className="tholi-scene-surface-choice"
          role="group"
          aria-label="Preview guidance layout"
        >
          <span>Keep your guide where it suits you</span>
          <div>
            <button
              type="button"
              aria-pressed={surface === "sidebar"}
              onClick={() => setSurface("sidebar")}
            >
              Sidebar preview
            </button>
            <button
              type="button"
              aria-pressed={surface === "widget"}
              onClick={() => setSurface("widget")}
            >
              Floating widget preview
            </button>
          </div>
        </div>
      )}
      <figcaption aria-live="polite">
        Illustration ·{" "}
        {step === 1
          ? "Tell Tholi the destination. Start with one focused request."
          : step === 2
            ? `${surface === "sidebar" ? "Sidebar" : "Floating widget"} guidance points to Account settings. You make the click.`
            : "Local and account features stay separate. Your choice comes first."}
      </figcaption>
    </figure>
  );
}

function GuidePreview({ step }: { step: number }) {
  return (
    <div className="tholi-scene-guide">
      <div className="tholi-scene-guide-brand">
        <Wayfinder
          state={step === 1 ? "planning" : "guiding"}
          animate={false}
        />
        <strong>Tholi</strong>
      </div>
      <div className="tholi-scene-guide-tabs">
        <span data-selected={step === 2}>Guide</span>
        <span data-selected={step === 1}>
          <ChatBubble /> Conversation
        </span>
      </div>
      {step === 1 ? (
        <div className="tholi-scene-conversation">
          <p>Where would you like to go?</p>
          <div className="tholi-scene-request">Find my account settings.</div>
          <span className="tholi-scene-guide-start">Guide me</span>
        </div>
      ) : (
        <div className="tholi-scene-instruction">
          <span className="tholi-scene-step-label">YOUR NEXT STEP</span>
          <p>
            Open the highlighted <strong>Account settings</strong> control in
            the left menu.
          </p>
          <span className="tholi-scene-destination">
            Destination: Account settings
          </span>
        </div>
      )}
      <div className="tholi-scene-guide-controls">
        <span>
          <Pause /> Pause
        </span>
        <span>Stop</span>
      </div>
    </div>
  );
}
