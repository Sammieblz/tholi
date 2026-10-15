import { SiteLayout } from "../components/SiteLayout";
import { HomePage } from "../features/marketing/HomePage";
import { AboutPage } from "../features/marketing/AboutPage";
import { DownloadPage } from "../features/downloads/DownloadPage";
import { AuthPage } from "../features/account/AuthPage";
import { WelcomePage } from "../features/account/WelcomePage";
import { OnboardingPage } from "../features/onboarding/OnboardingPage";
import { SiteLink, useRouter } from "./router";
import { useInputModality } from "../../../../packages/ui/motion/useInputModality";
import { useSectionReveal } from "./useSectionReveal";
import { useScrollIntent } from "./useScrollIntent";
export function App() {
  const { path } = useRouter();
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
    ) : path === "/signin" || path === "/signup" ? (
      <AuthPage key={path} signup={path === "/signup"} />
    ) : path === "/onboarding" ? (
      <OnboardingPage />
    ) : path === "/welcome" ? (
      <WelcomePage />
    ) : (
      <section className="reading">
        <h1>This page isn’t here.</h1>
        <SiteLink to="/">Return to Tholi</SiteLink>
      </section>
    );
  return <SiteLayout>{page}</SiteLayout>;
}
