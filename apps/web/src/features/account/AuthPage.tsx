import "./account.css";
import { useEffect } from "react";
import {
  Introduction,
  introductionStep,
} from "../../../../../packages/ui/onboarding";
import { ShieldCheck } from "iconoir-react";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";
import { SiteLink, useRouter } from "../../app/router";
import { useAccount } from "./session";
import {
  readPlanIntent,
  planIntentQuery,
  rememberPlanIntent,
  pendingPlanIntent,
  planAccountPath,
} from "./plan-intent";

export function AuthPage({ signup }: { signup: boolean }) {
  const account = useAccount();
  const { search, go } = useRouter();
  const rawStep = new URLSearchParams(search).get("step");
  const step = introductionStep(rawStep);
  const intent = readPlanIntent(search) ?? pendingPlanIntent();
  const intentQuery = planIntentQuery(intent);
  const authPath = (path: string) =>
    `${path}${intentQuery ? `${path.includes("?") ? "&" : "?"}${intentQuery}` : ""}`;
  useEffect(() => {
    if (account.session) {
      rememberPlanIntent(undefined);
      go(planAccountPath(intent), { replace: true });
    }
  }, [account.session, intentQuery, go]);
  useEffect(() => {
    if (signup && rawStep !== null && !["1", "2", "3"].includes(rawStep))
      go(authPath("/signup?step=1"), { replace: true });
  }, [signup, rawStep, intentQuery, go]);
  if (signup)
    return (
      <Introduction
        step={step}
        onStep={(next) => go(authPath(`/signup?step=${next}`))}
        register={
          account.configured && !account.loading && !account.session ? (
            <a
              className={step === 3 ? "tholi-introduction-primary" : undefined}
              href={account.authorizationUrl("signup")}
              onClick={() => rememberPlanIntent(intent)}
            >
              {step === 3 ? "Create your account" : "Skip introduction"}
            </a>
          ) : null
        }
        local={
          <SiteLink
            to="/download"
            onClick={() => rememberPlanIntent(undefined)}
          >
            Use Tholi locally
          </SiteLink>
        }
        signIn={
          <SiteLink to={authPath("/signin")}>
            Already have an account? Sign in
          </SiteLink>
        }
        notice={
          <>
            {account.loading && (
              <p role="status">Checking your account session.</p>
            )}
            {!account.configured && (
              <p className="small" role="status">
                Accounts are not available on this website yet. You can install
                and use Tholi locally without an account.
              </p>
            )}
            {account.error && (
              <p className="auth-error" role="alert">
                {account.error}
              </p>
            )}
            <p className="small">
              Creating an account does not enable cloud processing. Read our{" "}
              <SiteLink to="/privacy">privacy notice</SiteLink> and{" "}
              <SiteLink to="/terms">terms</SiteLink>.
            </p>
          </>
        }
      />
    );
  return (
    <section className="auth-layout" aria-busy={account.loading}>
      <aside className="auth-aside" aria-hidden="true">
        <Wayfinder state="idle" />
        <div>
          <span className="auth-aside-label">A LITTLE DIRECTION</span>
          <p>
            Find your way.
            <br />
            Keep control.
          </p>
          <span>
            Your local guidance stays yours.
            <br />
            An account is always optional.
          </span>
        </div>
        <span>THOLI / FIND YOUR WAY FORWARD</span>
      </aside>
      <div className="auth-card">
        <p className="eyebrow">YOUR THOLI ACCOUNT</p>
        <h1>Welcome back.</h1>
        {new URLSearchParams(search).has("error") && (
          <p className="auth-error" role="alert">
            Sign-in was not completed. Try again when you are ready.
          </p>
        )}
        {account.loading ? (
          <p role="status">Checking your account session.</p>
        ) : account.session ? (
          <>
            <p>You are signed in. Review your sessions and account security.</p>
            <SiteLink className="web-primary" to="/account">
              Open your account
            </SiteLink>
          </>
        ) : account.configured ? (
          <>
            <p>
              Continue to Tholi's identity provider to sign in. Your password
              stays with the identity provider.
            </p>
            <a
              className="primary web-primary"
              href={account.authorizationUrl("signin")}
              onClick={() => rememberPlanIntent(intent)}
            >
              Continue to sign in
            </a>
            <p className="small">
              Secure session cookies are essential for accounts. Optional cookie
              choices do not prevent sign-in.
            </p>
            <p>
              <a href={account.authorizationUrl("recover")}>
                Recover account access
              </a>
            </p>
          </>
        ) : (
          <>
            <p>
              Accounts are not available on this website yet. You can install
              and use Tholi locally without an account.
            </p>
            <SiteLink className="web-primary" to="/download">
              Get Tholi
            </SiteLink>
          </>
        )}
        {account.error && (
          <p className="auth-error" role="alert">
            {account.error}
          </p>
        )}
        <p className="auth-switch">
          <SiteLink to={authPath("/signup")}>New here? Sign up</SiteLink>
        </p>
        <p className="auth-legal small">
          Read our <SiteLink to="/privacy">privacy notice</SiteLink> and{" "}
          <SiteLink to="/terms">terms</SiteLink>. Account features depend on the
          connected service. Paid plans are not available yet.
        </p>
        <div className="auth-independent">
          <ShieldCheck width={18} aria-hidden="true" />
          <SiteLink
            to="/download"
            onClick={() => rememberPlanIntent(undefined)}
          >
            Use Tholi locally
          </SiteLink>
        </div>
      </div>
    </section>
  );
}
