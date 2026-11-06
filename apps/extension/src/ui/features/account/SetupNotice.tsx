import { useEffect, useState } from "react";
import { setupStateSchema } from "../../../platform/setup-contract";
import { accountRpc } from "./account-client";

/** An optional entry point, never a gate on Local guidance. */
export function SetupNotice() {
  const [incomplete, setIncomplete] = useState(false);
  const [error, setError] = useState("");
  useEffect(() => {
    let current = true;
    const read = () => {
      void accountRpc({ type: "SETUP_STATUS" })
        .then((raw) => {
          if (current) setIncomplete(!setupStateSchema.parse(raw).complete);
        })
        .catch(() => {});
    };
    read();
    addEventListener("focus", read);
    addEventListener("tholi-setup-change", read);
    document.addEventListener("visibilitychange", read);
    return () => {
      current = false;
      removeEventListener("focus", read);
      removeEventListener("tholi-setup-change", read);
      document.removeEventListener("visibilitychange", read);
    };
  }, []);
  if (!incomplete) return null;
  return (
    <section className="tholi-setup-notice" aria-label="Tholi setup">
      <p>Your account is optional. Local guidance is available now.</p>
      <button
        onClick={() =>
          void accountRpc({ type: "SETUP_OPEN" }).catch(() =>
            setError(
              "Setup could not be opened. Local guidance remains available.",
            ),
          )
        }
      >
        Finish setup
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  );
}
