import { useState } from "react";
import { Check, NavArrowDown, ArrowRight } from "iconoir-react";
import "./demo.css";
export function Demo({ onDone }: { onDone?: () => void }) {
  const [step, setStep] = useState(0);
  const instructions = [
    "Open your account menu.",
    "Choose account settings.",
    "Your account settings are open.",
  ];
  return (
    <div
      className="demo"
      data-step={step}
      aria-label="Interactive Tholi demonstration"
    >
      <div className="demo-caption">
        <span className="tholi-dot" />
        Try it here. A sample website, with real next steps.
      </div>
      <div className="demo-browser">
        <div className="demo-chrome" aria-hidden="true">
          <span>
            <i />
            <i />
            <i />
          </span>
          <span>sample.workspace</span>
          <span>DEMO</span>
        </div>
        <div className="demo-top">
          <span className="demo-workspace-name">Your workspace</span>
          <button
            onClick={() => setStep(step === 1 ? 0 : 1)}
            aria-expanded={step === 1}
            className={step === 0 ? "demo-target" : ""}
          >
            Account menu
            <NavArrowDown width={14} aria-hidden="true" />
          </button>
        </div>
        <div className="demo-workspace">
          <div className="demo-rail" aria-hidden="true">
            <span className={step !== 2 ? "selected" : ""}>Overview</span>
            <span className={step === 2 ? "selected" : ""}>Settings</span>
            <span>Help</span>
          </div>
          <div
            className="demo-screen"
            key={step === 2 ? "settings" : "overview"}
          >
            <span className="small">
              {step === 2 ? "YOUR ACCOUNT" : "GOOD TO SEE YOU"}
            </span>
            <h3>
              {step === 2 ? "Account settings" : "A little room to focus."}
            </h3>
            {step === 2 ? (
              <div className="demo-preferences">
                <span>
                  <span>Profile</span>
                  <Check width={16} aria-hidden="true" />
                </span>
                <span>
                  <span>Language</span>
                  <span>English</span>
                </span>
              </div>
            ) : (
              <>
                <p>
                  Everything you need.
                  <br />
                  One place to begin.
                </p>
                <div className="demo-paper" aria-hidden="true">
                  <span />
                  <span />
                  <span />
                </div>
              </>
            )}
          </div>
          {step === 1 && (
            <div className="demo-menu">
              <span className="small">Your account</span>
              <button
                className="demo-target"
                onClick={() => {
                  setStep(2);
                  onDone?.();
                }}
              >
                Account settings
                <ArrowRight width={16} aria-hidden="true" />
              </button>
              <span className="small">Help and support</span>
            </div>
          )}
        </div>
      </div>
      <div className="demo-guide">
        <div className="demo-route-marker" aria-hidden="true">
          {step === 2 ? (
            <Check className="demo-arrived" width={20} />
          ) : (
            <span />
          )}
        </div>
        <div>
          <span className="demo-guide-label">
            {step === 2 ? "ARRIVED" : `YOUR NEXT STEP / ${step + 1} OF 2`}
          </span>
          <p role="status" aria-live="polite" key={step}>
            {instructions[step]}
          </p>
        </div>
        <div className="demo-route-track" aria-hidden="true">
          <i className="passed" />
          <span />
          <i className={step >= 1 ? "passed" : ""} />
          <span />
          <i className={step === 2 ? "passed" : ""} />
        </div>
      </div>
      <div className="demo-bottom">
        <span>You make the clicks. Tholi stays beside you.</span>
        <button onClick={() => setStep(0)}>
          {step === 2 ? "Try again" : "Restart demo"}
        </button>
      </div>
    </div>
  );
}
