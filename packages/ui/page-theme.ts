/** Visual page tone only. No text, field values, images, or URLs are collected. */
export type Theme = "light" | "dark";
type Color = [number, number, number, number];
export const oppositeTheme = (theme: Theme): Theme =>
  theme === "dark" ? "light" : "dark";
export function parseColor(value: string): Color | undefined {
  if (value === "transparent") return [0, 0, 0, 0];
  const rgb = value.match(
    /^rgba?\(\s*([\d.]+)[,\s]+([\d.]+)[,\s]+([\d.]+)(?:\s*[,/]\s*([\d.]+))?\s*\)$/,
  );
  if (rgb)
    return [
      Number(rgb[1]),
      Number(rgb[2]),
      Number(rgb[3]),
      rgb[4] === undefined ? 1 : Number(rgb[4]),
    ];
  // Browsers retain authored wide-gamut colors in computed styles.
  const srgb = value.match(
    /^color\(srgb\s+([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?\s*\)$/,
  );
  if (srgb)
    return [
      Number(srgb[1]) * 255,
      Number(srgb[2]) * 255,
      Number(srgb[3]) * 255,
      srgb[4] === undefined ? 1 : Number(srgb[4]),
    ];
  return undefined;
}
export function composite(foreground: Color, background: Color): Color {
  const alpha = foreground[3] + background[3] * (1 - foreground[3]);
  if (!alpha) return [0, 0, 0, 0];
  return [0, 1, 2]
    .map(
      (i) =>
        (foreground[i] * foreground[3] +
          background[i] * background[3] * (1 - foreground[3])) /
        alpha,
    )
    .concat(alpha) as Color;
}
export function luminance(color: Color) {
  const linear = color.slice(0, 3).map((c) => {
    const v = Math.max(0, Math.min(255, c)) / 255;
    return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  });
  return linear[0] * 0.2126 + linear[1] * 0.7152 + linear[2] * 0.0722;
}
export function classifyTone(samples: number[], previous?: Theme): Theme {
  const sorted = samples.filter(Number.isFinite).sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)] ?? 1;
  // Hysteresis keeps gray surfaces and color transitions from flickering.
  if (previous === "dark" && median < 0.23) return "dark";
  if (previous === "light" && median > 0.14) return "light";
  return median < 0.179 ? "dark" : "light";
}
const ownSurface = (element: Element) =>
  !!element.closest(
    "[data-tholi-ui],#internet-navigator-overlay,#navigator-visual-suggestion",
  );
export function detectPageTheme(previous?: Theme): Theme {
  const style = getComputedStyle(document.documentElement);
  const scheme = style.colorScheme || "normal";
  const darkCanvas =
    scheme === "dark" ||
    (scheme.includes("dark") &&
      scheme.includes("light") &&
      matchMedia("(prefers-color-scheme: dark)").matches);
  const canvas: Color = darkCanvas ? [18, 18, 18, 1] : [255, 255, 255, 1];
  const colors = new Map<Element, Color>();
  let converter: CanvasRenderingContext2D | null | undefined;
  const background = (element: Element): Color => {
    const cached = colors.get(element);
    if (cached) return cached;
    const css = getComputedStyle(element).backgroundColor;
    let color = parseColor(css);
    if (!color) {
      // Convert a CSS color swatch, never website pixels. Handles oklch/P3 too.
      if (converter === undefined) {
        const swatch = document.createElement("canvas");
        swatch.width = swatch.height = 1;
        converter = swatch.getContext("2d", { willReadFrequently: true });
      }
      if (converter) {
        converter.clearRect(0, 0, 1, 1);
        converter.fillStyle = css;
        converter.fillRect(0, 0, 1, 1);
        const pixel = converter.getImageData(0, 0, 1, 1).data;
        color = [pixel[0], pixel[1], pixel[2], pixel[3] / 255];
      }
    }
    color ||= [0, 0, 0, 0];
    colors.set(element, color as Color);
    return color as Color;
  };
  const samples: number[] = [];
  for (const y of [0.2, 0.5, 0.8])
    for (const x of [0.2, 0.5, 0.8]) {
      let element =
        document
          .elementsFromPoint?.(innerWidth * x, innerHeight * y)
          .find((e) => !ownSurface(e)) ||
        document.body ||
        document.documentElement;
      // Open shadow roots can hold the site's actual visible surface.
      for (let depth = 0; depth < 4 && element.shadowRoot; depth++) {
        const inner = element.shadowRoot.elementFromPoint?.(
          innerWidth * x,
          innerHeight * y,
        );
        if (!inner || inner === element) break;
        element = inner;
      }
      let color: Color = [0, 0, 0, 0];
      for (
        let depth = 0, node: Element | null = element;
        node && depth < 32;
        depth++
      ) {
        color = composite(color, background(node));
        if (color[3] >= 0.99) break;
        node =
          node.parentElement || (node.getRootNode() as ShadowRoot).host || null;
      }
      samples.push(luminance(composite(color, canvas)));
    }
  return classifyTone(samples, previous);
}
export function contrastPageTheme() {
  return oppositeTheme(detectPageTheme());
}

/** Coalesced, bounded sampling even on a page that never stops mutating. */
export function observePageTheme(changed: (theme: Theme) => void) {
  let previous: Theme | undefined,
    timer: ReturnType<typeof setTimeout> | undefined;
  const sample = () => {
    timer = undefined;
    if (document.visibilityState === "hidden") return;
    const tone = detectPageTheme(previous);
    if (tone !== previous) {
      previous = tone;
      changed(oppositeTheme(tone));
    }
  };
  const schedule = () => {
    if (!timer) timer = setTimeout(sample, 200);
  };
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) => {
        if (record.target instanceof Element && ownSurface(record.target))
          return false;
        const nodes = [...record.addedNodes, ...record.removedNodes];
        return (
          !nodes.length ||
          !nodes.every((node) => node instanceof Element && ownSurface(node))
        );
      })
    )
      schedule();
  });
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    attributeFilter: [
      "class",
      "style",
      "data-theme",
      "data-color-mode",
      "color-scheme",
      "media",
      "disabled",
      "href",
    ],
  });
  const events = [
    "scroll",
    "resize",
    "pageshow",
    "visibilitychange",
    "transitionend",
    "animationend",
    "load",
  ];
  events.forEach((event) =>
    window.addEventListener(event, schedule, { passive: true, capture: true }),
  );
  const preference = matchMedia("(prefers-color-scheme: dark)");
  preference.addEventListener("change", schedule);
  // CSSOM edits and stylesheet/media changes need not produce DOM mutations.
  const interval = setInterval(schedule, 2000);
  sample();
  return () => {
    observer.disconnect();
    clearTimeout(timer);
    clearInterval(interval);
    events.forEach((event) =>
      window.removeEventListener(event, schedule, true),
    );
    preference.removeEventListener("change", schedule);
  };
}
