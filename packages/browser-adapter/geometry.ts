export interface PresentedRect {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
}
export class GeometrySnapshot {
  private styles = new Map<Element, CSSStyleDeclaration>();
  private rectangles = new Map<Element, DOMRect>();
  style(element: Element) {
    let style = this.styles.get(element);
    if (!style) this.styles.set(element, (style = getComputedStyle(element)));
    return style;
  }
  rect(element: Element) {
    let rect = this.rectangles.get(element);
    if (!rect)
      this.rectangles.set(element, (rect = element.getBoundingClientRect()));
    return rect;
  }
}
export function fullyUnclipped(
  element: Element,
  snapshot = new GeometrySnapshot(),
) {
  const rect = snapshot.rect(element),
    clipped = clippedRect(element, snapshot);
  return (
    !!clipped &&
    clipped.width >= rect.width - 0.5 &&
    clipped.height >= rect.height - 0.5
  );
}

// Keep document-offscreen rectangles for scroll guidance, but intersect nested
// overflow viewports. A clipped sidebar item must not paint over another region.
export function clippedRect(
  element: Element,
  snapshot = new GeometrySnapshot(),
): PresentedRect | undefined {
  const rect = snapshot.rect(element);
  let { left, top, right, bottom } = rect;
  let ancestor = element.parentElement;
  let fixed = snapshot.style(element).position === "fixed";
  while (ancestor) {
    const style = snapshot.style(ancestor);
    if (
      style.display === "none" ||
      style.visibility === "hidden" ||
      style.opacity === "0"
    )
      return;
    if (
      fixed &&
      ((style.transform !== "none" && !!style.transform) ||
        (style.perspective !== "none" && !!style.perspective) ||
        /paint|layout|strict|content/.test(style.contain))
    )
      fixed = false;
    if (
      !fixed &&
      ancestor !== element.ownerDocument.scrollingElement &&
      ancestor !== element.ownerDocument.documentElement &&
      ancestor !== element.ownerDocument.body
    ) {
      const clipsX = /^(auto|scroll|hidden|clip)$/.test(
        style.overflowX || style.overflow,
      );
      const clipsY = /^(auto|scroll|hidden|clip)$/.test(
        style.overflowY || style.overflow,
      );
      if (clipsX || clipsY) {
        const r = snapshot.rect(ancestor);
        const x = r.left + ancestor.clientLeft,
          y = r.top + ancestor.clientTop;
        if (clipsX) {
          left = Math.max(left, x);
          right = Math.min(right, x + (ancestor.clientWidth || r.width));
        }
        if (clipsY) {
          top = Math.max(top, y);
          bottom = Math.min(bottom, y + (ancestor.clientHeight || r.height));
        }
      }
    }
    ancestor =
      ancestor.parentElement ||
      ((ancestor.getRootNode() as ShadowRoot).host as
        HTMLElement | undefined) ||
      null;
  }
  if (right <= left || bottom <= top) return;
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
  };
}
