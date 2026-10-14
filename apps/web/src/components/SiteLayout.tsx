import { useEffect, useState, type ReactNode } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Menu, Xmark } from "iconoir-react";
import { SiteLink, useRouter } from "../app/router";
import { useAccount } from "../features/account/session";
export function SiteLayout({ children }: { children: ReactNode }) {
  const { path } = useRouter(),
    { account } = useAccount();
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
        to="/about"
        aria-current={path === "/about" ? "page" : undefined}
      >
        About
      </SiteLink>
      <SiteLink to={account ? "/welcome" : "/signin"}>
        {account ? "Welcome" : "Sign in"}
      </SiteLink>
      {!account && (
        <SiteLink to="/signup" className="web-primary">
          Get started
        </SiteLink>
      )}
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
            </Dialog.Popup>
          </Dialog.Portal>
        </Dialog.Root>
      </header>
      <main id="main-content" key={path} className="web-main">
        {children}
      </main>
      <footer className="web-footer">
        <img
          src="/media/tholi_brand_logo.png"
          alt="Tholi"
          width="72"
          height="29"
        />
        <span>Find your way forward.</span>
        <div>
          <SiteLink to="/about">About and privacy</SiteLink>
          <SiteLink to="/download">Download and setup</SiteLink>
          <a href="https://github.com/Sammieblz/web-navigator">Source</a>
        </div>
        <small>Local preview · Mock accounts · No analytics</small>
      </footer>
    </>
  );
}
