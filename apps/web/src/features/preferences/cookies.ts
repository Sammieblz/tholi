export type WebsiteTheme = "dark" | "light";
export const CONSENT_COOKIE = "tholi_consent";
export const THEME_COOKIE = "tholi_theme";
export const CONSENT_VERSION = 1;
export const CONSENT_LIFETIME = 180 * 24 * 60 * 60 * 1000;

export interface AnalyticsConsent {
  provider: string;
  disclosure: string;
  allowed: boolean;
}
export interface ConsentRecord {
  version: typeof CONSENT_VERSION;
  savedAt: number;
  expiresAt: number;
  preferences: boolean;
  analytics: AnalyticsConsent | null;
}
export interface CookieAccess {
  read(): string;
  write(value: string): void;
  secure: boolean;
}

export function browserCookies(): CookieAccess {
  return {
    read: () => document.cookie,
    write: (value) => {
      document.cookie = value;
    },
    secure: location.protocol === "https:",
  };
}

export function cookieValue(cookies: string, name: string): string | null {
  const prefix = `${name}=`;
  const value = cookies
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(prefix));
  if (!value) return null;
  try {
    return decodeURIComponent(value.slice(prefix.length));
  } catch {
    return null;
  }
}

export function parseConsent(
  value: string | null,
  now = Date.now(),
): ConsentRecord | null {
  if (!value || value.length > 2048) return null;
  try {
    const record = JSON.parse(value) as Partial<ConsentRecord>;
    if (
      record.version !== CONSENT_VERSION ||
      typeof record.preferences !== "boolean" ||
      typeof record.savedAt !== "number" ||
      !Number.isFinite(record.savedAt) ||
      typeof record.expiresAt !== "number" ||
      !Number.isFinite(record.expiresAt) ||
      record.savedAt > now + 60_000 ||
      record.expiresAt <= now ||
      record.expiresAt <= record.savedAt ||
      record.expiresAt - record.savedAt > CONSENT_LIFETIME
    )
      return null;
    const analytics = record.analytics;
    if (
      analytics !== null &&
      (typeof analytics !== "object" ||
        !analytics ||
        typeof analytics.provider !== "string" ||
        !/^[a-z0-9-]{1,64}$/.test(analytics.provider) ||
        typeof analytics.disclosure !== "string" ||
        !/^[a-zA-Z0-9._-]{1,64}$/.test(analytics.disclosure) ||
        typeof analytics.allowed !== "boolean")
    )
      return null;
    return {
      version: CONSENT_VERSION,
      savedAt: record.savedAt,
      expiresAt: record.expiresAt,
      preferences: record.preferences,
      analytics: analytics
        ? {
            provider: analytics.provider,
            disclosure: analytics.disclosure,
            allowed: analytics.allowed,
          }
        : null,
    };
  } catch {
    return null;
  }
}

export function readWebsitePreferences(
  access: CookieAccess,
  now = Date.now(),
): {
  consent: ConsentRecord | null;
  theme: WebsiteTheme;
  storageAvailable: boolean;
} {
  try {
    const cookies = access.read();
    const consent = parseConsent(cookieValue(cookies, CONSENT_COOKIE), now);
    const storedTheme = cookieValue(cookies, THEME_COOKIE);
    return {
      consent,
      theme: consent?.preferences && storedTheme === "light" ? "light" : "dark",
      storageAvailable: true,
    };
  } catch {
    return { consent: null, theme: "dark", storageAvailable: false };
  }
}

function attributes(
  access: CookieAccess,
  expiresAt: number,
  now: number,
): string {
  return `; Path=/; SameSite=Lax; Max-Age=${Math.max(0, Math.floor((expiresAt - now) / 1000))}; Expires=${new Date(expiresAt).toUTCString()}${access.secure ? "; Secure" : ""}`;
}

export function deleteThemeCookie(access: CookieAccess): void {
  try {
    access.write(`${THEME_COOKIE}=${attributes(access, 0, 0)}`);
  } catch {
    /* Memory-only appearance remains usable. */
  }
}

export function writeThemeCookie(
  access: CookieAccess,
  theme: WebsiteTheme,
  consent: ConsentRecord | null,
  now = Date.now(),
): boolean {
  if (!consent?.preferences || consent.expiresAt <= now) {
    deleteThemeCookie(access);
    return false;
  }
  try {
    access.write(
      `${THEME_COOKIE}=${theme}${attributes(access, consent.expiresAt, now)}`,
    );
    return cookieValue(access.read(), THEME_COOKIE) === theme;
  } catch {
    return false;
  }
}

export function createConsent(
  preferences: boolean,
  now = Date.now(),
  analytics: AnalyticsConsent | null = null,
): ConsentRecord {
  return {
    version: CONSENT_VERSION,
    savedAt: now,
    expiresAt: now + CONSENT_LIFETIME,
    preferences,
    analytics,
  };
}

export function saveWebsitePreferences(
  access: CookieAccess,
  consent: ConsentRecord,
  theme: WebsiteTheme,
  now = Date.now(),
): boolean {
  if (!consent.preferences) deleteThemeCookie(access);
  try {
    access.write(
      `${CONSENT_COOKIE}=${encodeURIComponent(JSON.stringify(consent))}${attributes(access, consent.expiresAt, now)}`,
    );
    if (cookieValue(access.read(), CONSENT_COOKIE) !== JSON.stringify(consent))
      return false;
    return (
      !consent.preferences || writeThemeCookie(access, theme, consent, now)
    );
  } catch {
    return false;
  }
}
