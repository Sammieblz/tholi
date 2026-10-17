import { useEffect } from "react";

/** Reveal the page thumb on real scroll intent, without moving page content. */
export function useScrollIntent() {
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout>;
    const reveal = () => {
      document.documentElement.dataset.webScrollIntent = "true";
      clearTimeout(timer);
      timer = setTimeout(
        () => delete document.documentElement.dataset.webScrollIntent,
        1200,
      );
    };
    const keyboard = (event: KeyboardEvent) => {
      if (
        [
          "ArrowDown",
          "ArrowUp",
          "PageDown",
          "PageUp",
          "Home",
          "End",
          " ",
        ].includes(event.key)
      )
        reveal();
    };
    const pointer = (event: PointerEvent) => {
      if (event.clientX >= innerWidth - 20) reveal();
    };
    addEventListener("scroll", reveal, { passive: true });
    addEventListener("wheel", reveal, { passive: true });
    addEventListener("touchmove", reveal, { passive: true });
    addEventListener("keydown", keyboard);
    addEventListener("pointermove", pointer, { passive: true });
    return () => {
      clearTimeout(timer);
      removeEventListener("scroll", reveal);
      removeEventListener("wheel", reveal);
      removeEventListener("touchmove", reveal);
      removeEventListener("keydown", keyboard);
      removeEventListener("pointermove", pointer);
      delete document.documentElement.dataset.webScrollIntent;
    };
  }, []);
}
