import { useEffect, useState } from "react";
import type { z } from "zod";
import type { identitySessionsSchema } from "../../../../../packages/navigation-core/contracts-identity";
import { SiteLink } from "../../app/router";
import { useAccount } from "./session";
import { AccountConfirmation } from "./AccountConfirmation";
import { AccountAnalytics } from "./AccountAnalytics";
import "./account.css";

export function WelcomePage() {
  const account = useAccount();
  const [sessions, setSessions] = useState<
    z.infer<typeof identitySessionsSchema>["items"]
  >([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [providerLogout, setProviderLogout] = useState<string>();
  const identity = account.session?.session.id;
  useEffect(() => {
    let active = true;
    setSessions([]);
    setError("");
    if (identity)
      void account
        .sessions()
        .then((result) => {
          if (active) setSessions(result.items);
        })
        .catch((failure: unknown) => {
          if (active)
            setError(
              failure instanceof Error
                ? failure.message
                : "Sessions could not be loaded.",
            );
        });
    return () => {
      active = false;
    };
  }, [identity]);
  const act = async (operation: () => Promise<void>, message: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
      setNotice(message);
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message
          : "The account change could not be completed.",
      );
    } finally {
      setBusy(false);
    }
  };
  const signOut = async (all: boolean) => {
    const target = new URL(await account.signOut(all));
    if (
      (target.protocol === "https:" ||
        (target.protocol === "http:" &&
          ["localhost", "127.0.0.1", "[::1]"].includes(target.hostname))) &&
      !target.username &&
      !target.password
    )
      setProviderLogout(target.href);
    setSessions([]);
  };
  return (
    <section
      className="reading account-security"
      aria-busy={busy || account.loading}
    >
      <p className="eyebrow">YOUR THOLI ACCOUNT</p>
      <h1>Account and security</h1>
      {account.loading ? (
        <p role="status">Opening your account.</p>
      ) : account.session ? (
        <>
          <p>
            Manage access to your Tholi account. Signing out does not erase
            local routes or stop local guidance.
          </p>
          <dl className="account-details">
            <dt>Account</dt>
            <dd>{account.session.account.id}</dd>
            <dt>Current session expires</dt>
            <dd>
              <time dateTime={account.session.session.expiresAt}>
                {new Date(account.session.session.expiresAt).toLocaleString()}
              </time>
            </dd>
          </dl>
          <div className="account-actions">
            <button
              disabled={busy}
              onClick={() =>
                void act(account.renew, "Your account session was renewed.")
              }
            >
              Renew session
            </button>
            <button
              disabled={busy}
              onClick={() =>
                void act(
                  () => signOut(false),
                  "Signed out of this Tholi session.",
                )
              }
            >
              Sign out
            </button>
            <AccountConfirmation
              title="Sign out of every Tholi session?"
              description="This revokes access on your other browsers and devices. Local guidance and local data remain available."
              label="Sign out everywhere"
              busy={busy}
              onConfirm={() =>
                void act(
                  () => signOut(true),
                  "All Tholi sessions were signed out.",
                )
              }
            />
          </div>
          <p>
            <a href={account.authorizationUrl("verify")}>
              Review email verification
            </a>{" "}
            ·{" "}
            <a href={account.authorizationUrl("recover")}>
              Recover account access
            </a>
          </p>
          <h2>Your sessions</h2>
          <p>
            Revoke a session you no longer use or do not recognize. Your
            identity provider may maintain a separate session.
          </p>
          <ul className="account-sessions">
            {sessions.map((session) => (
              <li key={session.id}>
                <div>
                  <strong>
                    {session.clientKind}
                    {session.current ? " · This session" : ""}
                  </strong>
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
                  description="This session will no longer have access to your Tholi account."
                  label={`Revoke ${session.current ? "this" : session.clientKind} session`}
                  busy={busy}
                  onConfirm={() =>
                    void act(async () => {
                      await account.revoke(session.id);
                      setSessions((items) =>
                        items.filter((item) => item.id !== session.id),
                      );
                    }, "The Tholi session was revoked.")
                  }
                />
              </li>
            ))}
          </ul>
          <AccountAnalytics
            key={`${account.session.account.id}:${account.session.account.workspaceId}`}
          />
        </>
      ) : (
        <>
          <p>
            {account.configured
              ? "Sign in to review your account and sessions."
              : "Accounts are not available on this website yet. Local guidance needs no account."}
          </p>
          {account.configured && (
            <SiteLink className="web-primary" to="/signin">
              Sign in
            </SiteLink>
          )}{" "}
          <SiteLink to="/download">Get Tholi</SiteLink>
        </>
      )}
      {(error || account.error) && (
        <p role="alert" className="auth-error">
          {error || account.error}
        </p>
      )}
      <p role="status">{notice}</p>
      {providerLogout && (
        <p>
          <a href={providerLogout} target="_blank" rel="noopener noreferrer">
            Also review sign-out with your identity provider
          </a>
        </p>
      )}
      <p className="small">
        Cloud guidance, cloud saved data, paid plans and credits are not
        available in this release.
      </p>
    </section>
  );
}
