import { useEffect } from "react";

/** Marketing enhancement only: content stays readable without animation JS. */
export function useSectionReveal(path: string) {
  useEffect(() => {
    if (!["/", "/about", "/download", "/support"].includes(path)) return;
    const root = document.getElementById("main-content");
    if (!root) return;
    let canceled = false;
    let dispose = () => {};
    void Promise.all([import("gsap"), import("gsap/ScrollTrigger")])
      .then(([{ gsap }, { ScrollTrigger }]) => {
        if (canceled) return;
        gsap.registerPlugin(ScrollTrigger);
        const media = gsap.matchMedia();
        media.add("(prefers-reduced-motion: no-preference)", () => {
          const observed = new Set<HTMLElement>();
          const context = gsap.context(() => {}, root);
          let keyboard = document.documentElement.dataset.input === "keyboard";
          const finish = () => {
            keyboard = true;
            context.revert();
          };
          const onFocus = () => {
            if (document.documentElement.dataset.input === "keyboard") finish();
          };
          const onKey = (event: KeyboardEvent) => {
            if (
              [
                "Tab",
                "ArrowDown",
                "ArrowUp",
                "PageDown",
                "PageUp",
                "Home",
                "End",
                " ",
              ].includes(event.key)
            )
              finish();
          };
          const observe = () => {
            if (keyboard) return;
            context.add(() => {
              root
                .querySelectorAll<HTMLElement>(
                  "[data-reveal], .install-grid > li",
                )
                .forEach((element) => {
                  if (
                    observed.has(element) ||
                    element.parentElement?.closest("[data-reveal]")
                  )
                    return;
                  observed.add(element);
                  const column =
                    element.dataset.reveal === "sequence"
                      ? Array.from(
                          element.parentElement?.children || [],
                        ).indexOf(element)
                      : 0;
                  const candidates = Array.from(
                    element.querySelectorAll<HTMLElement>(
                      "h1, h2, h3, p, .eyebrow, .step-number, .install-number, details, .web-primary, .web-secondary, .web-text-link, [data-reveal-part]",
                    ),
                  );
                  // Animate complete reading blocks, never individual words or
                  // nested descendants of an already animated block.
                  const parts =
                    element.dataset.reveal === "surface"
                      ? [element]
                      : element.dataset.reveal === "media"
                        ? (Array.from(element.children) as HTMLElement[])
                        : candidates.filter(
                            (part) =>
                              !candidates.some(
                                (parent) =>
                                  parent !== part && parent.contains(part),
                              ),
                          );
                  (parts.length ? parts : [element]).forEach((part, index) => {
                    gsap.fromTo(
                      part,
                      { opacity: 0, y: part.matches("h1, h2, h3") ? 40 : 32 },
                      {
                        opacity: 1,
                        y: 0,
                        duration: 1.1,
                        delay:
                          (Math.min(index, 3) + Math.max(column, 0)) * 0.08,
                        ease: "power2.out",
                        clearProps: "opacity,transform",
                        scrollTrigger: {
                          // Each block has its own entrance: tall sections and
                          // mobile columns unfold as the reader reaches them.
                          trigger: part,
                          start: "top 90%",
                          once: true,
                        },
                      },
                    );
                  });
                });
            });
          };
          // Lazy routes commit after App's effect; discover their content too.
          const observer = new MutationObserver(observe);
          observer.observe(root, { childList: true, subtree: true });
          addEventListener("keydown", onKey);
          root.addEventListener("focusin", onFocus);
          observe();
          return () => {
            observer.disconnect();
            removeEventListener("keydown", onKey);
            root.removeEventListener("focusin", onFocus);
            context.revert();
          };
        });
        dispose = () => media.revert();
      })
      .catch(() => {
        // Animation availability never gates content or navigation.
      });
    return () => {
      canceled = true;
      dispose();
    };
  }, [path]);
}
