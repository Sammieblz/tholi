import { useEffect, useId, useRef, useState } from "react";
import { api } from "../../../platform/api";
import { requestServiceAuthAccess } from "../../../platform/service-auth-access";
import { requestBackendAccess } from "../../../platform/site-access";
import {
  serviceAuthStatusSchema,
  type ServiceAuthStatus,
  type ServiceInferenceStatus,
  serviceInferenceStatusSchema,
} from "../../../platform/service-auth-contract";
import { identitySessionsSchema } from "../../../../../../packages/navigation-core/contracts-identity";
import { AlertDialog } from "@base-ui/react/alert-dialog";
import type { z } from "zod";
import {
  providerConnectionsSchema,
  providerConnectionSelection,
  type ProviderConnection,
  type ProviderConnectionSelection,
} from "../../../../../../packages/navigation-core/contracts-providers";
import "./account-settings.css";
import { PrivateLearningSettings } from "./PrivateLearningSettings";
type ProcessingChoice = Pick<
  ServiceInferenceStatus,
  "profile" | "enabled" | "images" | "evaluation" | "connection"
>;
const localChoice: ProcessingChoice = {
  profile: "fake",
  enabled: false,
  images: false,
};

export function AccountSettings() {
  const [inference, setInference] = useState<ProcessingChoice>(localChoice);
  // An acknowledged snapshot for uncertain RPC failures. Optimistic controls
  // are not proof that the background received or saved a processing choice.
  const confirmedInference = useRef<ProcessingChoice | undefined>(undefined);
  const [status, setStatus] = useState<ServiceAuthStatus>({
    configured: false,
  });
  const [origin, setOrigin] = useState("");
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState("");
  const [originInvalid, setOriginInvalid] = useState(false);
  const [sessions, setSessions] = useState<
    z.infer<typeof identitySessionsSchema>["items"]
  >([]);
  const [notice, setNotice] = useState("");
  const [providers, setProviders] = useState<ProviderConnection[]>([]);
  const [providerId, setProviderId] = useState("");
  const operationVersion = useRef(0);
  const processingName = useId();
  const isCurrent = (expected: number) => operationVersion.current === expected;
  const confirmInference = (choices: ProcessingChoice) => {
    confirmedInference.current = choices;
    setInference(choices);
  };
  const rpc = async (message: unknown) => {
    const result: unknown = await api.runtime.sendMessage(message);
    if (result && typeof result === "object" && "error" in result)
      throw new Error(
        "The account request could not be completed. Check your service origin and account permissions, then try again.",
      );
    return result;
  };
  const load = async (expected: number, readInference = true) => {
    if (!isCurrent(expected)) return;
    const result = serviceAuthStatusSchema.parse(
      await rpc({ type: "AUTH_STATUS" }),
    );
    if (!isCurrent(expected)) return;
    const choices = readInference
      ? result.account
        ? serviceInferenceStatusSchema.parse(
            await rpc({ type: "AUTH_INFERENCE_STATUS" }),
          )
        : localChoice
      : undefined;
    if (!isCurrent(expected)) return;
    setStatus(result);
    setOrigin(result.origin ?? "");
    if (!result.account) setSessions([]);
    if (choices) confirmInference(choices);
  };
  useEffect(() => {
    setProviders([]);
    setProviderId("");
  }, [status.account?.id, status.account?.workspaceId]);
  useEffect(() => {
    const expected = ++operationVersion.current;
    void load(expected)
      .catch(() => {
        if (isCurrent(expected))
          setError(
            "Your account connection could not be opened. Local guidance is still available.",
          );
      })
      .finally(() => {
        if (isCurrent(expected)) setBusy(false);
      });
    return () => {
      operationVersion.current++;
    };
  }, []);
  useEffect(() => {
    const expiresAt = inference.evaluation?.expiresAtMs;
    if (!expiresAt) return;
    const timer = setTimeout(
      () => {
        const expected = ++operationVersion.current;
        setBusy(true);
        void load(expected)
          .catch(() => {
            if (isCurrent(expected))
              setError(
                "The temporary evaluation expired. Reopen settings to confirm the current processing choice.",
              );
          })
          .finally(() => {
            if (isCurrent(expected)) setBusy(false);
          });
      },
      Math.max(1, expiresAt - Date.now()),
    );
    return () => clearTimeout(timer);
  }, [inference.evaluation?.expiresAtMs]);
  const act = async (
    operation: (expected: number) => Promise<void | string>,
    message: string,
    retainAccount = false,
  ) => {
    const expected = ++operationVersion.current;
    setBusy(true);
    setError("");
    setOriginInvalid(false);
    setNotice("");
    try {
      const completed = await operation(expected);
      if (isCurrent(expected)) setNotice(completed ?? message);
    } catch (failure) {
      if (!isCurrent(expected)) return;
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
      if (isCurrent(expected)) setBusy(false);
    }
  };
  const save = () => {
    // The native permission request must stay in the original button gesture.
    let access: Promise<boolean>;
    try {
      access = requestServiceAuthAccess(origin);
    } catch {
      setOriginInvalid(true);
      setError("Enter an HTTPS service origin or a loopback HTTP origin.");
      return;
    }
    void act(async (expected) => {
      const allowed = await access;
      if (!isCurrent(expected)) return;
      if (!allowed)
        throw new Error(
          "Account access was declined. Local guidance is still available.",
        );
      await rpc({ type: "AUTH_CONFIGURE", origin });
      if (!isCurrent(expected)) return;
      setSessions([]);
      await load(expected);
    }, "The account service origin was saved.");
  };
  const signIn = (action: "signin" | "signup") => {
    let access: Promise<boolean>;
    try {
      access = requestServiceAuthAccess(origin);
    } catch {
      setOriginInvalid(true);
      setError("Save a valid account service origin first.");
      return;
    }
    void act(async (expected) => {
      const allowed = await access;
      if (!isCurrent(expected)) return;
      if (!allowed) throw new Error("Account access was declined.");
      await rpc({ type: "AUTH_SIGN_IN", action });
      if (!isCurrent(expected)) return;
      setSessions([]);
      await load(expected);
    }, "Signed in to Tholi. Local guidance remains available.");
  };
  const saveInference = (
    choices: {
      enabled: boolean;
      images: boolean;
      profile?: "fake" | "customer-funded";
      connection?: ProviderConnectionSelection;
    },
    reducing = false,
  ) => {
    const next = choices.enabled
      ? { ...choices, profile: choices.profile ?? ("fake" as const) }
      : { profile: "fake" as const, enabled: false, images: false };
    // Native website/data permission must remain inside this original gesture.
    let access: Promise<boolean> | undefined;
    try {
      access =
        choices.enabled && !reducing
          ? requestBackendAccess(status.origin ?? "")
          : undefined;
    } catch {
      operationVersion.current++;
      setBusy(false);
      setError(
        "Transmission access could not be requested. Your processing choice is unchanged. Check the account service origin and try again.",
      );
      return;
    }
    setInference(next);
    void act(
      async (expected) => {
        let configurationStarted = false;
        try {
          if (access) {
            const allowed = await access;
            if (!isCurrent(expected)) return;
            if (!allowed)
              throw new Error("Inference transmission access was not granted.");
          }
          if (!isCurrent(expected)) return;
          // Reductions reach the background before the first await, including
          // an unfinished first enable. No new native permission is requested.
          configurationStarted = true;
          const result = serviceInferenceStatusSchema.parse(
            await rpc({
              type: "AUTH_INFERENCE_CONFIGURE",
              ...next,
            }),
          );
          if (!isCurrent(expected)) return;
          confirmInference(result);
          if (!result.enabled && !status.account) {
            try {
              // A Local choice may have fenced the first account read. Refresh
              // metadata only; do not restore choices from a stale status read.
              await load(expected, false);
            } catch {
              if (isCurrent(expected))
                setError(
                  "Browser transmission is off, but account details could not be refreshed. Reopen settings to review your account.",
                );
            }
            if (!isCurrent(expected)) return;
          }
          if (!result.enabled && !result.serverConsentUpdated)
            return "Local selected. Browser transmission is off. Service consent withdrawal is unconfirmed; review it when the account service is available.";
          if (reducing && result.enabled)
            return "Masked image transmission is off. Sanitized page context can still be sent to the connected development service.";
        } catch (failure) {
          if (!isCurrent(expected)) return;
          if (!configurationStarted) {
            if (confirmedInference.current)
              setInference(confirmedInference.current);
            throw failure;
          }
          // A rejected RPC may never reach the background. Accept only a fresh
          // acknowledgement, rather than inferring that transmission is off.
          try {
            const current = serviceInferenceStatusSchema.parse(
              await rpc({ type: "AUTH_INFERENCE_STATUS" }),
            );
            if (!isCurrent(expected)) return;
            confirmInference(current);
            if (!current.configured)
              setStatus({ configured: !!status.origin, origin: status.origin });
          } catch {
            if (!isCurrent(expected)) return;
            if (confirmedInference.current)
              setInference(confirmedInference.current);
            throw new Error(
              "The processing update could not be confirmed. " +
                (confirmedInference.current
                  ? "The last confirmed choice is shown. "
                  : "The current browser transmission setting is unknown. ") +
                "Select Local again to stop service transmission, or reopen settings to review the current choice.",
            );
          }
          throw failure;
        }
      },
      choices.enabled
        ? next.profile === "customer-funded"
          ? "Your provider connection is selected. Explicit guidance requests may incur charges on your provider account."
          : "Connected development service selected. Processing consent is saved; the service can propose next controls for your current task."
        : "Local selected. Browser transmission is off and service consent withdrawal is confirmed.",
      true,
    );
  };
  return (
    <fieldset className="tholi-account-settings">
      <legend>Processing and account</legend>
      <p>
        Local guidance needs no account or credits. Customer-funded guidance
        requires sign-in and your own provider connection. Managed Gemini and
        paid plans remain disabled.
      </p>
      <fieldset
        className="tholi-inference-settings"
        aria-describedby="tholi-inference-help tholi-account-error"
      >
        <legend>Processing choice</legend>
        <label className="tholi-inference-choice">
          <input
            type="radio"
            value="local"
            name={processingName}
            checked={!inference.enabled}
            aria-describedby="tholi-local-processing-help"
            onChange={() =>
              saveInference({ enabled: false, images: false }, true)
            }
            onClick={() => {
              // An explicit Local choice must fence a pending initial read too.
              if (!inference.enabled)
                saveInference({ enabled: false, images: false }, true);
            }}
          />
          Local
        </label>
        <p id="tholi-local-processing-help">
          Selecting Local stops context and image transmission to the connected
          service and selected AI provider, including a pending enable request.
          Private backend processing has its own settings and consent.
        </p>
        <label className="tholi-inference-choice">
          <input
            type="radio"
            value="connected"
            name={processingName}
            checked={inference.enabled && inference.profile === "fake"}
            disabled={busy || !status.account}
            aria-describedby="tholi-inference-help"
            onChange={() =>
              saveInference({ enabled: true, images: inference.images })
            }
          />
          Connected development service
        </label>
        <p id="tholi-inference-help">
          Sign in to a configured development service first. Selecting this
          option authorizes sanitized page-context transmission to that service
          and records its processing consent. It uses an explicitly enabled fake
          model, not a hosted cloud plan. Your local collection is not uploaded.
          Private backend and sign-in access remain separate choices.
        </p>
        <fieldset
          className="tholi-provider-selection"
          disabled={busy || !status.account}
        >
          <legend>Your AI provider</legend>
          <p>
            Manage encrypted keys in the website account workspace. This
            extension receives connection metadata only. Refreshing connections
            makes no model request.
          </p>
          <button
            type="button"
            onClick={() =>
              void act(
                async (expected) => {
                  const listed = providerConnectionsSchema.parse(
                    await rpc({ type: "AUTH_PROVIDER_CONNECTIONS" }),
                  );
                  if (isCurrent(expected))
                    setProviders(
                      listed.items.filter((item) => item.status === "active"),
                    );
                },
                "Provider connections refreshed. No model request was made.",
                true,
              )
            }
          >
            Refresh AI connections
          </button>
          <label htmlFor="tholi-provider-choice">Provider and model</label>
          <select
            id="tholi-provider-choice"
            value={providerId}
            onChange={(event) => setProviderId(event.target.value)}
          >
            <option value="">Choose a saved connection</option>
            {providers.map((item) => (
              <option key={item.id} value={item.id}>
                {item.provider}: {item.model}
              </option>
            ))}
          </select>
          {inference.profile === "customer-funded" && inference.connection && (
            <p>
              Current choice: {inference.connection.provider},{" "}
              {inference.connection.model}. Changing or rotating a key requires
              selecting its current connection again.
            </p>
          )}
          <p id="tholi-provider-disclosure">
            Your provider account pays for requests. Managed Tholi credits are
            not used. OpenRouter requests are processed by OpenRouter and its
            approved Anthropic upstream, without fallback routing. Tholi does
            not promise verified zero retention.
          </p>
          <button
            type="button"
            disabled={!providers.some((item) => item.id === providerId)}
            aria-describedby="tholi-provider-disclosure"
            onClick={() => {
              const connection = providers.find(
                (item) => item.id === providerId,
              );
              if (connection)
                saveInference({
                  profile: "customer-funded",
                  connection: providerConnectionSelection(connection),
                  enabled: true,
                  images: inference.images,
                });
            }}
          >
            Use selected provider
          </button>
        </fieldset>
        {inference.evaluation && (
          <>
            <label className="tholi-inference-choice">
              <input
                type="radio"
                name={processingName}
                value="operator-evaluation"
                checked
                readOnly
                disabled
                aria-describedby="tholi-operator-evaluation-help"
              />
              Temporary operator evaluation
            </label>
            <p id="tholi-operator-evaluation-help">
              {inference.evaluation.provider === "vertex"
                ? "Vertex"
                : "Fake provider"}
              , {inference.evaluation.arm}. This declared trial expires at{" "}
              {new Date(inference.evaluation.expiresAtMs).toLocaleTimeString()}.
              It is not a saved processing choice or a hosted plan. Selecting
              Local or the development service ends this evaluation.
            </p>
          </>
        )}
        <label className="tholi-inference-choice">
          <input
            type="checkbox"
            checked={inference.images}
            disabled={
              !inference.enabled ||
              (busy && !inference.images) ||
              (inference.profile === "operator-evaluation" && !inference.images)
            }
            aria-describedby="tholi-inference-image-help"
            onChange={(event) => {
              const images = event.target.checked;
              saveInference(
                {
                  enabled: inference.profile !== "operator-evaluation",
                  images,
                  ...(inference.profile === "customer-funded"
                    ? {
                        profile: "customer-funded",
                        connection: inference.connection,
                      }
                    : {}),
                },
                !images,
              );
            }}
          />
          Allow temporary masked images
        </label>
        <p id="tholi-inference-image-help">
          Selecting images records separate image-transmission consent. Images
          still require current website access before each send. Turning this
          off stops new image transmission without requesting another
          permission. For a temporary operator trial, turning images off ends
          the trial and selects Local.
        </p>
      </fieldset>
      {status.account && status.origin && (
        <PrivateLearningSettings
          account={status.account}
          serviceOrigin={status.origin}
        />
      )}
      <label htmlFor="tholi-service-origin">Account service origin</label>
      <input
        id="tholi-service-origin"
        type="url"
        value={origin}
        onChange={(event) => {
          setOrigin(event.target.value);
          setOriginInvalid(false);
        }}
        placeholder="https://your-service.example"
        autoComplete="off"
        spellCheck={false}
        disabled={busy}
        aria-invalid={originInvalid || undefined}
        aria-describedby="tholi-service-origin-help tholi-account-error"
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
          <div className="tholi-account-actions">
            <button
              disabled={busy}
              onClick={() =>
                void act(async (expected) => {
                  await rpc({ type: "AUTH_REFRESH" });
                  if (isCurrent(expected)) await load(expected);
                }, "Your session was renewed.")
              }
            >
              Renew session
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(async (expected) => {
                  await rpc({ type: "AUTH_SIGN_OUT" });
                  if (!isCurrent(expected)) return;
                  setSessions([]);
                  await load(expected);
                }, "Signed out of this Tholi session.")
              }
            >
              Sign out
            </button>
          </div>
          <button
            disabled={busy}
            onClick={() =>
              void act(async (expected) => {
                const result = identitySessionsSchema.parse(
                  await rpc({ type: "AUTH_SESSIONS" }),
                );
                if (isCurrent(expected)) setSessions(result.items);
              }, "Sessions updated.")
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
                            void act(async (expected) => {
                              await rpc({
                                type: "AUTH_REVOKE",
                                id: session.id,
                              });
                              if (!isCurrent(expected)) return;
                              setSessions([]);
                              await load(expected);
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
      <p role="status" aria-live="polite" aria-atomic="true">
        {busy ? "Updating settings. Local remains available." : notice}
      </p>
    </fieldset>
  );
}
