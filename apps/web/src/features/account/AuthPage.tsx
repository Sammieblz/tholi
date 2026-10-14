import "./account.css";
import { useState } from "react";
import { SiteLink, useRouter } from "../../app/router";
import { useAccount } from "./session";
export function AuthPage({ signup }: { signup: boolean }) {
  const { go } = useRouter(),
    { save } = useAccount();
  const [name, setName] = useState(""),
    [email, setEmail] = useState(""),
    [password, setPassword] = useState("");
  const [error, setError] = useState(""),
    [loading, setLoading] = useState(false);
  const auth = async () => {
    if (loading) return;
    setError("");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
      return setError("Enter an email address, such as you@example.com.");
    if (password.length < 8)
      return setError("Use at least 8 characters for the demo password.");
    setLoading(true);
    try {
      await new Promise((resolve) => setTimeout(resolve, 180));
      save({
        name: name.trim() || email.split("@")[0],
        email,
        onboarded: !signup,
      });
      setPassword("");
      go(signup ? "/onboarding" : "/welcome");
    } catch {
      setError(
        "The demo session could not be saved. Allow browser session storage or continue without an account.",
      );
      setLoading(false);
    }
  };
  return (
    <section className="auth-layout">
      <aside className="auth-aside" aria-hidden="true">
        <span className="route-glyph">
          <i />
          <i />
          <i />
        </span>
        <p>
          A little less searching.
          <br />A clear next step.
        </p>
        <span>THOLI / YOUR GUIDE THROUGH THE WEB</span>
      </aside>
      <div className="auth-card">
        <p className="eyebrow">DEMO ACCOUNT</p>
        <h1>{signup ? "A clear place to start." : "Welcome back."}</h1>
        <p className="small">
          This is a local mock flow. Use example details, not real credentials.
          No account is created and nothing is sent.
        </p>
        <form
          noValidate
          onSubmit={(e) => {
            e.preventDefault();
            void auth();
          }}
          aria-busy={loading}
        >
          {signup && (
            <label>
              Name
              <input
                autoComplete="off"
                value={name}
                onChange={(e) => setName(e.target.value)}
                maxLength={80}
              />
            </label>
          )}
          <label>
            Email
            <input
              type="email"
              autoComplete="off"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
            />
          </label>
          <label>
            Demo password
            <input
              type="password"
              autoComplete="off"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
            />
          </label>
          {error && (
            <p role="alert" className="auth-error">
              {error}
            </p>
          )}
          <button className="primary" disabled={loading}>
            {loading && <span className="tholi-spinner" aria-hidden="true" />}
            {loading
              ? "Opening your demo account"
              : signup
                ? "Create demo account"
                : "Sign in to demo"}
          </button>
        </form>
        <p>
          <SiteLink to={signup ? "/signin" : "/signup"}>
            {signup
              ? "Already exploring? Sign in to the demo"
              : "New here? Create a demo account"}
          </SiteLink>
        </p>
        <SiteLink to="/download">Get the extension without an account</SiteLink>
      </div>
    </section>
  );
}
