// Scroll only a freshly bound target; never click or change focus.
export function scrollTarget(
  element: HTMLElement,
  current: () => boolean = () => true,
): () => void {
  if (
    element.checkVisibility?.({
      checkOpacity: true,
      checkVisibilityCSS: true,
    }) === false
  )
    return () => {};
  let canceled = false;
  const stop = () => {
    canceled = true;
    cleanup();
  };
  const events = ["wheel", "touchstart", "pointerdown", "keydown"];
  const cleanup = () =>
    events.forEach((name) => window.removeEventListener(name, stop, true));
  events.forEach((name) =>
    window.addEventListener(name, stop, { capture: true, once: true }),
  );
  const frame = requestAnimationFrame(() => {
    cleanup();
    if (
      !canceled &&
      current() &&
      element.isConnected &&
      !element.closest('[hidden],[inert],[aria-hidden="true"]')
    )
      element.scrollIntoView?.({
        // Centering avoids fractional-pixel clipping at a scroll viewport edge.
        block: "center",
        inline: "nearest",
        behavior: "instant",
      });
  });
  return () => {
    stop();
    cancelAnimationFrame(frame);
  };
}
