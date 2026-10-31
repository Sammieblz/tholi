import { useEffect, useState } from "react";
import { api } from "../../../platform/api";
import { requestServiceAuthAccess } from "../../../platform/service-auth-access";
import { requestBackendAccess } from "../../../platform/site-access";
import {
  serviceAuthStatusSchema,
  type ServiceAuthStatus,
  serviceInferenceStatusSchema,
} from "../../../platform/service-auth-contract";
import { identitySessionsSchema } from "../../../../../../packages/navigation-core/contracts-identity";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { z } from "zod";
import "./account-settings.css";

export function AccountSettings() {
  const [inference, setInference] = useState({ enabled: false, images: false });
  const [savedInference, setSavedInference] = useState({
    enabled: false,
    images: false,
  });
  const [status, setStatus] = useState<ServiceAuthStatus>({
    configured: false,
  });
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [sessions, setSessions] = useState<
    z.infer<typeof identitySessionsSchema>["items"]
  >([]);
  const [notice, setNotice] = useState("");
  const rpc = async (message: unknown) => {
    const result: unknown = await api.runtime.sendMessage(message);
    if (result && typeof result === "object" && "error" in result)
      throw new Error(
        "The account request could not be completed. Check your service origin and account permissions, then try again.",
      );
    return result;
  };
  const load = async () => {
    const result = serviceAuthStatusSchema.parse(
      await rpc({ type: "AUTH_STATUS" }),
    );
    setStatus(result);
    setOrigin(result.origin ?? "");
    if (!result.account) setSessions([]);
    const choices = result.account
      ? serviceInferenceStatusSchema.parse(
          await rpc({ type: "AUTH_INFERENCE_STATUS" }),
        )
      : { enabled: false, images: false };
    setInference({ enabled: choices.enabled, images: choices.images });
    setSavedInference({ enabled: choices.enabled, images: choices.images });
  };
  useEffect(() => {
    let active = true;
    void rpc({ type: "AUTH_STATUS" })
      .then(async (raw) => {
        if (active) {
          const next = serviceAuthStatusSchema.parse(raw);
          setStatus(next);
          setOrigin(next.origin ?? "");
          if (next.account) {
            const choices = serviceInferenceStatusSchema.parse(
              await rpc({ type: "AUTH_INFERENCE_STATUS" }),
            );
            if (active) {
              setInference({
                enabled: choices.enabled,
                images: choices.images,
              });
              setSavedInference({
                enabled: choices.enabled,
                images: choices.images,
              });
            }
          }
        }
      })
      .catch(() => {
        if (active)
          setError(
            "Your account connection could not be opened. Local guidance is still available.",
          );
      });
    return () => {
      active = false;
    };
  }, []);
  const act = async (
    operation: () => Promise<void | string>,
    message: string,
    retainAccount = false,
  ) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const completed = await operation();
      setNotice(completed ?? message);
    } catch (failure) {
      if (!retainAccount) {
        setSessions([]);
        setStatus({ configured: !!origin, origin: origin || undefined });
      }
      setError(
        failure instanceof Error
          ? failure.message
          : "The account request could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const save = () => {
    // The native permission request must stay in the original button gesture.
    let access: Promise<boolean>;
    try {
      access = requestServiceAuthAccess(origin);
    } catch {
      setError("Enter an HTTPS service origin or a loopback HTTP origin.");
      return;
    }
    void act(async () => {
      if (!(await access))
        throw new Error(
          "Account access was declined. Local guidance is still available.",
        );
      await rpc({ type: "AUTH_CONFIGURE", origin });
      setSessions([]);
      await load();
    }, "The account service origin was saved.");
  };
  const signIn = (action: "signin" | "signup") => {
    let access: Promise<boolean>;
    try {
      access = requestServiceAuthAccess(origin);
    } catch {
      setError("Save a valid account service origin first.");
      return;
    }
    void act(async () => {
      if (!(await access)) throw new Error("Account access was declined.");
      await rpc({ type: "AUTH_SIGN_IN", action });
      setSessions([]);
      await load();
    }, "Signed in to Tholi. Local guidance remains available.");
  };
  const saveInference = (choices = inference) => {
    // Native website/data permission must remain inside this original gesture.
    let access: Promise<boolean>;
    try {
      const reducing =
        savedInference.enabled &&
        (!choices.enabled || (savedInference.images && !choices.images));
      access =
        choices.enabled && !reducing
          ? requestBackendAccess(status.origin ?? "")
          : Promise.resolve(true);
    } catch {
      setError("Save a valid account service origin first.");
      return;
    }
    void act(
      async () => {
        if (!(await access))
          throw new Error("Inference transmission access was not granted.");
        try {
          const result = serviceInferenceStatusSchema.parse(
            await rpc({
              type: "AUTH_INFERENCE_CONFIGURE",
              profile: "fake",
              ...choices,
            }),
          );
          const next = { enabled: result.enabled, images: result.images };
          setInference(next);
          setSavedInference(next);
          if (!result.enabled && !result.serverConsentUpdated)
            return "Browser transmission is disabled. Service consent withdrawal could not be confirmed; review it when the account service is available.";
        } catch (failure) {
          // Enabling fails closed in the background. Read only the saved browser
          // choices so a failed save never leaves an enabled-looking control.
          const current = serviceInferenceStatusSchema.parse(
            await rpc({ type: "AUTH_INFERENCE_STATUS" }),
          );
          const next = { enabled: current.enabled, images: current.images };
          setInference(next);
          setSavedInference(next);
          if (!current.configured)
            setStatus({ configured: !!status.origin, origin: status.origin });
          throw failure;
        }
      },
      choices.enabled
        ? "Development inference choices saved. Automatic journey integration is not enabled."
        : "Browser transmission disabled and service consent withdrawal confirmed.",
      true,
    );
  };
  return (
    <fieldset className="tholi-account-settings" aria-busy={busy}>
      <legend>Optional Tholi account</legend>
      <p>
        Local guidance needs no account. Cloud guidance and plans are not
        available yet.
      </p>
      <label htmlFor="tholi-service-origin">Account service origin</label>
      <input
        id="tholi-service-origin"
        type="url"
        value={origin}
        onChange={(event) => setOrigin(event.target.value)}
        placeholder="https://your-service.example"
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        aria-describedby="tholi-service-origin-help"
      />
      <p id="tholi-service-origin-help">
        Use the trusted HTTPS or local development service you operate. Account
        information is shared only with this service and its identity provider.
      </p>
      <button disabled={busy || !origin} onClick={save}>
        Save service origin
      </button>
      {status.account ? (
        <>
          <p className="tholi-account-id">Signed in · {status.account.id}</p>
          <fieldset
            className="tholi-inference-settings"
            disabled={busy}
            aria-describedby="tholi-inference-help tholi-account-error"
          >
            <legend>Development inference transport</legend>
            <p id="tholi-inference-help">
              Use an explicitly enabled service fake for local development.
              Cloud plans and automatic journey integration are not available
              yet. These choices are separate from private backend and sign-in
              access.
            </p>
            <label className="tholi-inference-choice">
              <input
                type="checkbox"
                checked={inference.enabled}
                aria-describedby="tholi-inference-context-help"
                onChange={(event) => {
                  const next = {
                    enabled: event.target.checked,
                    images: event.target.checked && inference.images,
                  };
                  setInference(next);
                  if (!next.enabled && savedInference.enabled)
                    saveInference(next);
                }}
              />
              Allow sanitized page context to this development service
            </label>
            <p id="tholi-inference-context-help">
              Saving an enabled choice records the service processing consent.
              Turning a saved choice off stops new browser transmission
              immediately. Your local collection is not uploaded.
            </p>
            <label className="tholi-inference-choice">
              <input
                type="checkbox"
                checked={inference.images}
                disabled={!inference.enabled || busy}
                aria-describedby="tholi-inference-image-help"
                onChange={(event) => {
                  const next = { ...inference, images: event.target.checked };
                  setInference(next);
                  if (!next.images && savedInference.images)
                    saveInference(next);
                }}
              />
              Also allow temporary masked images
            </label>
            <p id="tholi-inference-image-help">
              Enable page-context transmission first. Images require their own
              service consent and current website access before each send.
            </p>
            <button
              type="button"
              onClick={() => saveInference()}
              disabled={busy}
            >
              Save inference choices
            </button>
          </fieldset>
          <div className="tholi-account-actions">
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await rpc({ type: "AUTH_REFRESH" });
                  await load();
                }, "Your session was renewed.")
              }
            >
              Renew session
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async () => {
                  await rpc({ type: "AUTH_SIGN_OUT" });
                  setSessions([]);
                  await load();
                }, "Signed out of this Tholi session.")
              }
            >
              Sign out
            </button>
          </div>
          <button
            disabled={busy}
            onClick={() =>
              void act(
                async () =>
                  setSessions(
                    identitySessionsSchema.parse(
                      await rpc({ type: "AUTH_SESSIONS" }),
                    ).items,
                  ),
                "Sessions updated.",
              )
            }
          >
            Review sessions
          </button>
          <ul>
            {sessions.map((session) => (
              <li key={session.id}>
                <span>
                  {session.clientKind}
                  {session.current ? " · This session" : ""}
                  <br />
                  Expires {new Date(session.expiresAt).toLocaleString()}
                </span>
                <AlertDialog.Root>
                  <AlertDialog.Trigger disabled={busy}>
                    Revoke session
                  </AlertDialog.Trigger>
                  <AlertDialog.Portal>
                    <AlertDialog.Backdrop className="tholi-dialog-backdrop" />
                    <AlertDialog.Popup className="tholi-confirm-dialog">
                      <AlertDialog.Title>
                        Revoke this Tholi session?
                      </AlertDialog.Title>
                      <AlertDialog.Description>
                        This session will lose account access. Local routes and
                        guidance stay available.
                      </AlertDialog.Description>
                      <div>
                        <AlertDialog.Close>Cancel</AlertDialog.Close>
                        <AlertDialog.Close
                          onClick={() =>
                            void act(async () => {
                              await rpc({
                                type: "AUTH_REVOKE",
                                id: session.id,
                              });
                              setSessions([]);
                              await load();
                            }, "The Tholi session was revoked.")
                          }
                        >
                          Revoke session
                        </AlertDialog.Close>
                      </div>
                    </AlertDialog.Popup>
                  </AlertDialog.Portal>
                </AlertDialog.Root>
              </li>
            ))}
          </ul>
        </>
      ) : status.configured ? (
        <div className="tholi-account-actions">
          <button disabled={busy} onClick={() => signIn("signin")}>
            Sign in
          </button>
          <button disabled={busy} onClick={() => signIn("signup")}>
            Sign up
          </button>
        </div>
      ) : null}
      <p id="tholi-account-error" hidden={!error} role="alert">
        {error}
      </p>
      <p role="status">{notice}</p>
    </fieldset>
  );
}
