import type { NavigationAction } from "../../../packages/navigation-core/navigation-actions";
import {
  guidanceVisible,
  onGuidanceVisibility,
} from "../../../packages/overlay-ui/presentation-gate";
let revision = 0;
let visual: HTMLElement | undefined;
let notify: (() => void) | undefined;
let stopWatching: (() => void) | undefined;
export function clearVisual() {
  visual?.remove();
  visual = undefined;
}
onGuidanceVisibility((visible) => {
  if (!visible) clearVisual();
});
const invalidate = () => {
  revision++;
  clearVisual();
  notify?.();
};
const events = ["scroll", "resize", "click", "input", "keydown", "focusin"];
const own = (node: Node) =>
  node instanceof Element &&
  (node.id === "navigator-visual-suggestion" ||
    node.id === "internet-navigator-overlay" ||
    node.hasAttribute("data-tholi-ui") ||
    !!node.closest(
      "#internet-navigator-overlay,[data-tholi-ui],#navigator-visual-suggestion",
    ));
const observer = new MutationObserver((records) => {
  if (
    records.some(
      (r) =>
        !own(r.target) &&
        !(
          r.type === "childList" &&
          [...r.addedNodes, ...r.removedNodes].length &&
          [...r.addedNodes, ...r.removedNodes].every(own)
        ),
    )
  )
    invalidate();
});
export function onVisualInvalidation(callback: () => void) {
  stopWatching?.();
  revision++;
  notify = callback;
  events.forEach((event) => window.addEventListener(event, invalidate, true));
  observer.observe(document.documentElement, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  const stop = () => {
    if (stopWatching !== stop) return;
    observer.disconnect();
    events.forEach((event) =>
      window.removeEventListener(event, invalidate, true),
    );
    notify = undefined;
    stopWatching = undefined;
    revision++;
    clearVisual();
  };
  stopWatching = stop;
  return stop;
}
export function captureMetadata() {
  const masks: { x: number; y: number; width: number; height: number }[] = [];
  const walk = (root: Document | ShadowRoot) => {
    for (const element of root.querySelectorAll(
      "input,textarea,[contenteditable],iframe",
    )) {
      // Host permission enables frame-local DOM discovery, but does not supply
      // trustworthy field-mask geometry. Keep the entire frame masked until
      // such metadata is available; permission alone must not expose editors.
      const r = element.getBoundingClientRect();
      if (r.width && r.height)
        masks.push({
          x: Math.max(0, r.x),
          y: Math.max(0, r.y),
          width: Math.min(innerWidth, r.right) - Math.max(0, r.x),
          height: Math.min(innerHeight, r.bottom) - Math.max(0, r.y),
        });
    }
    for (const element of root.querySelectorAll("*"))
      if (element.shadowRoot) walk(element.shadowRoot);
  };
  walk(document);
  document
    .querySelectorAll<HTMLElement>(
      "[data-tholi-ui],#internet-navigator-overlay",
    )
    .forEach((e) => (e.style.visibility = "hidden"));
  visual?.remove();
  visual = undefined;
  return {
    width: innerWidth,
    height: innerHeight,
    viewportRevision: revision,
    masks: masks.filter((m) => m.width > 0 && m.height > 0),
    at: Date.now(),
  };
}
export function restoreOverlay() {
  document
    .querySelectorAll<HTMLElement>(
      "[data-tholi-ui],#internet-navigator-overlay",
    )
    .forEach((e) => (e.style.visibility = ""));
}
export function viewportRevision() {
  return revision;
}
export function showVisual(
  action: NavigationAction,
  capturedRevision: number,
  capturedAt: number,
) {
  if (
    !guidanceVisible() ||
    action.kind !== "visual" ||
    revision !== capturedRevision ||
    Date.now() - capturedAt > 15000
  )
    return false;
  visual?.remove();
  visual = document.createElement("div");
  visual.id = "navigator-visual-suggestion";
  visual.setAttribute("aria-hidden", "true");
  Object.assign(visual.style, {
    position: "fixed",
    pointerEvents: "none",
    zIndex: "2147483647",
    border: "3px dashed #f0bc54",
    borderRadius: "8px",
    left: action.box.x + "px",
    top: action.box.y + "px",
    width: action.box.width + "px",
    height: action.box.height + "px",
  });
  visual.title = "Visual suggestion; action and outcome are unverified";
  document.documentElement.append(visual);
  setTimeout(() => {
    visual?.remove();
    visual = undefined;
  }, 5000);
  return true;
}
