import "./account.css";
import { useState } from "react";
import { SiteLink, useRouter } from "../../app/router";
import { Demo } from "../demo/Demo";
import { useAccount } from "./session";
export function WelcomePage() {
  const { account, signOut } = useAccount(),
    { go } = useRouter();
  const [error, setError] = useState("");
  return (
    <section className="welcome">
      <p className="eyebrow">DEMO WELCOME AREA</p>
      <h1>{account ? `Hello, ${account.name}.` : "Find your first step."}</h1>
      <p>
        Your destination is the starting point. No route history or extension
        data is connected to this demo account.
      </p>
      <div className="welcome-actions">
        <SiteLink to="/download" className="web-primary">
          Install Tholi
        </SiteLink>
        <button onClick={() => go("/onboarding")}>Replay onboarding</button>
        {account && (
          <button
            onClick={() => {
              try {
                signOut();
                go("/");
              } catch {
                setError(
                  "The demo session could not be cleared. Close this tab to end the session.",
                );
              }
            }}
          >
            Sign out
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <Demo />
    </section>
  );
}
