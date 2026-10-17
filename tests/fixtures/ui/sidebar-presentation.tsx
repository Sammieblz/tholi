import { useState } from "react";
import { createRoot } from "react-dom/client";
import { GuidanceApp } from "../../../packages/ui/guidance";
import type { GuidanceProps } from "../../../packages/ui/guidance/types";

type Phase = "clarification" | "guiding" | "review" | "authentication";
declare global {
  interface Window {
    sidebarFixture: {
      phase: (value: Phase) => void;
      long: (value: boolean) => void;
    };
  }
}

/** Presentation reproduction only, not website outcome evidence. */
function Fixture() {
  const [phase, setPhase] = useState<Phase>("clarification");
  const [long, setLong] = useState(false);
  const [draft, setDraft] = useState("Find comments");
  const [preferences, setPreferences] = useState<GuidanceProps["preferences"]>({
    mode: "guide",
    surface: "sidebar",
    advanced: false,
  });
  window.sidebarFixture = { phase: setPhase, long: setLong };
  return (
    <GuidanceApp
      logo="/media/tholi_brand_logo.png"
      preferences={preferences}
      onPreferences={setPreferences}
      draft={draft}
      onDraft={setDraft}
      onSubmit={() => {}}
      active
      paused={false}
      pending={false}
      onCommand={() => {}}
      presentation={{
        phase,
        stepId: `sidebar:${phase}`,
        title:
          phase === "clarification" ? "One quick question" : "Your next step",
        instruction:
          phase === "clarification"
            ? "Several scanned controls fit this request."
            : phase === "review"
              ? "Review the website action before continuing."
              : phase === "authentication"
                ? "Sign in on the website. Your destination is retained."
                : "Open the highlighted Comments control. ".repeat(
                    long ? 35 : 1,
                  ),
        destination: "Find comments",
        warning: phase !== "guiding",
        busy: false,
      }}
      messages={[
        {
          id: "first",
          role: "guide",
          text: "Your destination remains Find comments.",
          at: 1,
        },
      ]}
      progress={{
        journeyId: "sidebar",
        verified: 0,
        recentLabels: [],
        next: [],
        complete: false,
        arrived: false,
      }}
      attentionRequired={phase !== "guiding"}
      attention={
        phase === "clarification" ? (
          <section className="tholi-clarification" aria-label="Clarification">
            <h2>Which “comments” do you mean?</h2>
            {[
              "Comments · YouTube Video Player",
              "Sort comments",
              "Top Show featured comments Newest Show recent comments, including potential spam",
            ].map((label) => (
              <button key={label} onClick={() => setPhase("guiding")}>
                {label}
              </button>
            ))}
          </section>
        ) : phase === "review" ? (
          <section>
            <h2>Review before continuing</h2>
            <p>
              You make the website interaction. Tholi checks fresh evidence.
            </p>
          </section>
        ) : phase === "authentication" ? (
          <section>
            <h2>Continue on the website</h2>
            <p>Do not enter credentials in Tholi.</p>
          </section>
        ) : undefined
      }
    />
  );
}
document.body.innerHTML = '<div id="sidebar-fixture-root"></div>';
createRoot(document.getElementById("sidebar-fixture-root")!).render(
  <Fixture />,
);
