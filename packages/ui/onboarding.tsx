import { useEffect, useRef, type ReactNode } from "react";
import { Pause, ShieldCheck, Computer, UserCircle } from "iconoir-react";
import { Wayfinder } from "./WayfinderMark";
import { useVisibleMotion } from "./motion/useVisibleMotion";
import "./styles/onboarding.css";

export const introductionChapters = [
  {
    label: "Your destination",
    title: "Tell Tholi where you want to go.",
    text: "Describe what you want to do in your own words. Tholi helps you find the next step on the website in front of you.",
  },
  {
    label: "Your next step",
    title: "Find your next step. Stay in control.",
    text: "Follow a clear instruction and a highlight. You make the clicks, enter your own details and decide when to pause or stop. Tholi checks for the result before calling a task complete.",
  },
  {
    label: "Your choice",
    title: "Your account is optional.",
    text: "Use Tholi locally with no account required. An account gives you a place to manage available connected features. Signing up does not upload local data or turn on cloud processing.",
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
  const heading = useRef<HTMLHeadingElement>(null);
  const previous = useRef(step);
  useEffect(() => {
    if (previous.current !== step)
      heading.current?.focus({ preventScroll: true });
    previous.current = step;
  }, [step]);
  return (
    <section
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
        <IntroductionScene key={step} step={step} />
        <div className="tholi-introduction-copy">
          <p className="tholi-introduction-eyebrow">
            A LITTLE DIRECTION GOES A LONG WAY
          </p>
          <h1 ref={heading} tabIndex={-1}>
            {chapter.title}
          </h1>
          <p>{chapter.text}</p>
          {notice}
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

function IntroductionScene({ step }: { step: number }) {
  const { ref, visible } = useVisibleMotion<HTMLElement>();
  return (
    <figure
      ref={ref}
      className="tholi-introduction-scene"
      data-playing={visible}
    >
      <div className="tholi-introduction-art" aria-hidden="true">
        {step < 3 ? (
          <div className="tholi-scene-browser">
            <div className="tholi-scene-toolbar">
              <i />
              <i />
              <i />
              <span>A website, one step at a time</span>
            </div>
            <div className="tholi-scene-browser-body">
              <div className="tholi-scene-page">
                <span>YOUR WORKSPACE</span>
                <strong>A place for your next idea.</strong>
                <div className={step === 2 ? "tholi-scene-highlight" : ""}>
                  Account settings
                </div>
                <i />
                <i />
                <i />
              </div>
              <div className="tholi-scene-guide">
                <Wayfinder
                  state={step === 1 ? "planning" : "guiding"}
                  animate={false}
                />
                <strong>Guide</strong>
                <div className="tholi-scene-request">
                  Find my account settings
                </div>
                <p>
                  {step === 1
                    ? "Start with your destination."
                    : "Open the highlighted Account settings control."}
                </p>
                <span>
                  <Pause /> Pause <span>Stop</span>
                </span>
              </div>
            </div>
          </div>
        ) : (
          <div className="tholi-scene-choice">
            <Wayfinder state="attention" animate={false} />
            <div>
              <Computer />
              <strong>On your device</strong>
              <span>Local guidance</span>
              <span>Your data stays yours</span>
            </div>
            <div>
              <UserCircle />
              <strong>Your account</strong>
              <span>Connected features</span>
              <span>Always your choice</span>
            </div>
            <p>
              <ShieldCheck /> Nothing uploads automatically.
            </p>
          </div>
        )}
      </div>
      <figcaption>
        Illustration ·{" "}
        {step === 1
          ? "A destination in your own words"
          : step === 2
            ? "Guidance while you stay in control"
            : "Local and account features stay separate"}
      </figcaption>
    </figure>
  );
}
