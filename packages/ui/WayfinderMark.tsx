import { useId, useLayoutEffect, useState } from "react";
import { useVisibleMotion } from "./motion/useVisibleMotion";
import {
  wayfinderMarkup,
  wayfinderStyles,
  updateWayfinder,
  type WayfinderState,
} from "./wayfinder";

export function Wayfinder({
  state = "idle",
  animate = true,
  className = "",
}: {
  state?: WayfinderState;
  animate?: boolean;
  className?: string;
}) {
  const id = useId();
  const { ref, visible } = useVisibleMotion<HTMLSpanElement>();
  const [markup] = useState(() =>
    wayfinderMarkup({ state, instance: id, animate: false }),
  );
  useLayoutEffect(() => {
    const marker = ref.current?.querySelector<HTMLElement>(".tholi-wayfinder");
    if (marker) updateWayfinder(marker, state, animate && visible);
  }, [state, animate, visible]);
  return (
    <span
      ref={ref}
      className={"tholi-wayfinder-host " + className}
      aria-hidden="true"
    >
      <style>{wayfinderStyles}</style>
      <span
        dangerouslySetInnerHTML={{
          __html: markup,
        }}
      />
    </span>
  );
}
