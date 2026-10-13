import type { NavigationAction } from "../../../packages/navigation-core/navigation-actions";
let revision = 0;
let visual: HTMLElement | undefined;
let notify: (() => void) | undefined;
export function onVisualInvalidation(callback: () => void) {
  notify = callback;
}
export function clearVisual() {
  visual?.remove();
  visual = undefined;
}
const invalidate = () => {
  revision++;
  clearVisual();
  notify?.();
};
for (const event of [
  "scroll",
  "resize",
  "click",
  "input",
  "keydown",
  "focusin",
])
  window.addEventListener(event, invalidate, true);
const own = (node: Node) =>
  node instanceof Element &&
  (node.id === "navigator-visual-suggestion" ||
    node.id === "internet-navigator-overlay" ||
    !!node.closest("#internet-navigator-overlay,#navigator-visual-suggestion"));
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
observer.observe(document.documentElement, {
  subtree: true,
  childList: true,
  attributes: true,
  characterData: true,
});
export function captureMetadata(allowedFrameUrls: string[] = []) {
  const masks: { x: number; y: number; width: number; height: number }[] = [];
  const walk = (root: Document | ShadowRoot) => {
    for (const element of root.querySelectorAll(
      "input,textarea,[contenteditable],iframe",
    )) {
      if (
        element instanceof HTMLIFrameElement &&
        allowedFrameUrls.includes(element.src)
      )
        continue;
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
  const overlay = document.getElementById("internet-navigator-overlay");
  if (overlay) overlay.style.visibility = "hidden";
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
  const overlay = document.getElementById("internet-navigator-overlay");
  if (overlay) overlay.style.visibility = "";
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
