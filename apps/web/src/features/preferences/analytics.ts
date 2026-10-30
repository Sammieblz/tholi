import { parseConsent, type ConsentRecord } from "./cookies";
import {
  productEventSchema,
  productPageSchema,
  type ProductEvent,
} from "../../../../../packages/navigation-core/contracts-analytics";

export const PUBLIC_PAGES = productPageSchema.options;
export type PublicPage = (typeof PUBLIC_PAGES)[number];
export type WebsiteEvent = ProductEvent;

export interface AnalyticsProvider {
  readonly id: string;
  /** Change whenever provider identity, disclosures, or processing purposes change. */
  readonly disclosure: string;
  send(event: WebsiteEvent, signal: AbortSignal): Promise<void>;
}

// Rebuild an exact allowlisted object. Runtime callers cannot add a destination,
// URL query, account identifier, document search, or conversation field.
export function sanitizeWebsiteEvent(event: unknown): WebsiteEvent | null {
  if (!event || typeof event !== "object") return null;
  const input = event as Record<string, unknown>;
  let safe: unknown;
  switch (input.name) {
    case "download_click":
    case "onboarding_complete":
      safe = { name: input.name };
      break;
    case "page_view":
      safe = { name: input.name, page: input.page };
      break;
    case "store_listing_opened":
      safe = { name: input.name, browser: input.browser };
      break;
    case "practice_start":
    case "practice_complete":
      safe = { name: input.name, practice: input.practice };
      break;
    default:
      return null;
  }
  const parsed = productEventSchema.safeParse(safe);
  return parsed.success ? parsed.data : null;
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
  let providerGeneration = 0;
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
    setProvider(next: AnalyticsProvider | null) {
      cancel();
      provider = next;
      const stamp = ++providerGeneration;
      return () => {
        if (providerGeneration !== stamp || provider !== next) return;
        providerGeneration++;
        cancel();
        provider = null;
      };
    },
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
