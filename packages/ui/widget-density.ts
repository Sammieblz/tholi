export type WidgetDensity = "minimal" | "compact" | "standard" | "expanded";
const tiers = [
  { name: "minimal", width: 0, height: 0 },
  { name: "compact", width: 280, height: 240 },
  { name: "standard", width: 340, height: 360 },
  { name: "expanded", width: 400, height: 560 },
] as const;

/** Dimensions exclude the shell. Downgrade immediately; promotion has a buffer. */
export function widgetDensity(
  width: number,
  height: number,
  previous?: WidgetDensity,
): WidgetDensity {
  let index = 0;
  for (let i = 1; i < tiers.length; i++)
    if (width >= tiers[i].width && height >= tiers[i].height) index = i;
  if (previous) {
    const before = tiers.findIndex((t) => t.name === previous);
    if (index > before) {
      index = before;
      for (let i = before + 1; i < tiers.length; i++)
        if (width >= tiers[i].width + 12 && height >= tiers[i].height + 12)
          index = i;
    }
  }
  return tiers[index].name;
}

export const widgetLayoutActions = [
  "reset",
  "left",
  "right",
  "up",
  "down",
  "smaller",
  "larger",
] as const;
export type WidgetLayoutAction = (typeof widgetLayoutActions)[number];
