import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { HalfMoon, SunLight, Xmark } from "iconoir-react";
import { usePreferences } from "./PreferencesProvider";
import { SiteLink } from "../../app/router";
import "./preferences.css";

export function ThemeToggle() {
  const { theme, toggleTheme } = usePreferences();
  return (
    <button
      type="button"
      className="web-theme-toggle"
      onClick={toggleTheme}
      aria-label={`Switch to ${theme === "dark" ? "light" : "dark"} mode`}
    >
      {theme === "dark" ? (
        <SunLight aria-hidden="true" width={18} />
      ) : (
        <HalfMoon aria-hidden="true" width={18} />
      )}
      <span>{theme === "dark" ? "Light" : "Dark"}</span>
    </button>
  );
}

export function CookieConsent() {
  const {
    consent,
    storageAvailable,
    choosePreferences,
    settingsOpen,
    openCookieSettings,
    closeCookieSettings,
  } = usePreferences();
  const [preferences, setPreferences] = useState(false);
  const banner = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const element = banner.current;
    if (!element) return;
    const root = document.documentElement;
    const previous = root.style.getPropertyValue("--web-cookie-space");
    let last = "";
    const measure = () => {
      // Keep the last footer links reachable without requiring a choice.
      const value = `${Math.ceil(Math.max(0, innerHeight - element.getBoundingClientRect().top) + 16)}px`;
      if (value !== last) {
        last = value;
        root.style.setProperty("--web-cookie-space", value);
      }
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(measure);
    observer?.observe(element);
    addEventListener("resize", measure);
    measure();
    return () => {
      observer?.disconnect();
      removeEventListener("resize", measure);
      if (previous) root.style.setProperty("--web-cookie-space", previous);
      else root.style.removeProperty("--web-cookie-space");
    };
  }, [consent, settingsOpen]);
  useEffect(() => {
    if (settingsOpen) setPreferences(consent?.preferences ?? false);
  }, [settingsOpen, consent]);
  return (
    <>
      {!consent && !settingsOpen && (
        <section
          ref={banner}
          className="cookie-banner"
          aria-label="Cookie choices"
        >
          <div className="cookie-banner-copy">
            <strong>A little choice about your browser.</strong>
            <p>
              Allow a cookie to remember your appearance, or keep essentials
              only. On tholi.io, Cloudflare measurements run separately.{" "}
              <SiteLink to="/cookies">About cookies</SiteLink>
            </p>
          </div>
          <div className="cookie-banner-actions">
            <button type="button" onClick={() => choosePreferences(false)}>
              Essential only
            </button>
            <button type="button" onClick={() => choosePreferences(true)}>
              Allow preferences
            </button>
            <button type="button" onClick={openCookieSettings}>
              Settings
            </button>
          </div>
        </section>
      )}
      <Dialog.Root
        open={settingsOpen}
        onOpenChange={(open) => {
          if (!open) closeCookieSettings();
        }}
      >
        <Dialog.Portal>
          <Dialog.Backdrop className="cookie-backdrop" />
          <Dialog.Popup className="cookie-dialog">
            <div className="cookie-dialog-heading">
              <Dialog.Title>Cookie settings</Dialog.Title>
              <Dialog.Close
                className="icon-button"
                aria-label="Close cookie settings"
              >
                <Xmark aria-hidden="true" />
              </Dialog.Close>
            </div>
            <Dialog.Description>
              You can use every part of this website with essential cookies
              only. Your choice lasts 180 days and can be changed here.
            </Dialog.Description>
            <div className="cookie-category">
              <div>
                <strong>Essential</strong>
                <p>
                  Remembers your cookie choices. Does not identify or sign you
                  in.
                </p>
              </div>
              <span className="cookie-category-state">Always on</span>
            </div>
            <label className="cookie-category cookie-preference">
              <div>
                <strong>Appearance preferences</strong>
                <p>
                  Remembers Light or Dark on this browser. If off, appearance
                  changes last on the open page only.
                </p>
              </div>
              <input
                type="checkbox"
                checked={preferences}
                onChange={(event) => setPreferences(event.target.checked)}
              />
            </label>
            <div className="cookie-category">
              <div>
                <strong>Website measurements</strong>
                <p>
                  On tholi.io, Cloudflare measures page views and performance
                  independently of these cookie choices. The app’s own optional
                  analytics provider is inactive.
                </p>
              </div>
              <span className="cookie-category-state">See notice</span>
            </div>
            {!storageAvailable && (
              <p className="cookie-storage-note" role="status">
                This browser is blocking cookie storage. Choices and appearance
                still work in memory on this open page.
              </p>
            )}
            <p className="cookie-dialog-links">
              <SiteLink to="/cookies" onClick={closeCookieSettings}>
                Cookie details
              </SiteLink>
              <SiteLink to="/privacy" onClick={closeCookieSettings}>
                Privacy notice
              </SiteLink>
            </p>
            <div className="cookie-dialog-actions">
              <button type="button" onClick={() => choosePreferences(false)}>
                Essential only
              </button>
              <button
                type="button"
                onClick={() => choosePreferences(preferences)}
              >
                Save choices
              </button>
            </div>
          </Dialog.Popup>
        </Dialog.Portal>
      </Dialog.Root>
    </>
  );
}
