import { useEffect, useState, type ReactNode } from "react";
import { api } from "../../platform/api";

/** Registration cannot create a grant; recovery asks the existing document owner again. */
export function WidgetRegistration({ children }: { children: ReactNode }) {
  const [state, setState] = useState<"connecting" | "ready" | "error">(
    "connecting",
  );
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    void api.runtime.sendMessage({ type: "UI_REGISTER" }).then(
      (result) => {
        if (current)
          setState(result?.ok === true && !result.error ? "ready" : "error");
      },
      () => {
        if (current) setState("error");
      },
    );
    return () => {
      current = false;
    };
  }, [attempt]);
  if (state === "ready") return children;
  return (
    <main
      className="tholi-app tholi-widget-app"
      aria-busy={state === "connecting"}
    >
      <h1 className="sr-only">Tholi guidance</h1>
      <div className="tholi-workspace">
        {state === "connecting" ? (
          <p role="status">Connecting Tholi to this website.</p>
        ) : (
          <p role="alert">
            Tholi could not connect to this website (UI_REGISTRATION_FAILED).
            Try again, or open Tholi from the toolbar to renew website access.
          </p>
        )}
        <button
          type="button"
          className="primary"
          disabled={state === "connecting"}
          onClick={() => {
            setState("connecting");
            setAttempt((value) => value + 1);
          }}
        >
          Try again
        </button>
      </div>
    </main>
  );
}
