import { useEffect } from "react";
export function useSectionReveal(path: string) {
  useEffect(() => {
    if (
      path !== "/" ||
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
          if (document.documentElement.dataset.input !== "keyboard")
            animations.push(
              entry.target.animate(
                [
                  { opacity: 0.3, transform: "translateY(16px)" },
                  { opacity: 1, transform: "translateY(0)" },
                ],
                { duration: 600, easing: "cubic-bezier(0.23,1,0.32,1)" },
              ),
            );
        }
      },
      { threshold: 0.12 },
    );
    document
      .querySelectorAll(".web-main > section:not(.hero)")
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
