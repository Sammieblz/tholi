import { useEffect, useState } from "react";
import { SiteLink } from "../../app/router";
import { useAccount } from "./session";
import { ACCOUNT_SECTIONS } from "./paths";
import {
  useAccountSummary,
  formatQuantity,
  type AccountSummary,
} from "./useAccountSummary";
import { SavedDataPage } from "./SavedDataPage";
import { AccountCreditsPage } from "./AccountCreditsPage";
import { AccountPlansPage } from "./AccountPlansPage";
import { AccountSecurityPage } from "./AccountSecurityPage";
import "./account.css";

/** The account boundary supplies identity; private page state has one scoped lifetime. */
export function WelcomePage({ path }: { path: string }) {
  const account = useAccount(),
    actor = account.session?.account.id,
    sessionId = account.session?.session.id;
  const [deletionActor, setDeletionActor] = useState<string>();
  const [signedOut, setSignedOut] = useState<{
    actor: string;
    sessionId: string;
    providerUrl?: string;
  }>();
  useEffect(() => {
    if (actor && actor !== deletionActor) setDeletionActor(undefined);
    if (
      actor &&
      signedOut &&
      (actor !== signedOut.actor || sessionId !== signedOut.sessionId)
    )
      setSignedOut(undefined);
  }, [actor, sessionId, deletionActor, signedOut]);
  if (deletionActor && (!actor || actor === deletionActor))
    return (
      <section className="reading account-gate">
        <h1>Your Tholi account</h1>
        <p role="status">
          Your account deletion request was accepted. You are signed out while
          deletion continues.
        </p>
        <p>Local extension data remains on your device.</p>
        <SiteLink to="/download">Get local Tholi</SiteLink>
      </section>
    );
  if (account.loading)
    return (
      <section className="reading account-gate">
        <h1>Your Tholi account</h1>
        <p role="status">Opening your account.</p>
      </section>
    );
  const outgoing =
    signedOut &&
    (!actor ||
      (actor === signedOut.actor && sessionId === signedOut.sessionId));
  if (!account.session || outgoing)
    return (
      <section className="reading account-gate">
        <p className="eyebrow">YOUR WORKSPACE</p>
        <h1>Your Tholi account</h1>
        {outgoing && <p role="status">Signed out of Tholi.</p>}
        <p>
          {account.configured
            ? "Sign in to manage your account and the data you explicitly saved to the cloud."
            : "Accounts are not configured on this website. Local Tholi needs no account."}
        </p>
        {account.error && (
          <p role="alert" className="auth-error">
            {account.error}
          </p>
        )}
        <div className="account-actions">
          {account.configured && (
            <SiteLink className="web-primary" to="/signin">
              Sign in
            </SiteLink>
          )}
          <SiteLink to="/download">Get local Tholi</SiteLink>
        </div>
        <p>Signing in never uploads local extension data automatically.</p>
        {outgoing && signedOut.providerUrl && (
          <p>
            <a
              href={signedOut.providerUrl}
              target="_blank"
              rel="noopener noreferrer"
            >
              Review sign-out with your identity provider
            </a>
          </p>
        )}
      </section>
    );
  const key = `${account.session.account.id}:${account.session.account.workspaceId}:${account.session.session.id}`;
  return (
    <Workspace
      key={key}
      path={path}
      onDeletionAccepted={setDeletionActor}
      onSignedOut={(providerUrl) => {
        if (actor && sessionId) setSignedOut({ actor, sessionId, providerUrl });
      }}
    />
  );
}

function Workspace({
  path,
  onDeletionAccepted,
  onSignedOut,
}: {
  path: string;
  onDeletionAccepted: (accountId: string) => void;
  onSignedOut: (providerLogoutUrl: string | undefined) => void;
}) {
  const summary = useAccountSummary();
  const selected = path === "/welcome" ? "/account" : path;
  return (
    <section className="account-workspace">
      <nav className="account-navigation" aria-label="Account sections">
        <p className="account-navigation-label">YOUR ACCOUNT</p>
        <ul>
          {ACCOUNT_SECTIONS.map((item) => (
            <li key={item.path}>
              <SiteLink
                to={item.path}
                aria-current={selected === item.path ? "page" : undefined}
              >
                {item.label}
              </SiteLink>
            </li>
          ))}
        </ul>
      </nav>
      <div className="account-content">
        {selected === "/account/data" ? (
          <SavedDataPage />
        ) : selected === "/account/credits" ? (
          <AccountCreditsPage summary={summary} />
        ) : selected === "/account/billing" ? (
          <AccountPlansPage summary={summary} />
        ) : selected === "/account/security" ? (
          <AccountSecurityPage
            summary={summary}
            onDeletionAccepted={onDeletionAccepted}
            onSignedOut={onSignedOut}
          />
        ) : (
          <AccountOverview summary={summary} />
        )}
      </div>
    </section>
  );
}

function AccountOverview({ summary }: { summary: AccountSummary }) {
  const effective = summary.entitlements?.effective,
    plan =
      effective &&
      summary.catalog?.plans.find(
        (item) =>
          item.id === effective.planId &&
          item.version === effective.planVersion,
      ),
    development =
      summary.catalog?.environment === "development" ||
      summary.credits?.policy.environment === "development";
  return (
    <section
      className="account-overview"
      aria-labelledby="account-overview-title"
    >
      <header>
        <p className="eyebrow">YOUR WORKSPACE</p>
        <h1 id="account-overview-title">Your Tholi account</h1>
        <p>
          Manage your account, review saved data and check your allowance. Your
          local extension data stays on your device unless you explicitly choose
          to save it to the cloud.
        </p>
      </header>
      <p role="status" aria-live="polite" aria-atomic="true">
        {summary.loading ? "Loading your account overview." : ""}
      </p>
      {development && (
        <div className="account-development-note">
          <strong>Development workspace</strong>
          <p>
            Cloud processing uses the fake development model. Live Gemini
            access, purchased credits and paid plans are not enabled.
          </p>
        </div>
      )}
      <div className="account-overview-grid">
        <article>
          <h2>Profile and access</h2>
          {summary.profile ? (
            <p>
              {summary.profile.verifiedEmail ? (
                <>
                  Verified email:{" "}
                  <strong>{summary.profile.verifiedEmail}</strong>
                </>
              ) : (
                "No verified email is recorded for this account."
              )}
            </p>
          ) : (
            <p>
              {summary.loading
                ? "Loading your profile."
                : "Your profile is unavailable."}
            </p>
          )}
          {summary.errors.profile && (
            <p role="alert" className="auth-error">
              {summary.errors.profile}
            </p>
          )}
          <SiteLink to="/account/security">Manage account security</SiteLink>
        </article>
        <article>
          <h2>Saved data</h2>
          {summary.storage ? (
            <p>
              <strong>{formatQuantity(summary.storage.artifacts)}</strong> saved
              items using {formatQuantity(summary.storage.bytes)} bytes across
              this account's workspaces.
            </p>
          ) : (
            <p>
              {summary.loading
                ? "Loading your storage totals."
                : "Storage totals are unavailable."}
            </p>
          )}
          {summary.errors.storage && (
            <p role="alert" className="auth-error">
              {summary.errors.storage}
            </p>
          )}
          <p>
            Review saved routes, website knowledge, conversation excerpts and
            preferences.
          </p>
          <SiteLink to="/account/data">Review saved data</SiteLink>
        </article>
        <article>
          <h2>Credits and usage</h2>
          {summary.credits ? (
            <p>
              <strong>
                {formatQuantity(summary.credits.balance.available)}
              </strong>{" "}
              development credits available.{" "}
              {formatQuantity(summary.credits.balance.reserved)} reserved while
              outcomes are confirmed.
            </p>
          ) : (
            <p>
              {summary.loading
                ? "Loading your allowance."
                : "Your credit balance is unavailable."}
            </p>
          )}
          {summary.errors.credits && (
            <p role="alert" className="auth-error">
              {summary.errors.credits}
            </p>
          )}
          <p>Processing records do not prove that a task succeeded.</p>
          <SiteLink to="/account/credits">Review credits and usage</SiteLink>
        </article>
        <article>
          <h2>Current cloud plan</h2>
          {effective ? (
            <p>
              {plan?.name ?? "Cloud plan"}:{" "}
              {effective.status === "active" ? "Active" : "Inactive"}.
            </p>
          ) : summary.entitlements ? (
            <p>
              No product cloud plan is enrolled. Local guidance remains
              available.
            </p>
          ) : (
            <p>
              {summary.loading
                ? "Loading your plan."
                : "Your cloud plan could not be confirmed."}
            </p>
          )}
          {summary.errors.entitlements && (
            <p role="alert" className="auth-error">
              {summary.errors.entitlements}
            </p>
          )}
          {summary.errors.catalog && (
            <p role="alert" className="auth-error">
              {summary.errors.catalog}
            </p>
          )}
          <p>
            Plan availability comes from the service. Signing in does not change
            your extension's processing choice.
          </p>
          <SiteLink to="/account/billing">Review plans and billing</SiteLink>
        </article>
      </div>
      <div className="account-actions">
        <button disabled={summary.loading} onClick={summary.refresh}>
          Refresh account overview
        </button>
      </div>
    </section>
  );
}
