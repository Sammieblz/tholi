import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Menu, Xmark } from "iconoir-react";
import { SiteLink, useRouter } from "../app/router";
import { useAccount } from "../features/account/session";
import {
  CookieConsent,
  ThemeToggle,
  usePreferences,
} from "../features/preferences";

const footerGroups = [
  {
    title: "Product",
    links: [
      ["Get Tholi", "/download"],
      ["Installation help", "/docs/getting-started"],
      ["Practice here", "/#practice"],
    ],
  },
  {
    title: "Learn",
    links: [
      ["Documentation", "/docs"],
      ["Troubleshooting", "/docs/troubleshooting"],
      ["Source code", "https://github.com/Sammieblz/web-navigator"],
    ],
  },
  {
    title: "Company",
    links: [
      ["About Tholi", "/about"],
      ["ILUNỌNSEN", "https://ilunonsen.com"],
      ["Contact", "mailto:info@ilunonsen.com"],
    ],
  },
  {
    title: "Privacy & legal",
    links: [
      ["Privacy", "/privacy"],
      ["Terms", "/terms"],
      ["Cookies", "/cookies"],
    ],
  },
];
export function SiteLayout({ children }: { children: ReactNode }) {
  const { path } = useRouter();
  const { account } = useAccount();
  const { openCookieSettings } = usePreferences();
  const [menu, setMenu] = useState(false);
  useEffect(() => setMenu(false), [path]);
  const links = (
    <>
      <SiteLink
        to="/download"
        aria-current={path === "/download" ? "page" : undefined}
      >
        Get Tholi
      </SiteLink>
      <SiteLink
        to="/docs"
        aria-current={path.startsWith("/docs") ? "page" : undefined}
      >
        Docs
      </SiteLink>
      <SiteLink
        to="/about"
        aria-current={path === "/about" ? "page" : undefined}
      >
        About
      </SiteLink>
      <SiteLink to={account ? "/welcome" : "/signin"}>
        {account ? "Welcome" : "Sign in"}
      </SiteLink>
    </>
  );
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <header className="web-header">
        <SiteLink to="/" className="brand-link" aria-label="Tholi home">
          <img
            className="web-logo"
            src="/media/tholi_brand_logo.png"
            alt="Tholi"
            width="112"
            height="45"
          />
        </SiteLink>
        <nav aria-label="Main navigation">{links}</nav>
        <div className="header-actions">
          <ThemeToggle />
          <SiteLink to="/download" className="web-primary header-install">
            Get the preview
          </SiteLink>
          <Dialog.Root open={menu} onOpenChange={setMenu}>
            <Dialog.Trigger
              className="mobile-menu icon-button"
              aria-label="Open navigation"
            >
              <Menu aria-hidden="true" />
            </Dialog.Trigger>
            <Dialog.Portal>
              <Dialog.Backdrop className="web-backdrop" />
              <Dialog.Popup className="web-mobile-dialog">
                <Dialog.Title>Explore Tholi</Dialog.Title>
                <Dialog.Close
                  className="icon-button"
                  aria-label="Close navigation"
                >
                  <Xmark aria-hidden="true" />
                </Dialog.Close>
                {links}
                <SiteLink to="/signup" className="web-primary">
                  Try a demo account
                </SiteLink>
              </Dialog.Popup>
            </Dialog.Portal>
          </Dialog.Root>
        </div>
      </header>
      <main id="main-content" key={path} className="web-main">
        {children}
      </main>
      <footer className="web-footer">
        <div className="footer-inner">
          <div className="footer-intro">
            <SiteLink to="/" aria-label="Tholi home">
              <img
                src="/media/tholi_brand_logo.png"
                alt="Tholi"
                width="108"
                height="44"
              />
            </SiteLink>
            <p>
              A little direction.
              <br />A more familiar web.
            </p>
            <span>
              Made by <a href="https://ilunonsen.com">ILUNỌNSEN LLC</a>
              <br />
              Ohio, United States
            </span>
          </div>
          <div className="footer-groups">
            {footerGroups.map((group) => (
              <div key={group.title}>
                <h2>{group.title}</h2>
                {group.links.map(([label, href]) =>
                  href.startsWith("/") ? (
                    <SiteLink key={href} to={href}>
                      {label}
                    </SiteLink>
                  ) : (
                    <a key={href} href={href}>
                      {label}
                    </a>
                  ),
                )}
                {group.title === "Privacy & legal" && (
                  <button
                    className="footer-settings"
                    onClick={openCookieSettings}
                  >
                    Cookie settings
                  </button>
                )}
              </div>
            ))}
          </div>
          <div className="footer-bottom">
            <small>
              © {new Date().getFullYear()} ILUNỌNSEN LLC. Tholi software is MIT
              licensed.
            </small>
            <span>
              Local website preview · Mock accounts · Analytics inactive
            </span>
          </div>
        </div>
      </footer>
      <CookieConsent />
    </>
  );
}
