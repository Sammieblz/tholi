import { CUSTOMER_PROVIDER_ENDPOINTS } from "../../apps/api/src/adapters/provider-network";

const customerHosts = new Set(
  Object.values(CUSTOMER_PROVIDER_ENDPOINTS).map(
    (endpoint) => new URL(endpoint).hostname,
  ),
);

/** Fixture owners intercept protocols; the real unit fetch cannot call paid providers. */
export function withoutExternalProviders(fetcher: typeof fetch): typeof fetch {
  return (input, init) => {
    const url = new URL(
      typeof input === "string" || input instanceof URL
        ? String(input)
        : input.url,
    );
    if (
      ["api.stripe.com", "billing.stripe.com", "checkout.stripe.com"].includes(
        url.hostname,
      )
    )
      return Promise.reject(
        new Error(
          "External payment requests are disabled in automated checks.",
        ),
      );
    if (
      customerHosts.has(url.hostname) ||
      url.hostname === "generativelanguage.googleapis.com" ||
      /(?:^|[.-])aiplatform\.googleapis\.com$/.test(url.hostname)
    )
      return Promise.reject(
        new Error("External model requests are disabled in automated checks."),
      );
    return fetcher(input, init);
  };
}
