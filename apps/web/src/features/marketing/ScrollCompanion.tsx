import { useEffect, useRef } from "react";
import { Wayfinder } from "../../../../../packages/ui/WayfinderMark";

/** Decorative only. Lives in the empty outer gutter and never captures pointer input. */
export function ScrollCompanion() {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node || CSS.supports("animation-timeline", "scroll(root block)"))
      return;
    const media = matchMedia(
      "(min-width: 1100px) and (prefers-reduced-motion: no-preference)",
    );
    let frame = 0;
    const paint = () => {
      frame = 0;
      if (!media.matches || document.hidden) return;
      const range = document.documentElement.scrollHeight - innerHeight;
      const progress = Math.max(0, Math.min(1, scrollY / Math.max(1, range)));
      node.style.transform = `translate3d(${Math.sin(progress * Math.PI * 4) * 7}px,${innerHeight * (0.21 + progress * 0.95)}px,0)`;
      node.style.opacity = String(
        progress > 0.92 ? Math.max(0, (1 - progress) / 0.08) : 1,
      );
    };
    const schedule = () => {
      if (!frame) frame = requestAnimationFrame(paint);
    };
    addEventListener("scroll", schedule, { passive: true });
    addEventListener("resize", schedule);
    document.addEventListener("visibilitychange", schedule);
    media.addEventListener("change", schedule);
    schedule();
    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("scroll", schedule);
      removeEventListener("resize", schedule);
      document.removeEventListener("visibilitychange", schedule);
      media.removeEventListener("change", schedule);
    };
  }, []);
  return (
    <div className="scroll-companion" ref={ref} aria-hidden="true">
      <Wayfinder state="idle" animate={false} />
    </div>
  );
}
