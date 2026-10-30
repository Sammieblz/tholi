import { useEffect, useMemo, useState } from "react";
import {
  PRODUCT_ANALYTICS_PROVIDER,
  PRODUCT_ANALYTICS_VERSION,
  productAnalyticsDeletedSchema,
  productAnalyticsPageSchema,
  productAnalyticsReceiptSchema,
  type ProductAnalyticsRecord,
} from "../../../../../packages/navigation-core/contracts-analytics";
import {
  consentPageSchema,
  consentSchema,
  policyCatalogSchema,
  type Consent,
} from "../../../../../packages/navigation-core/contracts-authorization";
import { serviceCapabilitiesSchema } from "../../../../../packages/navigation-core/contracts-service";
import { usePreferences } from "../preferences";
import { useAccount } from "./session";
import { AccountConfirmation } from "./AccountConfirmation";

/** This bridge lives only inside the signed-in account boundary. */
export function AccountAnalytics() {
  const account = useAccount();
  const { consent, chooseAnalytics, setAnalyticsProvider, trackEvent } =
    usePreferences();
  const workspaceId = account.session?.account.workspaceId;
  const actor = account.session?.account.id;
  const request = account.request;
  const [policyVersion, setPolicyVersion] = useState<string>();
  const [stored, setStored] = useState<Consent>();
  const [available, setAvailable] = useState(false);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [records, setRecords] = useState<ProductAnalyticsRecord[]>();
  const [nextCursor, setNextCursor] = useState<string>();
  const path = `/api/v1/workspaces/${workspaceId}/analytics/events` as const;
  const consentsPath = `/api/v1/workspaces/${workspaceId}/consents` as const;
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setAvailable(false);
    setStored(undefined);
    setRecords(undefined);
    setError("");
    if (!workspaceId || !actor) {
      setLoading(false);
      return;
    }
    void Promise.all([
      request(
        "/api/v1/capabilities",
        serviceCapabilitiesSchema,
        "GET",
        undefined,
        controller.signal,
      ),
      request(
        `/api/v1/workspaces/${workspaceId}/policies`,
        policyCatalogSchema,
        "GET",
        undefined,
        controller.signal,
      ),
      request(
        consentsPath,
        consentPageSchema,
        "GET",
        undefined,
        controller.signal,
      ),
    ])
      .then(([capabilities, policies, saved]) => {
        if (controller.signal.aborted) return;
        setAvailable(capabilities.capabilities.includes("product-analytics"));
        setPolicyVersion(
          policies.consentPolicies.find(
            (p) => p.purpose === "product_analytics",
          )?.policyVersion,
        );
        setStored(
          saved.items.find((row) => row.purpose === "product_analytics"),
        );
      })
      .catch(() => {
        if (!controller.signal.aborted)
          setError(
            "Measurement choices could not be loaded. No optional events will be sent.",
          );
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspaceId, actor, request, consentsPath]);
  const granted = !!(stored?.granted && stored.policyVersion === policyVersion);
  const browserAllowed = !!(
    consent?.analytics?.allowed &&
    consent.analytics.provider === PRODUCT_ANALYTICS_PROVIDER.id &&
    consent.analytics.disclosure === PRODUCT_ANALYTICS_PROVIDER.disclosure
  );
  const provider = useMemo(
    () => ({
      ...PRODUCT_ANALYTICS_PROVIDER,
      async send(event: Parameters<typeof trackEvent>[0], signal: AbortSignal) {
        await request(
          path,
          productAnalyticsReceiptSchema,
          "POST",
          {
            schemaVersion: PRODUCT_ANALYTICS_VERSION,
            eventId: crypto.randomUUID(),
            event,
          },
          signal,
        );
      },
    }),
    [request, path, actor],
  );
  useEffect(() => {
    if (!available || !granted || !workspaceId || !actor) return;
    return setAnalyticsProvider(provider);
  }, [available, granted, workspaceId, actor, provider, setAnalyticsProvider]);
  useEffect(() => {
    if (available && granted && browserAllowed)
      trackEvent({ name: "page_view", page: "account" });
  }, [available, granted, browserAllowed, actor, workspaceId, trackEvent]);

  const act = async (operation: () => Promise<void>) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await operation();
    } catch {
      setError(
        "The measurement change could not be completed. Refresh your account before trying again.",
      );
    } finally {
      setBusy(false);
    }
  };
  const changeAccount = (allowed: boolean) => {
    if (!policyVersion) return;
    if (!allowed) chooseAnalytics(null);
    void act(async () => {
      const next = await request(consentsPath, consentSchema, "POST", {
        purpose: "product_analytics",
        policyVersion: allowed ? policyVersion : stored!.policyVersion,
        granted: allowed,
        expectedRevision: stored?.revision ?? "0",
      });
      setStored(next);
      if (!allowed) {
        setRecords([]);
        setNextCursor(undefined);
      }
      setNotice(
        allowed
          ? "Account permission saved. Choose separately whether this browser may send measurements."
          : "Account permission withdrawn and retained product measurements removed.",
      );
    });
  };
  const review = (after?: string) =>
    void act(async () => {
      const page = await request(
        after ? `${path}?after=${encodeURIComponent(after)}` : path,
        productAnalyticsPageSchema,
      );
      setRecords(page.items);
      setNextCursor(page.nextCursor);
      setNotice(
        "These are the retained product measurements for your account in this workspace.",
      );
    });
  return (
    <section
      aria-labelledby="account-analytics-heading"
      aria-busy={busy || loading}
    >
      <h2 id="account-analytics-heading">Optional product measurements</h2>
      <p>
        Help improve Tholi with fixed page categories and practice events.
        Goals, conversations, website addresses, screenshots and sign-in details
        are excluded. Retained measurements expire after 30 days.
      </p>
      {loading ? (
        <p role="status">Loading measurement choices.</p>
      ) : available && policyVersion ? (
        <>
          <label className="account-measurement-choice">
            <input
              type="checkbox"
              checked={granted}
              disabled={busy}
              aria-describedby="account-measurement-permission-help"
              onChange={(event) => changeAccount(event.target.checked)}
            />
            Allow optional product measurements for this account
          </label>
          <p className="small" id="account-measurement-permission-help">
            This account permission is separate from browser cookie choices.
            Withdrawing it removes retained product measurements in this
            workspace.
          </p>
          <label className="account-measurement-choice">
            <input
              type="checkbox"
              checked={browserAllowed}
              disabled={busy}
              aria-describedby="browser-measurement-permission-help"
              onChange={(event) =>
                chooseAnalytics(
                  event.target.checked
                    ? {
                        provider: PRODUCT_ANALYTICS_PROVIDER.id,
                        disclosure: PRODUCT_ANALYTICS_PROVIDER.disclosure,
                        allowed: true,
                      }
                    : null,
                )
              }
            />
            Allow measurements from this browser
          </label>
          <p className="small" id="browser-measurement-permission-help">
            Both choices are required. This browser sends only while the
            signed-in account page is open, using Tholi's account service.
            Appearance preferences do not grant analytics consent. Local
            guidance and practice remain available with both choices off.
          </p>
          <div className="account-actions">
            <button disabled={busy} onClick={() => review()}>
              Review retained measurements
            </button>
            <AccountConfirmation
              title="Delete retained product measurements?"
              description="This removes your attributed product events in this workspace. It does not erase separate security audit or financial records or change either permission."
              label="Delete measurements"
              busy={busy}
              onConfirm={() =>
                void act(async () => {
                  await request(path, productAnalyticsDeletedSchema, "DELETE");
                  setRecords([]);
                  setNextCursor(undefined);
                  setNotice("Retained product measurements deleted.");
                })
              }
            />
          </div>
          {records && (
            <>
              <pre
                className="account-measurement-export"
                role="region"
                tabIndex={0}
                aria-label="Retained product measurements JSON"
              >
                {JSON.stringify(records, null, 2)}
              </pre>
              {nextCursor && (
                <button disabled={busy} onClick={() => review(nextCursor)}>
                  Next measurements
                </button>
              )}
            </>
          )}
        </>
      ) : (
        <p>
          Optional product measurements are not available on this account
          service.
        </p>
      )}
      {error && (
        <p role="alert" className="auth-error">
          {error}
        </p>
      )}
      <p role="status">{notice}</p>
    </section>
  );
}
