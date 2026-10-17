import { useEffect } from "react";
export function useSectionReveal(path: string) {
  useEffect(() => {
    if (
      !["/", "/about", "/download"].includes(path) ||
      matchMedia("(prefers-reduced-motion: reduce)").matches ||
      !window.IntersectionObserver
    )
      return;
    const animations: Animation[] = [];
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (!entry.isIntersecting) continue;
          observer.unobserve(entry.target);
          if (document.documentElement.dataset.input !== "keyboard") {
            const kind = (entry.target as HTMLElement).dataset.reveal;
            const index = Array.from(
              entry.target.parentElement?.children || [],
            ).indexOf(entry.target);
            const media = kind === "media";
            animations.push(
              entry.target.animate(
                [
                  {
                    opacity: media ? 0.6 : 0.3,
                    transform: media
                      ? "translateY(10px) scale(.99)"
                      : "translateY(12px)",
                  },
                  { opacity: 1, transform: "translateY(0) scale(1)" },
                ],
                {
                  duration: media ? 500 : 380,
                  delay: kind === "sequence" ? Math.max(0, index) * 65 : 0,
                  easing:
                    getComputedStyle(document.documentElement)
                      .getPropertyValue("--ease-out")
                      .trim() || "ease-out",
                },
              ),
            );
          }
        }
      },
      { threshold: 0.12 },
    );
    document
      .querySelectorAll("[data-reveal], .install-grid > li")
      .forEach((section) => observer.observe(section));
    const preference = matchMedia("(prefers-reduced-motion: reduce)");
    const reduce = () => {
      if (preference.matches) {
        observer.disconnect();
        animations.forEach((animation) => animation.cancel());
      }
    };
    preference.addEventListener("change", reduce);
    return () => {
      preference.removeEventListener("change", reduce);
      observer.disconnect();
      animations.forEach((animation) => animation.cancel());
    };
  }, [path]);
}
