import "./account.css";
import { ShieldCheck } from "iconoir-react";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";
import { SiteLink, useRouter } from "../../app/router";
import { useAccount } from "./session";

export function AuthPage({ signup }: { signup: boolean }) {
  const account = useAccount();
  const { search } = useRouter();
  const action = signup ? "signup" : "signin";
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
        <h1>{signup ? "A clear place to start." : "Welcome back."}</h1>
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
              Continue to Tholi's identity provider to{" "}
              {signup ? "create your account" : "sign in"}. Your password stays
              with the identity provider.
            </p>
            <a
              className="primary web-primary"
              href={account.authorizationUrl(action)}
            >
              Continue to {signup ? "sign up" : "sign in"}
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
            <p className="auth-switch">
              <SiteLink to={signup ? "/signin" : "/signup"}>
                {signup
                  ? "Already have an account? Sign in"
                  : "New here? Sign up"}
              </SiteLink>
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
        <p className="auth-legal small">
          Read our <SiteLink to="/privacy">privacy notice</SiteLink> and{" "}
          <SiteLink to="/terms">terms</SiteLink>. Cloud guidance, paid plans and
          credits are not available in this release.
        </p>
        <div className="auth-independent">
          <ShieldCheck width={18} aria-hidden="true" />
          <SiteLink to="/download">
            Use local guidance without an account
          </SiteLink>
        </div>
      </div>
    </section>
  );
}
