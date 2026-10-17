import { Check, ShieldCheck } from "iconoir-react";
import { useState } from "react";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";
import { SiteLink, useRouter } from "../../app/router";
import { useAccount } from "../account/session";
import { Demo } from "../demo/Demo";
import { DownloadButton, useDownload } from "../downloads/downloads";
import "./onboarding.css";
export function OnboardingPage() {
  const [step, setStep] = useState(0),
    [mode, setMode] = useState<"guide" | "conversation">("guide"),
    [error, setError] = useState("");
  const { account, save } = useAccount(),
    { go } = useRouter(),
    download = useDownload();
  const complete = () => {
    try {
      if (account) save({ ...account, onboarded: true });
      go("/welcome");
    } catch {
      setError(
        "Your demo preference could not be saved. You can still install Tholi without an account.",
      );
    }
  };
  return (
    <section className="onboarding">
      <div className="onboarding-heading">
        <div>
          <p className="eyebrow">YOUR FIRST STEPS</p>
          <h1>
            {step === 0 ? "Make room for a guide." : "Try one clear step."}
          </h1>
          <p className="web-intro">
            {step === 0
              ? "A destination, a highlight, and a little more confidence. Here is how to get started."
              : "Pick a destination in the sample website. Follow the actual Tholi interface, and make each click yourself."}
          </p>
        </div>
        <Wayfinder state={step === 0 ? "idle" : "guiding"} />
      </div>
      <ol className="onboarding-progress" aria-label="Onboarding progress">
        <li aria-current={step === 0 ? "step" : undefined}>
          <span>
            {step === 1 ? <Check width={14} aria-hidden="true" /> : "1"}
          </span>
          Install your guide
        </li>
        <li aria-current={step === 1 ? "step" : undefined}>
          <span>2</span>Take a practice run
        </li>
      </ol>
      <div key={step} className="onboarding-step">
        {step === 0 ? (
          <>
            <div className="onboarding-install">
              <div>
                <h2>A place beside the website.</h2>
                <p>
                  The extension opens in Chrome’s sidebar. A movable widget is
                  available when you would rather keep the guide closer to the
                  page.
                </p>
                <DownloadButton download={download} />
                <SiteLink to="/download" className="web-text-link">
                  See installation steps{" "}
                </SiteLink>
              </div>
              <div className="onboarding-capture">
                <img
                  src="/media/screenshots/guide-panel.webp"
                  alt="Actual Tholi Guide interface"
                  width="420"
                  height="760"
                />
              </div>
            </div>
            <div className="web-note">
              <ShieldCheck aria-hidden="true" />
              <p>
                You approve Chrome’s website access when required. Tholi does
                not enter passwords or perform website actions for you.
              </p>
            </div>
            <button className="primary" onClick={() => setStep(1)}>
              Try the demonstration
            </button>
          </>
        ) : (
          <>
            <fieldset className="preview-mode">
              <legend>Choose how to practice</legend>
              <p className="small">
                A website preview preference. It does not change an installed
                extension.
              </p>
              {(["guide", "conversation"] as const).map((value) => (
                <label key={value}>
                  <input
                    type="radio"
                    name="preview-mode"
                    checked={mode === value}
                    onChange={() => setMode(value)}
                  />
                  {value === "guide" ? "Guide" : "Conversation"}
                </label>
              ))}
            </fieldset>
            <Demo mode={mode} onModeChange={setMode} />
            <button className="primary" onClick={complete}>
              Finish onboarding
            </button>
          </>
        )}
      </div>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      <button className="text-button" onClick={complete}>
        Skip onboarding
      </button>
      <p className="onboarding-caption">
        Optional, local demonstration · {step + 1} of 2
      </p>
    </section>
  );
}
