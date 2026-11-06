import { useEffect, useRef, useState } from "react";
import {
  Introduction,
  IntroductionPreview,
} from "../../../../../../packages/ui/onboarding";
import { Wayfinder } from "../../../../../../packages/ui/WayfinderMark";
import { useInputModality } from "../../../../../../packages/ui/motion/useInputModality";
import { api } from "../../../platform/api";
import { defaultAccountOrigin } from "../../../platform/account-config";
import { setupStateSchema } from "../../../platform/setup-contract";
import {
  serviceAuthStatusSchema,
  type ServiceAuthStatus,
} from "../../../platform/service-auth-contract";
import { applyAppearance } from "../../theme/apply-appearance";
import { accountRpc, beginAccountAuthentication } from "./account-client";
import "./welcome.css";

export function WelcomeSetup() {
  useInputModality();
  const [introduction, setIntroduction] = useState(false);
  const [step, setStep] = useState(1);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [complete, setComplete] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<ServiceAuthStatus>({
    configured: false,
  });
  const [dark, setDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const generation = useRef(0);
  const finishHeading = useRef<HTMLHeadingElement>(null);
  const origin = status.origin ?? defaultAccountOrigin;
  useEffect(() => {
    applyAppearance(dark ? "dark" : "light");
  }, [dark]);
  useEffect(() => {
    const expected = ++generation.current;
    void Promise.all([
      accountRpc({ type: "SETUP_STATUS" }),
      accountRpc({ type: "AUTH_STATUS" }),
    ])
      .then(([setup, auth]) => {
        if (generation.current !== expected) return;
        const savedSetup = setupStateSchema.parse(setup);
        setStep(savedSetup.step);
        setComplete(savedSetup.complete);
        setStatus(serviceAuthStatusSchema.parse(auth));
      })
      .catch(() => {
        if (generation.current === expected)
          setError(
            "Your account connection could not be opened. You can still use Tholi locally.",
          );
      })
      .finally(() => {
        if (generation.current === expected) setReady(true);
      });
    return () => {
      generation.current++;
    };
  }, []);
  useEffect(() => {
    if (complete) finishHeading.current?.focus();
  }, [complete]);
  const local = async () => {
    const expected = ++generation.current;
    setBusy(true);
    setError("");
    try {
      setupStateSchema.parse(
        await accountRpc({ type: "SETUP_COMPLETE", choice: "local" }),
      );
      if (generation.current === expected) {
        setReady(true);
        setComplete(true);
      }
    } catch {
      if (generation.current === expected)
        setError(
          "Local setup could not be saved. Close this tab and open Tholi to continue locally.",
        );
    } finally {
      if (generation.current === expected) setBusy(false);
    }
  };
  const signIn = (action: "signin" | "signup") => {
    if (!origin || busy) return;
    const expected = ++generation.current;
    setBusy(true);
    setError("");
    // Start permission consent synchronously in this exact click gesture.
    let authentication: Promise<unknown>;
    try {
      authentication = beginAccountAuthentication(
        origin,
        action,
        !status.configured,
        () => generation.current === expected,
      );
    } catch {
      setError("Review your account service in Tholi settings.");
      setBusy(false);
      return;
    }
    void authentication
      .then(async (raw) => {
        if (generation.current !== expected) return;
        const next = serviceAuthStatusSchema.parse(raw);
        if (!next.account) throw Error("Account session missing.");
        setStatus(next);
        setupStateSchema.parse(
          await accountRpc({ type: "SETUP_COMPLETE", choice: "account" }),
        );
        if (generation.current === expected) setComplete(true);
      })
      .catch(() => {
        if (generation.current === expected)
          setError(
            "Sign-in was not completed. Try again when you are ready, or use Tholi locally.",
          );
      })
      .finally(() => {
        if (generation.current === expected) setBusy(false);
      });
  };
  const chooseStep = (next: number) => {
    setStep(next);
    void accountRpc({ type: "SETUP_STEP", step: next }).catch(() =>
      setError(
        "Progress could not be saved. You can continue this introduction.",
      ),
    );
  };
  const localButton = (
    <button type="button" onClick={() => void local()}>
      Use Tholi locally
    </button>
  );
  const availability = (
    <>
      {!origin && (
        <p role="status">
          Accounts are not available in this build yet. Use Tholi locally with
          no account required. Development services can be configured in Account
          settings.
        </p>
      )}
      {busy && (
        <p role="status">
          Completing your account choice. Local guidance remains available.
        </p>
      )}
      {error && (
        <p className="welcome-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
  return (
    <div className="welcome-shell">
      <header>
        <img
          src={api.runtime.getURL("media/tholi_brand_logo.png")}
          width="112"
          height="45"
          alt="Tholi"
        />
        <button
          onClick={() => setDark(!dark)}
          aria-label={`Use ${dark ? "light" : "dark"} theme`}
        >
          {dark ? "Light" : "Dark"}
        </button>
      </header>
      <main aria-busy={!ready}>
        {complete ? (
          <section className="welcome-complete">
            <Wayfinder state="idle" animate={false} />
            <p className="welcome-eyebrow">YOUR NEXT STEP</p>
            <h1 ref={finishHeading} tabIndex={-1}>
              Make room for a little direction.
            </h1>
            <p>
              Your choice is saved. Start guidance on a website when you are
              ready. Your account choice does not enable cloud processing or
              upload local data.
            </p>
            <ol>
              <li>Open a website where you want guidance.</li>
              <li>
                Open your browser’s Extensions menu and choose Tholi. Pin it to
                keep it within reach.
              </li>
              <li>Tell Tholi your destination, then follow the next step.</li>
            </ol>
            <p>
              You can change your account choice in Tholi settings at any time.
              Restricted browser pages cannot be guided.
            </p>
            <a href="https://tholi.io/docs/getting-started">
              Read the getting started guide
            </a>
            <div className="welcome-actions">
              <button
                onClick={() => {
                  setComplete(false);
                  setIntroduction(true);
                  chooseStep(1);
                }}
              >
                Review introduction
              </button>
              {!status.account && origin && (
                <button disabled={busy} onClick={() => signIn("signin")}>
                  Sign in
                </button>
              )}
            </div>
            {availability}
          </section>
        ) : introduction ? (
          <Introduction
            step={step}
            onStep={chooseStep}
            register={
              origin ? (
                <button
                  className={
                    step === 3 ? "tholi-introduction-primary" : undefined
                  }
                  disabled={!ready || busy}
                  onClick={() => signIn("signup")}
                >
                  {step === 3 ? "Create your account" : "Skip introduction"}
                </button>
              ) : null
            }
            local={localButton}
            signIn={
              <button
                disabled={!ready || busy || !origin}
                onClick={() => signIn("signin")}
              >
                Already have an account? Sign in
              </button>
            }
            notice={availability}
          />
        ) : (
          <section className="welcome-choice">
            <div>
              <p className="welcome-eyebrow">
                A LITTLE DIRECTION GOES A LONG WAY
              </p>
              <h1>Find your way forward.</h1>
              <p>
                Less searching through menus. A clearer next step. Tell Tholi
                what you want to do, then follow guidance on the website while
                you stay in control of every click.
              </p>
              <div className="welcome-actions">
                <button
                  className="primary"
                  disabled={!ready || busy}
                  onClick={() => setIntroduction(true)}
                >
                  Sign up
                </button>
                <button
                  disabled={!ready || busy || !origin}
                  onClick={() => signIn("signin")}
                >
                  Sign in
                </button>
              </div>
              <div className="welcome-local">
                {localButton}
                <span>No account required</span>
              </div>
              {availability}
              <p className="small">
                An account is optional. Signing up does not upload local data or
                enable cloud processing.
              </p>
            </div>
            <IntroductionPreview step={2} />
          </section>
        )}
      </main>
      <footer>
        <a href="https://tholi.io/privacy">Privacy</a>
        <a href="https://tholi.io/terms">Terms</a>
        <span>Your clicks. Your choice.</span>
      </footer>
    </div>
  );
}
