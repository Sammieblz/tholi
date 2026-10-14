import "./onboarding.css";
import { useState } from "react";
import { NavArrowRight } from "iconoir-react";
import { SiteLink, useRouter } from "../../app/router";
import { useAccount } from "../account/session";
import { Demo } from "../demo/Demo";
import { DownloadButton, useDownload } from "../downloads/downloads";
export function OnboardingPage() {
  const [step, setStep] = useState(0),
    [mode, setMode] = useState("Guide"),
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
      <p className="eyebrow">YOUR FIRST STEPS</p>
      <div className="onboarding-progress" aria-hidden="true">
        <span className="complete" />
        <span className={step === 1 ? "complete" : ""} />
      </div>
      <h1>{step === 0 ? "Make room for a guide." : "Try one clear step."}</h1>
      <p className="small">Optional demo onboarding · {step + 1} of 2</p>
      <div key={step} className="onboarding-step">
        {step === 0 ? (
          <>
            <p>
              Install Tholi, then try a destination on a website. You’ll approve
              website access when Chrome needs it.
            </p>
            <DownloadButton download={download} />
            <p>
              <SiteLink to="/download">See installation steps</SiteLink>
            </p>
            <fieldset>
              <legend>Website preview preference</legend>
              <p className="small">
                This changes the demo only. Set your installed extension’s
                preferences inside Tholi.
              </p>
              {["Guide", "Conversation"].map((m) => (
                <label key={m}>
                  <input
                    type="radio"
                    name="preview-mode"
                    checked={mode === m}
                    onChange={() => setMode(m)}
                  />
                  {m}
                </label>
              ))}
            </fieldset>
            <button className="primary" onClick={() => setStep(1)}>
              Try the demonstration
              <NavArrowRight width={18} aria-hidden="true" />
            </button>
          </>
        ) : (
          <>
            <p>
              Use the highlighted account menu, then choose account settings.
              This demonstration has no real website effects.
            </p>
            <Demo />
            <button className="primary" onClick={complete}>
              Finish onboarding
            </button>
          </>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <button className="text-button" onClick={complete}>
        Skip onboarding
      </button>
    </section>
  );
}
