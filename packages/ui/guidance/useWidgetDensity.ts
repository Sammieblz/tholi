import { useLayoutEffect, useState, type RefObject } from "react";
import { widgetDensity, type WidgetDensity } from "../widget-density";

export function useWidgetDensity(
  root: RefObject<HTMLElement | null>,
  widget?: boolean,
) {
  const [density, setDensity] = useState<WidgetDensity>(() =>
    widget ? widgetDensity(innerWidth, innerHeight) : "expanded",
  );
  useLayoutEffect(() => {
    if (!widget) return;
    const update = () => {
      setDensity((previous) =>
        widgetDensity(
          root.current?.clientWidth || innerWidth,
          root.current?.clientHeight || innerHeight,
          previous,
        ),
      );
    };
    const observer =
      typeof ResizeObserver === "undefined"
        ? undefined
        : new ResizeObserver(update);
    if (root.current) observer?.observe(root.current);
    window.addEventListener("resize", update);
    update();
    return () => {
      observer?.disconnect();
      window.removeEventListener("resize", update);
    };
  }, [widget, root]);
  return density;
}
