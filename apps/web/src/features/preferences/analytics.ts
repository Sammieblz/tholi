import { parseConsent, type ConsentRecord } from "./cookies";

export const PUBLIC_PAGES = [
  "home",
  "about",
  "download",
  "support",
  "contact",
  "signup",
  "signin",
  "onboarding",
  "welcome",
  "docs",
  "privacy",
  "terms",
  "cookies",
] as const;
export type PublicPage = (typeof PUBLIC_PAGES)[number];
export type WebsiteEvent =
  | { name: "page_view"; page: PublicPage }
  | { name: "download_click" }
  | {
      name: "practice_start" | "practice_complete";
      practice: "account-settings" | "language-preference";
    };

export interface AnalyticsProvider {
  readonly id: string;
  /** Change whenever provider identity, disclosures, or processing purposes change. */
  readonly disclosure: string;
  send(event: WebsiteEvent, signal: AbortSignal): Promise<void>;
}

// Rebuild an exact allowlisted object. Runtime callers cannot add a destination,
// URL query, account identifier, document search, or conversation field.
export function sanitizeWebsiteEvent(event: WebsiteEvent): WebsiteEvent | null {
  if (!event || typeof event !== "object") return null;
  if (event.name === "download_click") return { name: event.name };
  if (event.name === "page_view" && PUBLIC_PAGES.includes(event.page))
    return { name: event.name, page: event.page };
  if (
    (event.name === "practice_start" || event.name === "practice_complete") &&
    (event.practice === "account-settings" ||
      event.practice === "language-preference")
  ) {
    return { name: event.name, practice: event.practice };
  }
  return null;
}

/** No app provider is configured. Host-injected scripts are outside this boundary.
 * This boundary is inert
 * until both an explicit provider and current, provider-specific consent exist. */
export function createConsentAnalytics(
  provider: AnalyticsProvider | null = null,
  now = Date.now,
) {
  let consent: ConsentRecord | null = null;
  let generation = 0;
  let active: AbortController | null = null;
  const queue: WebsiteEvent[] = [];
  const allowed = () =>
    !!(
      provider &&
      consent &&
      parseConsent(JSON.stringify(consent), now()) &&
      consent.analytics?.allowed &&
      consent.analytics.provider === provider.id &&
      consent.analytics.disclosure === provider.disclosure
    );
  const cancel = () => {
    generation++;
    queue.length = 0;
    active?.abort();
    active = null;
  };
  const drain = async () => {
    if (active || !allowed() || !queue.length || !provider) return;
    const event = queue.shift()!;
    const stamp = generation;
    const controller = new AbortController();
    active = controller;
    try {
      await provider.send(event, controller.signal);
    } catch {
      /* Analytics never blocks the product. No retry retains data after withdrawal. */
    } finally {
      if (generation === stamp) {
        active = null;
        void drain();
      }
    }
  };
  return {
    setConsent(record: ConsentRecord | null) {
      cancel();
      consent = record ? parseConsent(JSON.stringify(record), now()) : null;
    },
    track(event: WebsiteEvent) {
      const safe = sanitizeWebsiteEvent(event);
      if (!safe || !allowed()) {
        if (!allowed()) cancel();
        return;
      }
      if (queue.length === 16) queue.shift();
      queue.push(safe);
      void drain();
    },
    dispose() {
      cancel();
      consent = null;
    },
  };
}

/** Injectable transport for an explicitly configured future service or local
 * test endpoint. No cookies, referrer, browser identifier, or background beacon. */
export function createFetchAnalyticsProvider(
  config: { id: string; disclosure: string; endpoint: string },
  fetcher: typeof fetch = fetch,
): AnalyticsProvider {
  return {
    id: config.id,
    disclosure: config.disclosure,
    async send(event, signal) {
      const response = await fetcher(config.endpoint, {
        method: "POST",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        signal,
      });
      if (!response.ok) throw new Error("Analytics endpoint unavailable");
    },
  };
}
