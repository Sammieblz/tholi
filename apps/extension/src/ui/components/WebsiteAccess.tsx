import { useId } from "react";

/** One control shared by first-use recovery and the existing settings surface. */
export function WebsiteAccess({
  granted,
  busy,
  widget = false,
  onEnable,
}: {
  granted?: boolean;
  busy: boolean;
  widget?: boolean;
  onEnable: () => void;
}) {
  const description = useId();
  return (
    <section className="tholi-website-access" aria-label="Website access">
      <h2>Website access</h2>
      <p id={description} className="small">
        {granted === undefined
          ? "Checking your browser's website access."
          : granted
            ? "Access across websites is enabled. Manage or restrict access in your browser's extension settings."
            : "Enable access across websites so Tholi can read page controls and display guidance without asking for each new site."}
      </p>
      {granted === false && (
        <>
          <p className="small">
            This does not enable cloud processing or private learning. You can
            restrict access in your browser's extension settings.
          </p>
          {widget ? (
            <p className="small">
              Open Tholi from your browser toolbar to enable website access.
              Your task is retained.
            </p>
          ) : (
            <button
              type="button"
              className="primary"
              disabled={busy}
              aria-describedby={description}
              onClick={onEnable}
            >
              Enable website access
            </button>
          )}
        </>
      )}
    </section>
  );
}
