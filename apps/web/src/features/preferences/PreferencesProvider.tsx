import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { createConsentAnalytics, type WebsiteEvent } from "./analytics";
import {
  browserCookies,
  createConsent,
  deleteThemeCookie,
  readWebsitePreferences,
  saveWebsitePreferences,
  writeThemeCookie,
  type ConsentRecord,
  type WebsiteTheme,
  type CookieAccess,
} from "./cookies";

interface PreferencesContextValue {
  theme: WebsiteTheme;
  setTheme(theme: WebsiteTheme): void;
  toggleTheme(): void;
  consent: ConsentRecord | null;
  storageAvailable: boolean;
  choosePreferences(allowed: boolean): void;
  settingsOpen: boolean;
  openCookieSettings(): void;
  closeCookieSettings(): void;
  trackEvent(event: WebsiteEvent): void;
}
const PreferencesContext = createContext<PreferencesContextValue | null>(null);

export function PreferencesProvider({
  children,
  cookieAccess,
}: {
  children: ReactNode;
  cookieAccess?: CookieAccess;
}) {
  const [cookies] = useState(() => cookieAccess ?? browserCookies());
  const [initial] = useState(() => readWebsitePreferences(cookies));
  const [theme, updateTheme] = useState<WebsiteTheme>(initial.theme);
  const [consent, updateConsent] = useState(initial.consent);
  const [storageAvailable, setStorageAvailable] = useState(
    initial.storageAvailable,
  );
  const [settingsOpen, setSettingsOpen] = useState(false);
  // No app provider, environment URL, script or pixel. This does not govern
  // scripts injected by the hosting platform.
  const [analytics] = useState(() => createConsentAnalytics());

  useEffect(() => {
    document.documentElement.dataset.tholiTheme = theme;
    document.documentElement.style.colorScheme = theme;
    document
      .querySelector('meta[name="theme-color"]')
      ?.setAttribute("content", theme === "light" ? "#faf7f0" : "#101c17");
  }, [theme]);
  useEffect(() => {
    analytics.setConsent(consent);
    if (!consent?.preferences) deleteThemeCookie(cookies);
    if (!consent) return;
    let timer: ReturnType<typeof setTimeout>;
    const checkExpiry = () => {
      const remaining = consent.expiresAt - Date.now();
      if (remaining <= 0) {
        analytics.setConsent(null);
        deleteThemeCookie(cookies);
        updateConsent(null);
      } else
        timer = setTimeout(checkExpiry, Math.min(remaining, 2_147_000_000));
    };
    checkExpiry();
    return () => clearTimeout(timer);
  }, [analytics, consent, cookies]);
  useEffect(() => () => analytics.dispose(), [analytics]);

  const setTheme = (next: WebsiteTheme) => {
    if (next !== "light" && next !== "dark") return;
    updateTheme(next);
    if (consent?.preferences && !writeThemeCookie(cookies, next, consent))
      setStorageAvailable(false);
  };
  const choosePreferences = (allowed: boolean) => {
    // Preferences consent cannot opt anyone into a future analytics provider.
    const next = createConsent(allowed);
    analytics.setConsent(next);
    updateConsent(next);
    setStorageAvailable(saveWebsitePreferences(cookies, next, theme));
    setSettingsOpen(false);
  };
  return (
    <PreferencesContext.Provider
      value={{
        theme,
        setTheme,
        toggleTheme: () => setTheme(theme === "dark" ? "light" : "dark"),
        consent,
        storageAvailable,
        choosePreferences,
        settingsOpen,
        openCookieSettings: () => setSettingsOpen(true),
        closeCookieSettings: () => setSettingsOpen(false),
        trackEvent: analytics.track,
      }}
    >
      {children}
    </PreferencesContext.Provider>
  );
}

export function usePreferences(): PreferencesContextValue {
  const value = useContext(PreferencesContext);
  if (!value)
    throw new Error("Website preferences require PreferencesProvider");
  return value;
}
