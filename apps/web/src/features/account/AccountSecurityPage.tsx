import { useEffect, useRef, useState } from "react";
import type { z } from "zod";
import {
  identityAccountResponseSchema,
  identitySessionsSchema,
} from "../../../../../packages/navigation-core/contracts-identity";
import {
  accountDeletionInputSchema,
  accountDeletionResultSchema,
} from "../../../../../packages/navigation-core/contracts-account";
import { serviceCapabilitiesSchema } from "../../../../../packages/navigation-core/contracts-service";
import { useAccount } from "./session";
import { AccountConfirmation } from "./AccountConfirmation";
import { AccountAnalytics } from "./AccountAnalytics";
import { AccountExports } from "./AccountExports";
import { useAccountOperation } from "./useAccountOperation";
import type { AccountSummary } from "./useAccountSummary";
import { accountError } from "./account-error";

const clientName = (kind: string, id: string) =>
  id === "extension-chromium"
    ? "Chrome extension"
    : id === "extension-firefox"
      ? "Firefox extension"
      : kind === "web"
        ? "Website"
        : kind === "desktop"
          ? "Desktop app"
          : "Browser extension";
type Availability = { scope: string } & (
  | { status: "loading" }
  | { status: "ready"; capabilities: string[] }
  | { status: "error" }
);

export function AccountSecurityPage({
  summary,
  onDeletionAccepted,
  onSignedOut,
}: {
  summary: AccountSummary;
  onDeletionAccepted(accountId: string): void;
  onSignedOut?(providerLogoutUrl: string | undefined): void;
}) {
  const account = useAccount();
  const operation = useAccountOperation(account);
  const identity = JSON.stringify([
    account.session?.account.id,
    account.session?.account.workspaceId,
    account.session?.session.id,
  ]);
  const currentScope = useRef(identity);
  currentScope.current = identity;
  const [sessions, setSessions] = useState<
    z.infer<typeof identitySessionsSchema>["items"]
  >([]);
  const [availability, setAvailability] = useState<Availability>({
    scope: identity,
    status: "loading",
  });
  const [error, setError] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const deletionKey = useRef<string | undefined>(undefined);
  const request = account.request;
  useEffect(() => {
    const controller = new AbortController();
    const current = () =>
      !controller.signal.aborted && currentScope.current === identity;
    setSessions([]);
    setError("");
    setAvailability({ scope: identity, status: "loading" });
    void request(
      "/api/v1/account/sessions",
      identitySessionsSchema,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (current()) setSessions(result.items);
      })
      .catch((failure: unknown) => {
        if (current()) setError(accountError(failure));
      });
    void request(
      "/api/v1/capabilities",
      serviceCapabilitiesSchema,
      "GET",
      undefined,
      controller.signal,
    )
      .then((result) => {
        if (current())
          setAvailability({
            scope: identity,
            status: "ready",
            capabilities: result.capabilities,
          });
      })
      .catch(() => {
        if (current()) setAvailability({ scope: identity, status: "error" });
      });
    return () => controller.abort();
  }, [identity, request]);
  const signOut = (all: boolean) =>
    operation.run(
      async () => {
        const destination = new URL(await account.signOut(all));
        const allowed =
          (destination.protocol === "https:" ||
            (destination.protocol === "http:" &&
              ["localhost", "127.0.0.1", "[::1]"].includes(
                destination.hostname,
              ))) &&
          !destination.username &&
          !destination.password &&
          !destination.hash;
        // The account may already be unmounted after the confirmed server logout.
        onSignedOut?.(allowed ? destination.href : undefined);
      },
      () => {},
    );
  const requestDeletion = () =>
    operation.run(
      async (signal) => {
        if (confirmation !== "DELETE" || !account.session)
          throw new Error("Confirm deletion first.");
        const actor = account.session.account.id;
        const fresh = await request(
          "/api/v1/account",
          identityAccountResponseSchema,
          "GET",
          undefined,
          signal,
        );
        if (fresh.account.id !== actor) throw new Error("The account changed.");
        deletionKey.current ??= crypto.randomUUID();
        const input = accountDeletionInputSchema.parse({
          operationId: deletionKey.current,
          expectedRevision: fresh.account.revision,
          confirmation,
        });
        const result = await request(
          "/api/v1/account/deletion",
          accountDeletionResultSchema,
          "POST",
          input,
          signal,
        );
        onDeletionAccepted(actor);
        // The accepted service receipt revokes the session. Close only this account's local state.
        await account.completeDeletion();
        return result;
      },
      () => {},
    );
  if (!account.session) return null;
  const visibleAvailability =
    availability.scope === identity
      ? availability
      : { scope: identity, status: "loading" as const };
  const profile = summary.profile;
  const manage = profile?.provider.managementUrl;
  return (
    <section className="account-security" aria-busy={operation.busy}>
      <header>
        <p className="eyebrow">YOUR ACCOUNT</p>
        <h1>Account and security</h1>
        <p>
          Manage access to your account and the data you saved with Tholi. Local
          guidance and local extension data remain separate.
        </p>
      </header>
      <section aria-labelledby="account-profile-title">
        <h2 id="account-profile-title">Your profile</h2>
        {profile ? (
          <>
            <dl className="account-details">
              <dt>Last verified email</dt>
              <dd>
                {profile.verifiedEmail ??
                  "No verified email is available from this identity provider."}
              </dd>
              <dt>Current session expires</dt>
              <dd>
                <time dateTime={account.session.session.expiresAt}>
                  {new Date(account.session.session.expiresAt).toLocaleString()}
                </time>
              </dd>
            </dl>
            {manage && (
              <p>
                <a href={manage} target="_blank" rel="noopener noreferrer">
                  Manage profile and security
                </a>
              </p>
            )}
            <p>
              Profile and password changes happen with your identity provider.
              After changing your email, sign in again so Tholi can verify the
              new address.
            </p>
            <div className="account-actions">
              {profile.provider.verificationAvailable && (
                <a href={account.authorizationUrl("verify")}>
                  Review email verification
                </a>
              )}
              {profile.provider.recoveryAvailable && (
                <a href={account.authorizationUrl("recover")}>
                  Recover account access
                </a>
              )}
              <button
                type="button"
                disabled={operation.busy}
                onClick={() =>
                  void operation.run(
                    account.renew,
                    summary.refresh,
                    "Your account session was renewed.",
                  )
                }
              >
                Renew session
              </button>
            </div>
          </>
        ) : (
          <p role="status">
            {summary.loading
              ? "Loading your verified profile."
              : "Profile details are unavailable. Other account controls remain available."}
          </p>
        )}
        {summary.errors.profile && (
          <p role="alert" className="auth-error">
            {summary.errors.profile}
          </p>
        )}
      </section>
      <section aria-labelledby="account-sessions-title">
        <h2 id="account-sessions-title">Your sessions</h2>
        <p>
          Revoke a session you do not use or recognize. Your identity provider
          may keep a separate session.
        </p>
        <ul className="account-sessions">
          {sessions.map((session) => (
            <li key={session.id}>
              <div>
                <h3>
                  {clientName(session.clientKind, session.clientId)}
                  {session.current ? " · This session" : ""}
                </h3>
                <p>
                  Last used{" "}
                  <time dateTime={session.lastUsedAt}>
                    {new Date(session.lastUsedAt).toLocaleString()}
                  </time>
                </p>
                <p>
                  Expires{" "}
                  <time dateTime={session.expiresAt}>
                    {new Date(session.expiresAt).toLocaleString()}
                  </time>
                </p>
              </div>
              <AccountConfirmation
                title="Revoke this session?"
                description="This session will no longer have access to your Tholi account. Local guidance remains available."
                label={`Revoke ${session.current ? "this" : session.clientKind} session`}
                busy={operation.busy}
                onConfirm={() =>
                  void operation.run(
                    () => account.revoke(session.id),
                    () =>
                      setSessions((previous) =>
                        previous.filter((item) => item.id !== session.id),
                      ),
                    "The Tholi session was revoked.",
                  )
                }
              />
            </li>
          ))}
        </ul>
        <p>
          Signing out clears this account's pending cloud changes on this
          browser. Reconcile any work you want to keep first. Your local routes
          and local guidance stay available.
        </p>
        <div className="account-actions">
          <button
            type="button"
            disabled={operation.busy}
            onClick={() => void signOut(false)}
          >
            Sign out
          </button>
          <AccountConfirmation
            title="Sign out of every Tholi session?"
            description="This revokes access on your other browsers and devices. Pending cloud changes on this browser are cleared; local extension data stays available."
            label="Sign out everywhere"
            busy={operation.busy}
            onConfirm={() => void signOut(true)}
          />
        </div>
      </section>
      {visibleAvailability.status === "loading" && (
        <p role="status">Checking account export and deletion availability.</p>
      )}
      {visibleAvailability.status === "error" && (
        <p role="alert" className="auth-error">
          Account export and deletion availability could not be checked. Reload
          this page before trying again.
        </p>
      )}
      {visibleAvailability.status === "ready" &&
        (visibleAvailability.capabilities.includes("account-export") ? (
          <AccountExports />
        ) : (
          <p>
            Account export is not available from this service. You can still use
            available saved-item export controls.
          </p>
        ))}
      <AccountAnalytics
        key={`${account.session.account.id}:${account.session.account.workspaceId}`}
      />
      <section
        className="account-danger"
        aria-labelledby="account-deletion-title"
      >
        <h2 id="account-deletion-title">Delete your Tholi account</h2>
        <p>
          Export anything you want to keep before continuing. This signs you out
          and queues removal of your Tholi account data. Physical cleanup may
          take time; the confirmation is a request receipt, not proof that
          cleanup has finished.
        </p>
        <p>
          Identity and abuse-prevention markers, unresolved financial records,
          security audit records and deletion tombstones are retained for their
          stated purposes. Your identity-provider account and downloaded copies
          are separate. Transfer any shared workspace you own before requesting
          deletion.
        </p>
        {visibleAvailability.status === "ready" &&
          (visibleAvailability.capabilities.includes("account-deletion") ? (
            <>
              <label htmlFor="account-delete-confirmation">
                Type DELETE to confirm
              </label>
              <input
                id="account-delete-confirmation"
                value={confirmation}
                maxLength={6}
                autoComplete="off"
                spellCheck={false}
                disabled={operation.busy}
                onChange={(event) => setConfirmation(event.target.value)}
                aria-describedby="account-delete-hint"
              />
              <p id="account-delete-hint" className="small">
                Enter DELETE above to enable the final confirmation.
              </p>
              <AccountConfirmation
                title="Request account deletion?"
                description="Your account will be disabled and you will be signed out. Download your exports first. Local extension data is preserved."
                label="Delete account"
                confirmLabel="Request account deletion"
                busy={operation.busy || confirmation !== "DELETE"}
                onConfirm={() => void requestDeletion()}
              />
            </>
          ) : (
            <p>
              Account deletion is not enabled on this service. Contact support
              if you need help removing your account data.
            </p>
          ))}
      </section>
      {(error || operation.error) && (
        <p role="alert" className="auth-error">
          {error || operation.error}
        </p>
      )}
      {operation.notice && <p role="status">{operation.notice}</p>}
    </section>
  );
}
