import "./account.css";
import { useRef, useState } from "react";
import { ShieldCheck } from "iconoir-react";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";
import { SiteLink, useRouter } from "../../app/router";
import { useAccount } from "./session";
export function AuthPage({ signup }: { signup: boolean }) {
  const { go } = useRouter(),
    { save } = useAccount();
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [errors, setErrors] = useState<{
    email?: string;
    password?: string;
    session?: string;
  }>({});
  const [loading, setLoading] = useState(false),
    [showPassword, setShowPassword] = useState(false);
  const emailInput = useRef<HTMLInputElement>(null),
    passwordInput = useRef<HTMLInputElement>(null);
  const auth = async () => {
    if (loading) return;
    const next: typeof errors = {};
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim()))
      next.email = "Enter an email address, such as you@example.com.";
    if (password.length < 8)
      next.password = "Use at least 8 characters for the demo password.";
    setErrors(next);
    if (next.email || next.password) {
      (next.email ? emailInput : passwordInput).current?.focus();
      return;
    }
    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 180));
      save({
        name: name.trim() || email.trim().split("@")[0],
        email: email.trim(),
        onboarded: !signup,
      });
      setPassword("");
      go(signup ? "/onboarding" : "/welcome");
    } catch {
      setErrors({
        session:
          "The demo session could not be saved. Allow browser session storage or get the extension without an account.",
      });
      setLoading(false);
    }
  };
  return (
    <section className="auth-layout">
      <aside className="auth-aside" aria-hidden="true">
        <Wayfinder state={loading ? "planning" : "idle"} />
        <div>
          <span className="auth-aside-label">A LITTLE DIRECTION</span>
          <p>
            Less “where is it?”
            <br />
            More “here we go.”
          </p>
          <span>
            Keep your destination.
            <br />
            Find your next step.
          </span>
        </div>
        <span>THOLI / FIND YOUR WAY FORWARD</span>
      </aside>
      <div className="auth-card">
        <p className="eyebrow">LOCAL DEMO ACCOUNT</p>
        <h1>{signup ? "A clear place to start." : "Welcome back."}</h1>
        <p className="small" id="demo-account-note">
          Explore a mock account using example details. No real account is
          created and nothing is sent.
        </p>
        <form
          noValidate
          onSubmit={(event) => {
            event.preventDefault();
            void auth();
          }}
          aria-busy={loading}
          aria-describedby="demo-account-note"
        >
          {signup && (
            <label htmlFor="demo-name">
              Name{" "}
              <span className="field-optional" aria-hidden="true">
                optional
              </span>
              <input
                id="demo-name"
                aria-label="Name"
                autoComplete="off"
                value={name}
                onChange={(event) => setName(event.target.value)}
                maxLength={80}
                placeholder="How should we greet you?"
              />
            </label>
          )}
          <label htmlFor="demo-email">
            Email
            <input
              ref={emailInput}
              id="demo-email"
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              aria-invalid={!!errors.email}
              aria-describedby={errors.email ? "demo-email-error" : undefined}
            />
          </label>
          {errors.email && (
            <p className="field-error" id="demo-email-error" role="alert">
              {errors.email}
            </p>
          )}
          <label htmlFor="demo-password">Demo password</label>
          <span className="password-field">
            <input
              ref={passwordInput}
              id="demo-password"
              type={showPassword ? "text" : "password"}
              autoComplete="off"
              required
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              minLength={8}
              aria-invalid={!!errors.password}
              aria-describedby={
                errors.password
                  ? "demo-password-help demo-password-error"
                  : "demo-password-help"
              }
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-pressed={showPassword}
              aria-label={
                showPassword ? "Hide demo password" : "Show demo password"
              }
            >
              {showPassword ? "Hide" : "Show"}
            </button>
          </span>
          <p id="demo-password-help" className="field-hint">
            Use any example with 8 or more characters. It is never saved.
          </p>
          {errors.password && (
            <p className="field-error" id="demo-password-error" role="alert">
              {errors.password}
            </p>
          )}
          {errors.session && (
            <p className="auth-error" role="alert">
              {errors.session}
            </p>
          )}
          <button className="primary" disabled={loading}>
            {loading ? (
              <>
                <Wayfinder state="planning" />
                Opening your local preview
              </>
            ) : (
              <>{signup ? "Create demo account" : "Sign in to demo"}</>
            )}
          </button>
        </form>
        <p className="auth-switch">
          <SiteLink to={signup ? "/signin" : "/signup"}>
            {signup
              ? "Already exploring? Sign in to the demo"
              : "New here? Create a demo account"}
          </SiteLink>
        </p>
        <div className="auth-independent">
          <ShieldCheck width={17} aria-hidden="true" />
          <SiteLink to="/download">
            Get the extension without an account
          </SiteLink>
        </div>
      </div>
    </section>
  );
}
