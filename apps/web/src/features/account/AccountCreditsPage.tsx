import { useEffect, useState } from "react";
import {
  creditHistoryPageSchema,
  creditUsagePageSchema,
  type CreditHistoryPage,
  type CreditUsagePage,
} from "../../../../../packages/navigation-core/contracts-credits";
import { useAccountOperation } from "./useAccountOperation";
import { useAccount } from "./session";
import { formatQuantity, type AccountSummary } from "./useAccountSummary";
import "./account-finance.css";

const balanceLabels = {
  available: "Available",
  reserved: "Reserved",
  spent: "Spent",
  granted: "Granted",
  expired: "Expired",
  refunded: "Refunded",
} as const;
const when = (value: string) => (
  <time dateTime={value}>{new Date(value).toLocaleString()}</time>
);
const measured = (value: string | null) =>
  value === null ? "Not confirmed" : formatQuantity(value);
function providerCost(value: string | null) {
  if (value === null) return "Not confirmed";
  const micros = BigInt(value);
  return `$${formatQuantity((micros / 1000000n).toString())}.${(micros % 1000000n).toString().padStart(6, "0")} USD`;
}

export function AccountCreditsPage({ summary }: { summary: AccountSummary }) {
  const account = useAccount(),
    workspace = account.session?.account.workspaceId,
    identity = account.session
      ? `${account.session.account.id}/${workspace}/${account.session.session.id}`
      : "";
  const [history, setHistory] = useState<CreditHistoryPage>(),
    [usage, setUsage] = useState<CreditUsagePage>(),
    [historyCursors, setHistoryCursors] = useState<(string | undefined)[]>([
      undefined,
    ]),
    [usageCursors, setUsageCursors] = useState<(string | undefined)[]>([
      undefined,
    ]),
    [displayIdentity, setDisplayIdentity] = useState(identity);
  const { busy, error, run } = useAccountOperation(account);
  useEffect(() => {
    setDisplayIdentity(identity);
    setHistory(undefined);
    setUsage(undefined);
    setHistoryCursors([undefined]);
    setUsageCursors([undefined]);
  }, [identity]);
  function load(kind: "history" | "usage", cursors: (string | undefined)[]) {
    if (!workspace || !identity) return;
    const query = new URLSearchParams({ limit: "20" }),
      after = cursors.at(-1);
    if (after) query.set("after", after);
    return kind === "history"
      ? run(
          (signal) =>
            account.request(
              `/api/v1/workspaces/${workspace}/credits/events?${query}`,
              creditHistoryPageSchema,
              "GET",
              undefined,
              signal,
            ),
          (result) => {
            setHistory(result);
            setHistoryCursors(cursors);
          },
        )
      : run(
          (signal) =>
            account.request(
              `/api/v1/workspaces/${workspace}/usage?${query}`,
              creditUsagePageSchema,
              "GET",
              undefined,
              signal,
            ),
          (result) => {
            setUsage(result);
            setUsageCursors(cursors);
          },
        );
  }
  if (displayIdentity !== identity)
    return <p role="status">Opening current account usage.</p>;
  const effective = summary.entitlements?.effective,
    plan =
      effective &&
      summary.catalog?.plans.find(
        (item) =>
          item.id === effective.planId &&
          item.version === effective.planVersion,
      ),
    caps = effective?.status === "active" ? effective.caps : null;
  return (
    <section className="account-finance" aria-labelledby="credits-title">
      <header>
        <p className="eyebrow">YOUR ALLOWANCE</p>
        <h1 id="credits-title">Credits and usage</h1>
        <p>
          Review available credits, reservations and recorded processing.
          Credits measure processing, not completed tasks.
        </p>
      </header>
      <p role="status" aria-live="polite" aria-atomic="true">
        {summary.loading
          ? "Loading your allowance."
          : busy
            ? "Loading account activity."
            : ""}
      </p>
      {error && (
        <p className="auth-error" role="alert">
          {error}
        </p>
      )}
      {summary.errors.credits && (
        <p className="auth-error" role="alert">
          {summary.errors.credits}
        </p>
      )}
      {summary.credits ? (
        <>
          <p className="account-finance-note">
            Development credits are for the fake development model. They are not
            a paid balance or a live Gemini allowance.
          </p>
          <dl className="account-finance-balances">
            {Object.entries(balanceLabels).map(([key, label]) => (
              <div key={key}>
                <dt>{label}</dt>
                <dd>
                  {formatQuantity(
                    summary.credits!.balance[key as keyof typeof balanceLabels],
                  )}
                </dd>
              </div>
            ))}
          </dl>
          <p>
            Reserved credits remain held until the processing outcome is
            confirmed. A generated suggestion does not prove that a task
            succeeded.
          </p>
        </>
      ) : (
        !summary.loading && (
          <p>
            Your credit balance is unavailable. Saved-data access does not
            require a positive credit balance.
          </p>
        )
      )}
      <section aria-labelledby="credit-plan-title">
        <h2 id="credit-plan-title">Current cloud allowance</h2>
        {summary.errors.entitlements && (
          <p className="auth-error" role="alert">
            {summary.errors.entitlements}
          </p>
        )}
        {effective ? (
          <>
            <p>
              {plan?.name ?? "Cloud plan"}:{" "}
              {effective.status === "active" ? "Active" : "Inactive"}.
            </p>
            <dl className="account-details">
              <dt>Current period starts</dt>
              <dd>{when(effective.periodStart)}</dd>
              <dt>Current period ends</dt>
              <dd>{when(effective.periodEnd)}</dd>
              {plan?.developmentAllowance?.expiresAtPeriodEnd && (
                <>
                  <dt>Allowance expiry</dt>
                  <dd>{when(effective.periodEnd)}</dd>
                  <dt>Refill eligibility begins</dt>
                  <dd>{when(effective.periodEnd)}</dd>
                </>
              )}
            </dl>
            {plan?.developmentAllowance && (
              <p>
                Unused development credits do not roll over. A refill is issued
                by the service only while the account and plan remain eligible.
              </p>
            )}
          </>
        ) : (
          !summary.loading &&
          summary.entitlements?.effective === null && (
            <p>
              No product cloud plan is enrolled. This does not identify the
              processing choice in your extension.
            </p>
          )
        )}
        {caps && (
          <dl className="account-details">
            <dt>Requests per period</dt>
            <dd>{formatQuantity(String(caps.requestsPerPeriod))}</dd>
            <dt>Requests per minute</dt>
            <dd>{formatQuantity(String(caps.requestsPerMinute))}</dd>
            <dt>Decisions per task</dt>
            <dd>{formatQuantity(String(caps.maxDecisionsPerJourney))}</dd>
            <dt>Images per request</dt>
            <dd>{caps.maxImages}</dd>
            <dt>Concurrent requests</dt>
            <dd>{caps.maxForegroundDecisions}</dd>
            <dt>Input token limit</dt>
            <dd>{formatQuantity(String(caps.maxInputTokens))}</dd>
            <dt>Output token limit</dt>
            <dd>{formatQuantity(String(caps.maxOutputTokens))}</dd>
          </dl>
        )}
      </section>
      <section aria-labelledby="credit-storage-title">
        <h2 id="credit-storage-title">Cloud storage</h2>
        {summary.errors.storage && (
          <p className="auth-error" role="alert">
            {summary.errors.storage}
          </p>
        )}
        {summary.storage ? (
          <>
            <p>
              These totals cover saved data across this account's workspaces.
            </p>
            <dl className="account-details">
              <dt>Saved items</dt>
              <dd>
                {formatQuantity(summary.storage.artifacts)}
                {caps
                  ? ` of ${formatQuantity(String(caps.maxSavedArtifacts))}`
                  : ""}
              </dd>
              <dt>Stored bytes</dt>
              <dd>
                {formatQuantity(summary.storage.bytes)}
                {caps ? ` of ${formatQuantity(caps.maxStoredBytes)}` : ""}
              </dd>
              {caps && (
                <>
                  <dt>Maximum bytes per item</dt>
                  <dd>{formatQuantity(caps.maxSavedArtifactBytes)}</dd>
                </>
              )}
            </dl>
          </>
        ) : (
          !summary.loading && <p>Storage totals are unavailable.</p>
        )}
      </section>
      <section aria-labelledby="credit-history-title">
        <h2 id="credit-history-title">Credit history</h2>
        <button
          disabled={busy}
          onClick={() => void load("history", [undefined])}
        >
          {history ? "Refresh credit history" : "Load credit history"}
        </button>
        {history && (
          <>
            <div className="account-finance-table">
              <table>
                <caption>
                  Grants, settlements and refunds recorded by the service
                </caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Change</th>
                    <th scope="col">Type</th>
                    <th scope="col">Expires</th>
                  </tr>
                </thead>
                <tbody>
                  {history.items.map((item) => (
                    <tr key={item.id}>
                      <td>{when(item.createdAt)}</td>
                      <td>{formatQuantity(item.amount)}</td>
                      <td>
                        {item.kind === "grant"
                          ? "Grant"
                          : item.kind === "refund"
                            ? "Refund"
                            : "Settlement"}
                      </td>
                      <td>
                        {item.expiresAt ? when(item.expiresAt) : "Not recorded"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!history.items.length && <p>No credit events in this page.</p>}
            <ActivityPages
              name="credit history"
              cursors={historyCursors}
              next={history.nextCursor}
              busy={busy}
              onPage={(cursors) => void load("history", cursors)}
            />
          </>
        )}
      </section>
      <section aria-labelledby="credit-usage-title">
        <h2 id="credit-usage-title">Usage activity</h2>
        <p>
          Unconfirmed usage or provider cost stays unconfirmed. Provider cost is
          a service record, not a charge to your account.
        </p>
        <button disabled={busy} onClick={() => void load("usage", [undefined])}>
          {usage ? "Refresh usage activity" : "Load usage activity"}
        </button>
        {usage && (
          <>
            <div className="account-finance-table">
              <table>
                <caption>
                  Recorded model processing, independent of task completion
                </caption>
                <thead>
                  <tr>
                    <th scope="col">When</th>
                    <th scope="col">Processing</th>
                    <th scope="col">Input units</th>
                    <th scope="col">Output units</th>
                    <th scope="col">Credits</th>
                    <th scope="col">Provider cost</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.items.map((item) => (
                    <tr key={item.id}>
                      <td>{when(item.createdAt)}</td>
                      <td>
                        {item.provider}
                        <br />
                        {item.model}
                      </td>
                      <td>{measured(item.inputUnits)}</td>
                      <td>{measured(item.outputUnits)}</td>
                      <td>{measured(item.chargedCredits)}</td>
                      <td>{providerCost(item.providerUsdMicros)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {!usage.items.length && <p>No processing entries in this page.</p>}
            <ActivityPages
              name="usage activity"
              cursors={usageCursors}
              next={usage.nextCursor}
              busy={busy}
              onPage={(cursors) => void load("usage", cursors)}
            />
          </>
        )}
      </section>
    </section>
  );
}

function ActivityPages({
  name,
  cursors,
  next,
  busy,
  onPage,
}: {
  name: string;
  cursors: (string | undefined)[];
  next?: string;
  busy: boolean;
  onPage: (cursors: (string | undefined)[]) => void;
}) {
  return (
    <nav className="account-finance-pages" aria-label={`${name} pages`}>
      <button
        disabled={busy || cursors.length === 1}
        onClick={() => onPage(cursors.slice(0, -1))}
      >
        Previous {name}
      </button>
      <span>Page {cursors.length}</span>
      <button
        disabled={busy || !next}
        onClick={() => onPage([...cursors, next])}
      >
        Next {name}
      </button>
    </nav>
  );
}
