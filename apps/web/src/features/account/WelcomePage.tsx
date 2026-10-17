import { LogOut, Refresh } from "iconoir-react";
import { useState } from "react";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";
import { SiteLink, useRouter } from "../../app/router";
import { Demo } from "../demo/Demo";
import "./account.css";
import { useAccount } from "./session";
export function WelcomePage() {
  const { account, signOut } = useAccount(),
    { go } = useRouter();
  const [error, setError] = useState("");
  return (
    <section className="welcome">
      <p className="eyebrow">YOUR LOCAL PREVIEW</p>
      <div className="welcome-intro">
        <Wayfinder state="idle" />
        <h1>{account ? `Hello, ${account.name}.` : "Find your first step."}</h1>
      </div>
      <p>
        Make a little room for your guide. Install the extension, revisit setup,
        or try a destination in the safe practice website below. This demo
        account is not connected to extension data or route history.
      </p>
      <div className="welcome-actions">
        <SiteLink to="/download" className="web-primary">
          Install Tholi
        </SiteLink>
        <button onClick={() => go("/onboarding")}>
          <Refresh width={17} aria-hidden="true" />
          Replay onboarding
        </button>
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
            <LogOut width={17} aria-hidden="true" />
          </button>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <Demo />
    </section>
  );
}
