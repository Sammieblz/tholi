// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import {
  PreferencesProvider,
  usePreferences,
} from "../../../apps/web/src/features/preferences/PreferencesProvider";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONSENT_COOKIE,
  CONSENT_LIFETIME,
  THEME_COOKIE,
  cookieValue,
  createConsent,
  parseConsent,
  readWebsitePreferences,
  saveWebsitePreferences,
  writeThemeCookie,
  type CookieAccess,
} from "../../../apps/web/src/features/preferences/cookies";
import {
  createConsentAnalytics,
  createFetchAnalyticsProvider,
  sanitizeWebsiteEvent,
  type WebsiteEvent,
} from "../../../apps/web/src/features/preferences/analytics";

const now = Date.UTC(2026, 9, 16, 12);
function cookieJar(secure = false) {
  const values = new Map<string, string>();
  const writes: string[] = [];
  const access: CookieAccess = {
    read: () =>
      [...values].map(([name, value]) => `${name}=${value}`).join("; "),
    write(value) {
      writes.push(value);
      const first = value.split(";")[0];
      const split = first.indexOf("=");
      const name = first.slice(0, split);
      if (value.includes("Max-Age=0;")) values.delete(name);
      else values.set(name, first.slice(split + 1));
    },
    secure,
  };
  return { access, values, writes };
}

describe("website appearance and cookie choices", () => {
  it("starts dark independently of the OS and ignores theme without valid consent", () => {
    const jar = cookieJar();
    jar.values.set(THEME_COOKIE, "light");
    expect(readWebsitePreferences(jar.access, now).theme).toBe("dark");
    jar.values.set(
      CONSENT_COOKIE,
      encodeURIComponent(JSON.stringify(createConsent(false, now))),
    );
    expect(readWebsitePreferences(jar.access, now).theme).toBe("dark");
  });
  it("remembers a permitted theme for no longer than the 180-day consent", () => {
    const jar = cookieJar(true);
    const consent = createConsent(true, now);
    expect(saveWebsitePreferences(jar.access, consent, "light", now)).toBe(
      true,
    );
    expect(readWebsitePreferences(jar.access, now)).toEqual({
      consent,
      theme: "light",
      storageAvailable: true,
    });
    expect(
      jar.writes.every(
        (line) =>
          line.includes("Path=/; SameSite=Lax;") &&
          line.endsWith("; Secure") &&
          !line.includes("Domain="),
      ),
    ).toBe(true);
    expect(jar.writes[0]).toContain("Max-Age=15552000");
    writeThemeCookie(jar.access, "dark", consent, now + 100_000);
    expect(jar.writes.at(-1)).toContain("Max-Age=15551900");
    expect(readWebsitePreferences(jar.access, consent.expiresAt).theme).toBe(
      "dark",
    );
    expect(
      readWebsitePreferences(jar.access, consent.expiresAt).consent,
    ).toBeNull();
  });
  it("Essential only clears browser analytics and appearance, aborts pending events and persists one essential choice", async () => {
    const jar = cookieJar();
    saveWebsitePreferences(
      jar.access,
      createConsent(true, now, {
        provider: "local-test",
        disclosure: "v1",
        allowed: true,
      }),
      "light",
      now,
    );
    Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 100);
    let preferences!: ReturnType<typeof usePreferences>;
    function Probe() {
      preferences = usePreferences();
      return null;
    }
    let finish: (() => void) | undefined;
    let signal: AbortSignal | undefined;
    const send = vi.fn((_event: WebsiteEvent, activeSignal: AbortSignal) => {
      signal = activeSignal;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    try {
      await act(async () =>
        root.render(
          createElement(
            PreferencesProvider,
            { cookieAccess: jar.access },
            createElement(Probe),
          ),
        ),
      );
      preferences.setAnalyticsProvider({
        id: "local-test",
        disclosure: "v1",
        send,
      });
      act(() => preferences.openCookieSettings());
      preferences.trackEvent({ name: "download_click" });
      preferences.trackEvent({
        name: "practice_start",
        practice: "account-settings",
      });
      expect(send).toHaveBeenCalledOnce();
      const writes = jar.writes.filter((value) =>
        value.startsWith(CONSENT_COOKIE + "="),
      ).length;
      act(() => preferences.chooseEssentials());
      expect(signal?.aborted).toBe(true);
      expect(preferences.consent).toMatchObject({
        preferences: false,
        analytics: null,
      });
      expect(preferences.settingsOpen).toBe(false);
      expect(
        jar.writes.filter((value) => value.startsWith(CONSENT_COOKIE + "=")),
      ).toHaveLength(writes + 1);
      finish?.();
      await Promise.resolve();
      preferences.trackEvent({ name: "download_click" });
      expect(send).toHaveBeenCalledOnce();
    } finally {
      finish?.();
      act(() => root.unmount());
      container.remove();
      clock.mockRestore();
    }
    expect(jar.values.has(THEME_COOKIE)).toBe(false);
    expect(
      jar.writes.some(
        (line) =>
          line.startsWith("tholi_theme=;") && line.includes("Max-Age=0;"),
      ),
    ).toBe(true);
    expect(jar.writes.at(-1)).not.toContain("Secure");
    expect(
      parseConsent(cookieValue(jar.access.read(), CONSENT_COOKIE), now + 100)
        ?.preferences,
    ).toBe(false);
    expect(
      parseConsent(cookieValue(jar.access.read(), CONSENT_COOKIE), now + 100)
        ?.analytics,
    ).toBeNull();
  });
  it("never writes theme after refusal and handles unavailable or silently blocked cookies", () => {
    const blocked: CookieAccess = {
      read: () => "",
      write: () => {},
      secure: false,
    };
    expect(
      saveWebsitePreferences(blocked, createConsent(true, now), "light", now),
    ).toBe(false);
    const throws: CookieAccess = {
      read: () => {
        throw new Error("blocked");
      },
      write: () => {
        throw new Error("blocked");
      },
      secure: false,
    };
    expect(readWebsitePreferences(throws, now)).toEqual({
      consent: null,
      theme: "dark",
      storageAvailable: false,
    });
    expect(
      saveWebsitePreferences(throws, createConsent(false, now), "light", now),
    ).toBe(false);
    const jar = cookieJar();
    expect(
      writeThemeCookie(jar.access, "light", createConsent(false, now), now),
    ).toBe(false);
    expect(jar.values.has(THEME_COOKIE)).toBe(false);
  });
  it("rejects malformed, unknown-version, expired, unbounded and future consent", () => {
    const valid = createConsent(true, now);
    for (const invalid of [
      "%",
      "null",
      "{}",
      "[]",
      "x".repeat(2049),
      JSON.stringify({ ...valid, version: 2 }),
      JSON.stringify({ ...valid, preferences: "yes" }),
      JSON.stringify({ ...valid, savedAt: now + 120_000 }),
      JSON.stringify({ ...valid, expiresAt: now }),
      JSON.stringify({ ...valid, expiresAt: now + CONSENT_LIFETIME + 1 }),
      JSON.stringify({
        ...valid,
        analytics: { provider: "service", disclosure: "v1", allowed: "yes" },
      }),
    ])
      expect(parseConsent(invalid, now)).toBeNull();
    expect(cookieValue("tholi_theme=%E0%A4%A", THEME_COOKIE)).toBeNull();
  });
});

describe("pre-paint appearance matches consent validation", () => {
  const html = readFileSync("apps/web/index.html", "utf8");
  const script = html.match(/<script>([\s\S]*?)<\/script>/)![1];
  beforeEach(() => {
    for (const part of document.cookie.split(";"))
      document.cookie = `${part.split("=")[0].trim()}=; Max-Age=0; Path=/`;
    document.documentElement.dataset.tholiTheme = "dark";
    document.documentElement.style.colorScheme = "dark";
  });
  it("sets explicit saved light before app startup, while empty or malformed choices stay dark", () => {
    window.eval(script);
    expect(document.documentElement.dataset.tholiTheme).toBe("dark");
    document.cookie = `tholi_theme=light; Path=/`;
    document.cookie = `tholi_consent=${encodeURIComponent(JSON.stringify(createConsent(true)))}; Path=/`;
    window.eval(script);
    expect(document.documentElement.dataset.tholiTheme).toBe("light");
    document.documentElement.dataset.tholiTheme = "dark";
    document.cookie = `tholi_consent=${encodeURIComponent(JSON.stringify({ ...createConsent(true), analytics: { provider: 1, disclosure: "v1", allowed: true } }))}; Path=/`;
    window.eval(script);
    expect(document.documentElement.dataset.tholiTheme).toBe("dark");
  });
});

describe("consent-gated analytics preparation", () => {
  const providerConsent = (disclosure = "v1") =>
    createConsent(false, now, {
      provider: "local-test",
      disclosure,
      allowed: true,
    });
  it("sends nothing when unconfigured, before consent, or with preference-only consent", async () => {
    const send = vi.fn(async () => {});
    const boundary = createConsentAnalytics(
      { id: "local-test", disclosure: "v1", send },
      () => now,
    );
    boundary.track({ name: "download_click" });
    boundary.setConsent(createConsent(true, now));
    boundary.track({ name: "page_view", page: "home" });
    const inert = createConsentAnalytics(null, () => now);
    inert.setConsent(providerConsent());
    inert.track({ name: "download_click" });
    expect(send).not.toHaveBeenCalled();
  });
  it("requires fresh provider-specific disclosures and rejects expired consent", () => {
    const send = vi.fn(async () => {});
    let clock = now;
    const boundary = createConsentAnalytics(
      { id: "local-test", disclosure: "v2", send },
      () => clock,
    );
    boundary.setConsent(providerConsent());
    boundary.track({ name: "download_click" });
    expect(send).not.toHaveBeenCalled();
    boundary.setConsent(providerConsent("v2"));
    clock += CONSENT_LIFETIME;
    boundary.track({ name: "download_click" });
    expect(send).not.toHaveBeenCalled();
  });
  it("passes only exact eligible fields to an injectable test endpoint", async () => {
    const fetcher = vi.fn(async () => ({ ok: true }) as Response);
    const provider = createFetchAnalyticsProvider(
      { id: "local-test", disclosure: "v1", endpoint: "/test/analytics" },
      fetcher,
    );
    const boundary = createConsentAnalytics(provider, () => now);
    boundary.setConsent(providerConsent());
    boundary.track({
      name: "page_view",
      page: "docs",
      destination: "private",
      query: "private",
      email: "private",
    } as WebsiteEvent);
    await vi.waitFor(() => expect(fetcher).toHaveBeenCalledOnce());
    expect(fetcher.mock.calls[0]).toEqual([
      "/test/analytics",
      expect.objectContaining({
        method: "POST",
        credentials: "omit",
        referrerPolicy: "no-referrer",
        body: '{"name":"page_view","page":"docs"}',
      }),
    ]);
    expect(
      sanitizeWebsiteEvent({
        name: "page_view",
        page: "/docs?q=private",
      } as unknown as WebsiteEvent),
    ).toBeNull();
    expect(
      sanitizeWebsiteEvent({
        name: "conversation",
        text: "private",
      } as unknown as WebsiteEvent),
    ).toBeNull();
  });
  it("withdrawal aborts in-flight work, purges queued events and prevents later requests", async () => {
    let signal: AbortSignal | undefined;
    let resolve: (() => void) | undefined;
    const send = vi.fn((_event: WebsiteEvent, jobSignal: AbortSignal) => {
      signal = jobSignal;
      return new Promise<void>((done) => {
        resolve = done;
      });
    });
    const boundary = createConsentAnalytics(
      { id: "local-test", disclosure: "v1", send },
      () => now,
    );
    boundary.setConsent(providerConsent());
    boundary.track({ name: "download_click" });
    boundary.track({ name: "practice_start", practice: "account-settings" });
    boundary.setConsent(createConsent(false, now));
    expect(signal?.aborted).toBe(true);
    resolve?.();
    await Promise.resolve();
    boundary.track({ name: "download_click" });
    expect(send).toHaveBeenCalledOnce();
    boundary.dispose();
  });
  it("bounds queued events and prevents further sends after disposal", async () => {
    let releaseFirst: (() => void) | undefined;
    let sent = 0;
    const send = vi.fn((_event: WebsiteEvent, _signal: AbortSignal) => {
      sent++;
      return sent === 1
        ? new Promise<void>((resolve) => {
            releaseFirst = resolve;
          })
        : Promise.resolve();
    });
    const boundary = createConsentAnalytics(
      { id: "local-test", disclosure: "v1", send },
      () => now,
    );
    boundary.setConsent(providerConsent());
    for (let i = 0; i < 100; i++) boundary.track({ name: "download_click" });
    expect(send).toHaveBeenCalledOnce();
    releaseFirst?.();
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(17));
    boundary.dispose();
    boundary.track({ name: "download_click" });
    expect(send).toHaveBeenCalledTimes(17);
  });
  it("switches account-scoped providers without replaying old queued events or letting stale cleanup remove the current owner", async () => {
    let finish!: () => void;
    let oldSignal: AbortSignal | undefined;
    const previous = vi.fn((_event: WebsiteEvent, signal: AbortSignal) => {
      oldSignal = signal;
      return new Promise<void>((resolve) => {
        finish = resolve;
      });
    });
    const current = vi.fn(async () => {});
    const boundary = createConsentAnalytics(null, () => now);
    boundary.setConsent(providerConsent());
    const disposePrevious = boundary.setProvider({
      id: "local-test",
      disclosure: "v1",
      send: previous,
    });
    boundary.track({ name: "page_view", page: "account" });
    boundary.track({ name: "onboarding_complete" });
    const disposeCurrent = boundary.setProvider({
      id: "local-test",
      disclosure: "v1",
      send: current,
    });
    expect(oldSignal?.aborted).toBe(true);
    disposePrevious();
    finish();
    await Promise.resolve();
    expect(previous).toHaveBeenCalledOnce();
    expect(current).not.toHaveBeenCalled();
    boundary.track({ name: "store_listing_opened", browser: "firefox" });
    await vi.waitFor(() => expect(current).toHaveBeenCalledOnce());
    boundary.setConsent(providerConsent());
    disposeCurrent();
    boundary.track({ name: "page_view", page: "account" });
    expect(current).toHaveBeenCalledOnce();
    expect(
      sanitizeWebsiteEvent({ name: "mode_activated", mode: "paid-cloud" }),
    ).toBeNull();
    boundary.dispose();
  });
});
