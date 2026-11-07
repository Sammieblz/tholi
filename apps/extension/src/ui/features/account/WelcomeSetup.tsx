import { useEffect, useRef, useState } from "react";
import {
  Introduction,
  IntroductionRecording,
} from "../../../../../../packages/ui/onboarding";
import { Wayfinder } from "../../../../../../packages/ui/WayfinderMark";
import { useInputModality } from "../../../../../../packages/ui/motion/useInputModality";
import { api } from "../../../platform/api";
import { defaultAccountOrigin } from "../../../platform/account-config";
import {
  setupStateSchema,
  setupPlansSchema,
} from "../../../platform/setup-contract";
import type { ProductCatalog } from "../../../../../../packages/navigation-core/contracts-plans";
import type { ServiceAuthIntent } from "../../../../../../packages/navigation-core/contracts-service";
import { requestBackendAccess } from "../../../platform/site-access";
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
  const [showChoices, setShowChoices] = useState(false);
  const [planIntent, setPlanIntent] =
    useState<ServiceAuthIntent["planIntent"]>();
  const [catalog, setCatalog] = useState<ProductCatalog>();
  const [consent, setConsent] = useState(false);
  const [images, setImages] = useState(false);
  const [error, setError] = useState("");
  const [status, setStatus] = useState<ServiceAuthStatus>({
    configured: false,
  });
  const [dark, setDark] = useState(
    () => matchMedia("(prefers-color-scheme: dark)").matches,
  );
  const generation = useRef(0);
  const finishHeading = useRef<HTMLHeadingElement>(null);
  const reviewHeading = useRef<HTMLHeadingElement>(null);
  const origin = status.origin ?? defaultAccountOrigin;
  const reviewing =
    !showChoices &&
    !!status.account &&
    !!planIntent &&
    planIntent.mode !== "local";
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
        setPlanIntent(savedSetup.planIntent);
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
    let current = true;
    setCatalog(undefined);
    if (status.configured)
      void accountRpc({ type: "SETUP_PLANS" })
        .then((raw) => {
          if (current) setCatalog(setupPlansSchema.parse(raw).catalog);
        })
        .catch(() => {});
    return () => {
      current = false;
    };
  }, [status.configured, status.origin, status.account?.id]);
  useEffect(() => {
    if (complete) finishHeading.current?.focus();
    else if (reviewing && !introduction) reviewHeading.current?.focus();
  }, [complete, reviewing, introduction]);
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
        setPlanIntent({ mode: "local" });
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
    if (status.account && planIntent && planIntent.mode !== "local") {
      setIntroduction(false);
      setShowChoices(false);
      return;
    }
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
        if (!planIntent || planIntent.mode === "local") {
          setupStateSchema.parse(
            await accountRpc({ type: "SETUP_COMPLETE", choice: "account" }),
          );
          if (generation.current === expected) setComplete(true);
        } else setIntroduction(false);
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
  const choosePlan = async (
    intent: NonNullable<ServiceAuthIntent["planIntent"]>,
  ) => {
    const expected = ++generation.current;
    setBusy(true);
    setError("");
    setConsent(false);
    setImages(false);
    try {
      const next = setupStateSchema.parse(
        await accountRpc({ type: "SETUP_SELECT", planIntent: intent }),
      );
      if (generation.current === expected) {
        setPlanIntent(next.planIntent);
        setComplete(false);
        setIntroduction(false);
        setShowChoices(false);
      }
    } catch {
      if (generation.current === expected)
        setError(
          "Your plan choice could not be saved. Local guidance remains available.",
        );
    } finally {
      if (generation.current === expected) setBusy(false);
    }
  };
  const activate = () => {
    if (!origin || !consent || busy) return;
    const expected = ++generation.current;
    setBusy(true);
    setError("");
    // Keep native data/host permission in this original user gesture.
    let access: Promise<boolean>;
    try {
      access = requestBackendAccess(origin);
    } catch {
      setBusy(false);
      setError("Review the account service origin before continuing.");
      return;
    }
    void access
      .then(async (allowed) => {
        if (generation.current !== expected) return;
        if (!allowed) throw Error("Transmission access declined.");
        setupStateSchema.parse(
          await accountRpc({ type: "SETUP_ACTIVATE", images }),
        );
        if (generation.current === expected) setComplete(true);
      })
      .catch(() => {
        if (generation.current === expected)
          setError(
            "Free Cloud could not be enabled. Review your account and allowance, try again explicitly, or use Tholi locally.",
          );
      })
      .finally(() => {
        if (generation.current === expected) setBusy(false);
      });
  };
  const free = catalog?.plans.find((plan) => plan.mode === "free-cloud");
  const paid = catalog?.plans.filter((plan) => plan.mode === "paid") ?? [];
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
      {planIntent && planIntent.mode !== "local" && !complete && (
        <p role="status">
          Selected:{" "}
          {planIntent.mode === "free-cloud" ? "Free Cloud" : "paid cloud"}.
          Sign-in alone does not enable processing. Review availability and
          consent before continuing.
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
              ready.{" "}
              {planIntent?.mode === "free-cloud"
                ? "You explicitly enabled the connected fake development service. Local routes have not been uploaded. You can return to Local in Account settings."
                : "Your account choice does not enable cloud processing or upload local data."}
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
                  setIntroduction(false);
                  setShowChoices(true);
                }}
              >
                Review guidance options
              </button>
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
        ) : reviewing && !introduction ? (
          <section
            className="welcome-complete welcome-plan-review"
            aria-labelledby="plan-review-title"
          >
            <p className="welcome-eyebrow">YOUR CHOICE, CONFIRMED</p>
            <h1 id="plan-review-title" ref={reviewHeading} tabIndex={-1}>
              Review your connected guidance.
            </h1>
            {planIntent?.mode === "paid" ? (
              <p>
                Your paid plan choice is saved. Checkout, prices and paid
                activation are not enabled. No payment has been collected and no
                paid entitlement has been granted.
              </p>
            ) : (
              <>
                <p>
                  Free Cloud requires a signed-in account and a server-confirmed
                  allowance. Development credits have strict request and token
                  limits. No checkout is required.
                </p>
                {free?.developmentAllowance && (
                  <p>
                    {free.developmentAllowance.amount} development credits per{" "}
                    {new Intl.NumberFormat().format(
                      free.developmentAllowance.periodSeconds / 3600,
                    )}{" "}
                    hours. Unused credits expire without rollover. Limits:{" "}
                    {free.developmentAllowance.caps.requestsPerPeriod}{" "}
                    generations per period,{" "}
                    {free.developmentAllowance.caps.requestsPerMinute} per
                    minute and{" "}
                    {free.developmentAllowance.caps.maxDecisionsPerJourney} per
                    journey. The fake model has a zero provider-cost allowance.
                    These are development limits, not commercial prices.
                  </p>
                )}
                <p>
                  {free?.availability.available &&
                  catalog?.environment === "development"
                    ? "This development service uses the fake model. It does not call Gemini or another external AI provider."
                    : "Free Cloud is unavailable in this deployment. Production allowances and live managed guidance remain gated."}
                </p>
                <fieldset disabled={busy} className="welcome-consent">
                  <legend>Choose what leaves this browser</legend>
                  <label>
                    <input
                      type="checkbox"
                      checked={consent}
                      onChange={(event) => {
                        setConsent(event.target.checked);
                        if (!event.target.checked) setImages(false);
                      }}
                    />
                    Allow sanitized page context for explicit guidance requests
                    to the connected service
                  </label>
                  <label>
                    <input
                      type="checkbox"
                      checked={images}
                      disabled={!consent}
                      onChange={(event) => setImages(event.target.checked)}
                    />
                    Also allow temporary masked images
                  </label>
                  <p>
                    This setup does not import local routes or change your
                    synchronization or private learning preferences. Review
                    existing choices in Account settings. You can explicitly
                    import saved data later in your website account workspace.
                  </p>
                </fieldset>
                <button
                  className="primary"
                  disabled={
                    busy ||
                    !consent ||
                    !free?.availability.available ||
                    catalog?.environment !== "development"
                  }
                  onClick={activate}
                >
                  Confirm Free Cloud development
                </button>
              </>
            )}
            <div className="welcome-actions">
              {planIntent?.mode === "paid" && (
                <button
                  disabled={busy}
                  onClick={() => void choosePlan({ mode: "free-cloud" })}
                >
                  Choose Free Cloud
                </button>
              )}
              {localButton}
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
          <>
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
                  An account is optional. Signing up does not upload local data
                  or enable cloud processing.
                </p>
              </div>
              <IntroductionRecording step={2} />
            </section>
            <section
              className="welcome-plans"
              aria-labelledby="welcome-plans-title"
            >
              <h2 id="welcome-plans-title">Choose where guidance runs.</h2>
              <p>
                You can create an account without choosing cloud processing.
                These choices never upload your existing local data.
              </p>
              <div>
                <article>
                  <h3>Local</h3>
                  <p>
                    Free, no account required. Your data stays on this device.
                  </p>
                  <button onClick={() => void local()}>Keep Local</button>
                </article>
                <article>
                  <h3>Free Cloud</h3>
                  <p>
                    Sign-in, strict credits and separate transmission consent.{" "}
                    {free?.availability.available
                      ? "Available for fake-model development only."
                      : "Live cloud guidance is not available yet."}
                  </p>
                  <button
                    disabled={!ready || busy}
                    onClick={() => void choosePlan({ mode: "free-cloud" })}
                  >
                    Choose Free Cloud
                  </button>
                </article>
                <article>
                  <h3>Paid cloud</h3>
                  <p>
                    Checkout and payment collection are not enabled. No prices
                    or paid allowances have been published.
                  </p>
                  {paid.map((plan) => (
                    <button
                      key={plan.id}
                      disabled={!ready || busy}
                      onClick={() =>
                        void choosePlan({
                          mode: "paid",
                          planId: plan.id,
                          planVersion: plan.version,
                        })
                      }
                    >
                      Review {plan.name}
                    </button>
                  ))}
                  {!paid.length && (
                    <p>
                      Connect an account service to review its catalog. Local
                      guidance remains available.
                    </p>
                  )}
                </article>
              </div>
            </section>
          </>
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
