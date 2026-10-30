import { useEffect, useRef, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Menu, Xmark } from "iconoir-react";
import { SiteLink, useRouter } from "../app/router";
import { repositoryUrl, serviceApiOrigin } from "../config/project";
import { legalOperator } from "../features/legal/operator";
import websiteRelease from "../../release.json";
import { InstallLink } from "../features/downloads/downloads";
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
      ["Support", "/support"],
      ["Documentation", "/docs"],
      ["Troubleshooting", "/docs/troubleshooting"],
      ["Source code", repositoryUrl],
    ],
  },
  {
    title: "Company",
    links: [
      ["About Tholi", "/about"],
      ["ILUNỌNSEN", legalOperator.companyUrl],
      ["Contact", "/contact"],
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
  const { openCookieSettings } = usePreferences();
  const [menu, setMenu] = useState(false);
  const header = useRef<HTMLDivElement>(null);
  useEffect(() => setMenu(false), [path]);
  useEffect(() => {
    const element = header.current;
    if (!element) return;
    let previous = Math.max(0, scrollY),
      travel = 0,
      direction = 0,
      frame = 0;
    const show = () => {
      element.dataset.hidden = "false";
    };
    const update = () => {
      frame = 0;
      const current = Math.max(0, scrollY);
      const delta = current - previous;
      previous = current;
      element.dataset.scrolled = String(current > 32);
      if (current < 120 || menu || element.contains(document.activeElement)) {
        show();
        travel = 0;
        return;
      }
      if (Math.abs(delta) < 2) return;
      const next = Math.sign(delta);
      travel = next === direction ? travel + Math.abs(delta) : Math.abs(delta);
      direction = next;
      if (next < 0 && travel >= 12) show();
      else if (next > 0 && travel >= 44) element.dataset.hidden = "true";
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };
    show();
    update();
    addEventListener("scroll", onScroll, { passive: true });
    element.addEventListener("focusin", show);
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", onScroll);
      element.removeEventListener("focusin", show);
    };
  }, [path, menu]);
  const links = (
    <>
      <SiteLink
        to="/about"
        aria-current={path === "/about" ? "page" : undefined}
      >
        About
      </SiteLink>
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
      {serviceApiOrigin && (
        <SiteLink
          to="/account"
          aria-current={path === "/account" ? "page" : undefined}
        >
          Account
        </SiteLink>
      )}
    </>
  );
  return (
    <>
      <a className="skip-link" href="#main-content">
        Skip to content
      </a>
      <div ref={header} className="web-header-shell" data-hidden="false">
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
            <InstallLink className="web-primary header-install" />
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
                  <InstallLink />
                </Dialog.Popup>
              </Dialog.Portal>
            </Dialog.Root>
          </div>
        </header>
      </div>
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
              Website {websiteRelease.version} · Available on Chrome and Firefox
            </span>
          </div>
        </div>
      </footer>
      <CookieConsent />
    </>
  );
}
