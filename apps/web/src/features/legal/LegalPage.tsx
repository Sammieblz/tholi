import { SiteLink } from "../../app/router";
import { usePreferences } from "../preferences";
import {
  cookieSections,
  privacySections,
  termsSections,
  type LegalPageName,
} from "./content";
import "./legal.css";
import { legalOperator } from "./operator";
export type { LegalPageName } from "./content";
export function LegalPage({
  page,
  onCookieSettings,
}: {
  page: LegalPageName;
  onCookieSettings?: () => void;
}) {
  const { openCookieSettings } = usePreferences();
  const titles = {
    privacy: "Your information, in plain sight.",
    terms: "A clear understanding.",
    cookies: "Small files. Clear choices.",
  };
  const labels = {
    privacy: "Privacy notice",
    terms: "Terms of use",
    cookies: "Cookie notice",
  };
  const sections =
    page === "privacy"
      ? privacySections()
      : page === "terms"
        ? termsSections()
        : cookieSections(onCookieSettings || openCookieSettings);
  return (
    <article className="legal-page">
      <header className="legal-header">
        <p className="eyebrow">{labels[page]}</p>
        <h1>{titles[page]}</h1>
        <p className="web-intro">
          A Tholi-specific record of how the website and extension preview work,
          what stays on your device and where your choices apply.
        </p>
        <div className="legal-draft-note">
          <strong>Publication and review</strong>
          <p>
            Updated {legalOperator.reviewed}. Tholi’s website is published at{" "}
            <a href={legalOperator.publicOrigin}>
              {legalOperator.publicOrigin}
            </a>{" "}
            and hosted on Cloudflare Pages. Professional legal review remains
            pending.
          </p>
        </div>
      </header>
      <div className="legal-body">
        <nav className="legal-contents" aria-label={`${labels[page]} contents`}>
          <p>In this notice</p>
          <ol>
            {sections.map((section) => (
              <li key={section.id}>
                <SiteLink to={`#${section.id}`}>{section.title}</SiteLink>
              </li>
            ))}
          </ol>
          <div className="legal-related">
            <SiteLink
              to="/privacy"
              aria-current={page === "privacy" ? "page" : undefined}
            >
              Privacy
            </SiteLink>
            <SiteLink
              to="/terms"
              aria-current={page === "terms" ? "page" : undefined}
            >
              Terms
            </SiteLink>
            <SiteLink
              to="/cookies"
              aria-current={page === "cookies" ? "page" : undefined}
            >
              Cookies
            </SiteLink>
          </div>
        </nav>
        <div className="legal-prose">
          {sections.map((section) => (
            <section key={section.id} aria-labelledby={section.id}>
              <h2 id={section.id}>
                {section.title}
                <SiteLink
                  to={`#${section.id}`}
                  className="legal-heading-link"
                  aria-label={`Link to ${section.title}`}
                >
                  <span aria-hidden="true">#</span>
                </SiteLink>
              </h2>
              {section.children}
            </section>
          ))}
        </div>
      </div>
    </article>
  );
}
