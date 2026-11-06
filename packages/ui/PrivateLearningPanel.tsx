import { useId } from "react";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { NavigationKnowledgeSiteSettings } from "../navigation-core/contracts-navigation-knowledge";
import "./styles/private-learning.css";

export interface PrivateLearningPanelProps {
  origin: string;
  settings?: NavigationKnowledgeSiteSettings;
  busy: boolean;
  error?: string;
  notice?: string;
  onSave(choice: { collect: boolean; use: boolean }): void;
  onRefresh(): void;
  onForget(): void;
}

/** Presentation only. Checked values always come from acknowledged service settings. */
export function PrivateLearningPanel({
  origin,
  settings,
  busy,
  error,
  notice,
  onSave,
  onRefresh,
  onForget,
}: PrivateLearningPanelProps) {
  const id = useId();
  return (
    <section
      className="tholi-private-learning"
      aria-label="Private website learning"
      aria-busy={busy}
    >
      <fieldset
        disabled={busy || !settings}
        aria-describedby={`${id}-help${error ? ` ${id}-error` : ""}`}
      >
        <legend>Private website learning</legend>
        <p className="tholi-private-learning-origin">{origin}</p>
        <p id={`${id}-help`}>
          Learning starts off. Save future sanitized website knowledge to your
          cloud account, or use knowledge you already saved. Each change is
          saved immediately.
        </p>
        <label className="tholi-private-learning-choice">
          <input
            type="checkbox"
            checked={settings?.collect ?? false}
            onChange={(event) =>
              onSave({
                collect: event.target.checked,
                use: settings?.use ?? false,
              })
            }
          />
          <span>Save future website knowledge to my cloud account</span>
        </label>
        <label className="tholi-private-learning-choice">
          <input
            type="checkbox"
            checked={settings?.use ?? false}
            onChange={(event) =>
              onSave({
                collect: settings?.collect ?? false,
                use: event.target.checked,
              })
            }
          />
          <span>Use my saved cloud knowledge for this website</span>
        </label>
      </fieldset>
      <p>
        Existing local memory is not uploaded automatically. AI provider
        processing and masked image consent are separate choices.
      </p>
      <p role="status" aria-live="polite" aria-atomic="true">
        {busy
          ? "Checking private website learning."
          : notice ||
            (!settings
              ? "Refresh to review this website's current settings."
              : "Settings confirmed for this website.")}
      </p>
      {error && (
        <p
          id={`${id}-error`}
          className="tholi-private-learning-error"
          role="alert"
        >
          {error}
        </p>
      )}
      <div className="tholi-private-learning-actions">
        <button type="button" disabled={busy} onClick={onRefresh}>
          Refresh learning settings
        </button>
        <AlertDialog.Root>
          <AlertDialog.Trigger type="button" disabled={busy || !settings}>
            Forget cloud knowledge
          </AlertDialog.Trigger>
          <AlertDialog.Portal>
            <AlertDialog.Backdrop className="tholi-private-learning-backdrop" />
            <AlertDialog.Popup className="tholi-private-learning-dialog">
              <AlertDialog.Title>
                Forget this website's cloud knowledge?
              </AlertDialog.Title>
              <AlertDialog.Description>
                Pause collection and reuse, then delete this website's private
                cloud knowledge in bounded batches. Local memory, saved routes
                and conversation excerpts are unchanged.
              </AlertDialog.Description>
              <p className="tholi-private-learning-origin">{origin}</p>
              <div className="tholi-private-learning-actions">
                <AlertDialog.Close type="button">Cancel</AlertDialog.Close>
                <AlertDialog.Close
                  type="button"
                  disabled={busy}
                  onClick={onForget}
                >
                  Forget cloud knowledge
                </AlertDialog.Close>
              </div>
            </AlertDialog.Popup>
          </AlertDialog.Portal>
        </AlertDialog.Root>
      </div>
    </section>
  );
}
