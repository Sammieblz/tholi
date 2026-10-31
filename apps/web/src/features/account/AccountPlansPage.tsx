import { freeEnrollmentSchema } from "../../../../../packages/navigation-core/contracts-plans";
import { SiteLink } from "../../app/router";
import { useAccountOperation } from "./useAccountOperation";
import { useAccount } from "./session";
import { formatQuantity, type AccountSummary } from "./useAccountSummary";
import "./account-finance.css";

function period(seconds: number) {
  for (const [unit, size] of [
    ["day", 86400],
    ["hour", 3600],
    ["minute", 60],
  ] as const) {
    if (seconds % size === 0) {
      const count = seconds / size;
      return `${formatQuantity(String(count))} ${unit}${count === 1 ? "" : "s"}`;
    }
  }
  return `${formatQuantity(String(seconds))} seconds`;
}

export function AccountPlansPage({ summary }: { summary: AccountSummary }) {
  const account = useAccount(),
    workspace = account.session?.account.workspaceId,
    { busy, error, notice, run } = useAccountOperation(account);
  function enroll() {
    if (
      !workspace ||
      !account.session ||
      !summary.catalog?.plans.some(
        (plan) => plan.mode === "free-cloud" && plan.availability.available,
      )
    )
      return;
    return run(
      (signal) =>
        account.request(
          `/api/v1/workspaces/${workspace}/entitlements/free`,
          freeEnrollmentSchema,
          "POST",
          {},
          signal,
        ),
      summary.refresh,
      "Your Free Cloud development allowance was confirmed. Your extension's processing choice is unchanged.",
    );
  }
  return (
    <section className="account-finance" aria-labelledby="plans-title">
      <header>
        <p className="eyebrow">CHOOSE WHAT FITS</p>
        <h1 id="plans-title">Plans and billing</h1>
        <p>
          Local guidance stays account free. Cloud access is separate and never
          uploads your local data automatically.
        </p>
      </header>
      <p role="status" aria-live="polite" aria-atomic="true">
        {busy ? "Checking Free Cloud eligibility." : notice}
      </p>
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      {summary.errors.catalog && (
        <p role="alert" className="auth-error">
          {summary.errors.catalog}
        </p>
      )}
      {summary.loading && !summary.catalog && (
        <p role="status">Loading the current plan catalog.</p>
      )}
      {summary.catalog ? (
        <div className="account-finance-plans">
          {summary.catalog.plans.map((plan) => {
            const active =
              summary.entitlements?.effective?.status === "active" &&
              summary.entitlements.effective.planId === plan.id &&
              summary.entitlements.effective.planVersion === plan.version;
            return (
              <article
                key={`${plan.id}/${plan.version}`}
                aria-labelledby={`plan-${plan.id}`}
              >
                <h2 id={`plan-${plan.id}`}>{plan.name}</h2>
                {plan.mode === "local" ? (
                  <>
                    <p>
                      No Tholi account required. Your data remains on your
                      device.
                    </p>
                    <p>Free to install.</p>
                    <SiteLink to="/download">Get local Tholi</SiteLink>
                  </>
                ) : plan.mode === "free-cloud" ? (
                  <>
                    {plan.availability.available &&
                    plan.developmentAllowance ? (
                      <>
                        <p>
                          Development allowance for testing with the fake model.
                          Live Gemini access and production allowances are not
                          enabled.
                        </p>
                        <p>
                          {formatQuantity(plan.developmentAllowance.amount)}{" "}
                          development credits per{" "}
                          {period(plan.developmentAllowance.periodSeconds)}.
                          Unused credits expire and do not roll over.
                        </p>
                        {active ? (
                          <p>
                            Active for this workspace. Review your allowance and
                            expiry on Credits and usage.
                          </p>
                        ) : (
                          <button
                            disabled={
                              busy || summary.loading || !account.session
                            }
                            onClick={() => void enroll()}
                          >
                            Enable Free Cloud development
                          </button>
                        )}
                      </>
                    ) : (
                      <p>
                        Cloud processing is unavailable in this deployment. A
                        production allowance has not been published.
                      </p>
                    )}
                  </>
                ) : (
                  <>
                    <p>
                      Paid plans are unavailable. Prices and allowances have not
                      been published.
                    </p>
                    <p>Checkout and payment collection are not enabled.</p>
                  </>
                )}
              </article>
            );
          })}
        </div>
      ) : (
        !summary.loading && (
          <p>
            The plan catalog is unavailable. You can continue using local Tholi.
          </p>
        )
      )}
      <section aria-labelledby="billing-title">
        <h2 id="billing-title">Billing</h2>
        <p>
          There is no checkout or payment form in this version. Development
          credits are not purchased credits. No paid plan is activated from this
          page.
        </p>
      </section>
    </section>
  );
}
