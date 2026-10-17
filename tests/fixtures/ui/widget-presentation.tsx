import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GuidanceApp } from "../../../packages/ui/guidance";
import type { GuidanceProps } from "../../../packages/ui/guidance/types";

declare global {
  interface Window {
    widgetFixture: {
      blocking: (value: boolean) => void;
      phase: (phase: GuidanceProps["presentation"]["phase"]) => void;
      expansions: number;
    };
  }
}

/** Isolated presentation adapter. It supplies no website outcome evidence. */
function Fixture() {
  const [draft, setDraft] = useState("Deploy my website");
  const [preferences, setPreferences] = useState<GuidanceProps["preferences"]>({
    mode: "guide",
    surface: "widget",
    advanced: false,
  });
  const [blocking, setBlocking] = useState(false);
  const [phase, setPhase] =
    useState<GuidanceProps["presentation"]["phase"]>("guiding");
  window.widgetFixture = {
    blocking: setBlocking,
    phase: setPhase,
    expansions: window.widgetFixture?.expansions || 0,
  };
  return (
    <GuidanceApp
      widget
      logo="/media/tholi_brand_logo.png"
      preferences={preferences}
      onPreferences={setPreferences}
      draft={draft}
      onDraft={setDraft}
      onSubmit={() => {}}
      active={phase === "guiding"}
      paused={phase === "paused"}
      pending={false}
      presentation={{
        phase: blocking ? "clarification" : phase,
        stepId: `fixture:${blocking}:${phase}`,
        title: blocking
          ? "One quick question"
          : phase === "idle"
            ? "Stopped"
            : "Your next step",
        instruction:
          phase === "idle"
            ? "Navigation stopped."
            : "Open the Account menu to continue.",
        destination: "Deploy a website",
        warning: blocking,
        busy: false,
      }}
      messages={[
        {
          id: "history",
          role: "guide",
          text: "Earlier guidance remains in the conversation.",
          at: 1,
        },
      ]}
      attentionRequired={blocking}
      attention={
        blocking ? (
          <section>
            <h2>Which account should we use?</h2>
            <label>
              Account name
              <input aria-label="Account name" defaultValue="" />
            </label>
            <button onClick={() => setBlocking(false)}>
              Continue with account
            </button>
          </section>
        ) : undefined
      }
      onExpand={() => {
        window.widgetFixture.expansions++;
      }}
      onCommand={(command) =>
        setPhase(
          command === "STOP"
            ? "idle"
            : command === "PAUSE"
              ? "paused"
              : "guiding",
        )
      }
      details={<p>The route is checked again at each step.</p>}
      progress={{
        journeyId: "fixture",
        verified: 1,
        recentLabels: ["Open workspace"],
        next: [{ id: "menu", label: "Account menu", evidence: "live" }],
        complete: false,
        arrived: false,
      }}
    />
  );
}
document.documentElement.classList.add("tholi-widget-document");
document.body.innerHTML =
  '<div id="widget-fixture-root" style="height:100%"></div>';
createRoot(document.getElementById("widget-fixture-root")!).render(<Fixture />);
