import { useEffect, useRef, useState } from "react";

/** Loops use CSS; this hook only suspends them outside the visible surface. */
export function useVisibleMotion<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [visible, setVisible] = useState(true);
  useEffect(() => {
    let intersecting = true;
    const update = () =>
      setVisible(intersecting && document.visibilityState !== "hidden");
    const observer =
      typeof IntersectionObserver === "undefined"
        ? undefined
        : new IntersectionObserver(([entry]) => {
            intersecting = entry.isIntersecting;
            update();
          });
    if (ref.current) observer?.observe(ref.current);
    document.addEventListener("visibilitychange", update);
    update();
    return () => {
      observer?.disconnect();
      document.removeEventListener("visibilitychange", update);
    };
  }, []);
  return { ref, visible };
}
