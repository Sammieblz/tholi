import { SiteLayout } from "../components/SiteLayout";
import { HomePage } from "../features/marketing/HomePage";
import { SiteLink, useRouter } from "./router";
import { useInputModality } from "../../../../packages/ui/motion/useInputModality";
import { useSectionReveal } from "./useSectionReveal";
import { useScrollIntent } from "./useScrollIntent";
import { lazy, Suspense, useEffect } from "react";
import { usePreferences } from "../features/preferences";
import { usePageMetadata } from "../features/seo/usePageMetadata";
import {
  PUBLIC_PAGES,
  type PublicPage,
} from "../features/preferences/analytics";
const AboutPage = lazy(() =>
  import("../features/marketing/AboutPage").then((module) => ({
    default: module.AboutPage,
  })),
);
const DownloadPage = lazy(() =>
  import("../features/downloads/DownloadPage").then((module) => ({
    default: module.DownloadPage,
  })),
);
const OnboardingPage = lazy(() =>
  import("../features/onboarding/OnboardingPage").then((module) => ({
    default: module.OnboardingPage,
  })),
);
const DocsPage = lazy(() =>
  import("../features/docs/DocsPage").then((module) => ({
    default: module.DocsPage,
  })),
);
const LegalPage = lazy(() =>
  import("../features/legal/LegalPage").then((module) => ({
    default: module.LegalPage,
  })),
);
const SupportPage = lazy(() =>
  import("../features/support/SupportPage").then((module) => ({
    default: module.SupportPage,
  })),
);
const ContactPage = lazy(() =>
  import("../features/support/ContactPage").then((module) => ({
    default: module.ContactPage,
  })),
);
function RetiredAccountRoute() {
  const { go } = useRouter();
  useEffect(() => go("/download", { replace: true }), [go]);
  return <div role="status">Opening installation options…</div>;
}
export function App() {
  const { path } = useRouter();
  const { trackEvent } = usePreferences();
  usePageMetadata(path);
  useEffect(() => {
    const page =
      path === "/" ? "home" : path.startsWith("/docs") ? "docs" : path.slice(1);
    if (PUBLIC_PAGES.includes(page as PublicPage))
      trackEvent({ name: "page_view", page: page as PublicPage });
  }, [path, trackEvent]);
  useInputModality();
  useScrollIntent();
  useSectionReveal(path);
  const page =
    path === "/" ? (
      <HomePage />
    ) : path === "/about" ? (
      <AboutPage />
    ) : path === "/download" ? (
      <DownloadPage />
    ) : path === "/support" ? (
      <SupportPage />
    ) : path === "/contact" ? (
      <ContactPage />
    ) : ["/signin", "/signup", "/welcome"].includes(path) ? (
      <RetiredAccountRoute />
    ) : path === "/onboarding" ? (
      <OnboardingPage />
    ) : path === "/docs" || path.startsWith("/docs/") ? (
      <DocsPage slug={path.split("/")[2]} />
    ) : path === "/privacy" || path === "/terms" || path === "/cookies" ? (
      <LegalPage page={path.slice(1) as "privacy" | "terms" | "cookies"} />
    ) : (
      <section className="reading">
        <h1>This page isn’t here.</h1>
        <SiteLink to="/">Return to Tholi</SiteLink>
      </section>
    );
  return (
    <SiteLayout>
      <Suspense
        fallback={
          <div className="reading" role="status">
            Opening this page…
          </div>
        }
      >
        {page}
      </Suspense>
    </SiteLayout>
  );
}
