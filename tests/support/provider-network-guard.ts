import { CUSTOMER_PROVIDER_ENDPOINTS } from "../../apps/api/src/adapters/provider-network";

const customerHosts = new Set(
  Object.values(CUSTOMER_PROVIDER_ENDPOINTS).map(
    (endpoint) => new URL(endpoint).hostname,
  ),
);

/** Shared by real unit fetch and zero-cost browser collection, before dispatch. */
export function externalProviderKind(raw: string | URL) {
  const host = new URL(raw).hostname.replace(/\.$/, "");
  if (
    ["api.stripe.com", "billing.stripe.com", "checkout.stripe.com"].includes(
      host,
    )
  )
    return "payment" as const;
  if (
    customerHosts.has(host) ||
    host === "generativelanguage.googleapis.com" ||
    /(?:^|[.-])aiplatform(?:\.[a-z0-9-]+\.rep)?\.googleapis\.com$/.test(host)
  )
    return "model" as const;
}

/** Fixture owners intercept protocols; the real unit fetch cannot call paid providers. */
export function withoutExternalProviders(fetcher: typeof fetch): typeof fetch {
  return (input, init) => {
    const kind = externalProviderKind(
      typeof input === "string" || input instanceof URL ? input : input.url,
    );
    if (kind === "payment")
      return Promise.reject(
        new Error(
          "External payment requests are disabled in automated checks.",
        ),
      );
    if (kind === "model")
      return Promise.reject(
        new Error("External model requests are disabled in automated checks."),
      );
    return fetcher(input, init);
  };
}
