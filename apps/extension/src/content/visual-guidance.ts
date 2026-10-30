import type { NavigationAction } from "../../../../packages/navigation-core/navigation-actions";
import {
  navigationDomViewportSchema,
  navigationViewportExtent,
} from "../../../../packages/navigation-core/contracts-navigation";
import { GeometrySnapshot } from "../../../../packages/browser-adapter/geometry";
import { isPixelPrivateElement } from "../../../../packages/privacy-redaction";
import {
  captureMetadataSchema,
  VISION_CAPTURE_LIMITS,
  type CaptureMetadata,
} from "../../../../packages/vision/contracts";
import { privacyShadowRoot } from "../platform/api";
import {
  guidanceVisible,
  onGuidanceVisibility,
} from "../../../../packages/overlay-ui/presentation-gate";
let revision = 0;
let visual: HTMLElement | undefined;
let notify: (() => void) | undefined;
let stopWatching: (() => void) | undefined;
const ownedSelector =
  "[data-tholi-ui],#internet-navigator-overlay,#navigator-visual-suggestion";
const rootObservers = new Map<Document | ShadowRoot, MutationObserver>();
let rootIds = new WeakMap<Document | ShadowRoot, number>();
let ownedIds = new WeakMap<HTMLElement, number>();
let identity = 0;
const CAPTURE_LIFETIME_MS = 15000;
const SUPPRESSION_MS = 1000;
const PRIVACY_WALK_MS = 2000;
const ROOT_LIMIT = 256;
type CaptureIdentity = Pick<
  CaptureMetadata,
  "captureId" | "scanId" | "observationRevision"
>;
type SavedStyle = { value: string; priority: string };
type Lease = {
  identity: CaptureIdentity;
  current: () => boolean;
  revision: number;
  expires: number;
  styles: Map<HTMLElement, Map<string, SavedStyle>>;
  restored: boolean;
  metadata?: CaptureMetadata;
  proof?: string;
  checking?: Promise<boolean>;
  watchdog?: ReturnType<typeof setTimeout>;
  expiry?: ReturnType<typeof setTimeout>;
  abort: AbortController;
};
let capture: Lease | undefined;
export function clearVisual() {
  visual?.remove();
  visual = undefined;
}
onGuidanceVisibility((visible) => {
  if (!visible) {
    cancelCapture();
    clearVisual();
  }
});
const invalidate = () => {
  revision++;
  cancelCapture();
  clearVisual();
  notify?.();
};
const events = [
  "scroll",
  "resize",
  "click",
  "input",
  "beforeinput",
  "change",
  "keydown",
  "focusin",
  "focusout",
  "pointerdown",
  "pointerover",
  "wheel",
  "blur",
  "focus",
  "animationstart",
  "animationiteration",
  "transitionrun",
  "transitionstart",
];
function own(node: Node) {
  let element = node instanceof Element ? node : node.parentElement;
  for (let depth = 0; element && depth < 256; depth++) {
    if (element.matches(ownedSelector)) return true;
    element =
      element.parentElement ||
      (element.getRootNode() instanceof ShadowRoot
        ? (element.getRootNode() as ShadowRoot).host
        : null);
  }
  return false;
}
function observeRoot(root: Document | ShadowRoot) {
  if (rootObservers.has(root)) return;
  if (rootObservers.size >= ROOT_LIMIT)
    throw Error("Privacy root budget exceeded.");
  const observer = new MutationObserver((records) => {
    if (
      records.some((record) => {
        const changed = [...record.addedNodes, ...record.removedNodes];
        if (capture && record.type === "childList" && changed.some(own))
          return true;
        return (
          !own(record.target) &&
          !(record.type === "childList" && changed.length && changed.every(own))
        );
      })
    )
      invalidate();
  });
  observer.observe(root, {
    subtree: true,
    childList: true,
    attributes: true,
    characterData: true,
  });
  rootObservers.set(root, observer);
  root.addEventListener("slotchange", eventInvalidated, true);
}
function unobserveRoot(root: Document | ShadowRoot) {
  rootObservers.get(root)?.disconnect();
  root.removeEventListener("slotchange", eventInvalidated, true);
  rootObservers.delete(root);
}
function eventInvalidated(event: Event) {
  if (
    (event.type.startsWith("animation") ||
      event.type.startsWith("transition")) &&
    event.target instanceof Node &&
    own(event.target)
  )
    return;
  invalidate();
}
export function onVisualInvalidation(callback: () => void) {
  stopWatching?.();
  revision++;
  notify = callback;
  events.forEach((event) =>
    window.addEventListener(event, eventInvalidated, true),
  );
  document.addEventListener("visibilitychange", eventInvalidated);
  window.visualViewport?.addEventListener("scroll", eventInvalidated);
  window.visualViewport?.addEventListener("resize", eventInvalidated);
  observeRoot(document);
  const stop = () => {
    if (stopWatching !== stop) return;
    cancelCapture();
    for (const root of rootObservers.keys()) unobserveRoot(root);
    rootIds = new WeakMap();
    ownedIds = new WeakMap();
    events.forEach((event) =>
      window.removeEventListener(event, eventInvalidated, true),
    );
    document.removeEventListener("visibilitychange", eventInvalidated);
    window.visualViewport?.removeEventListener("scroll", eventInvalidated);
    window.visualViewport?.removeEventListener("resize", eventInvalidated);
    notify = undefined;
    stopWatching = undefined;
    revision++;
    clearVisual();
  };
  stopWatching = stop;
  return stop;
}
function currentViewport() {
  const visual = window.visualViewport;
  if (!visual) throw Error("Visual viewport privacy evidence is unavailable.");
  return navigationDomViewportSchema.parse({
    width: innerWidth,
    height: innerHeight,
    scrollX,
    scrollY,
    devicePixelRatio,
    visualViewport: {
      offsetLeft: visual.offsetLeft,
      offsetTop: visual.offsetTop,
      pageLeft: visual.pageLeft,
      pageTop: visual.pageTop,
      width: visual.width,
      height: visual.height,
      scale: visual.scale,
    },
  });
}
function live(lease: Lease) {
  return (
    capture === lease &&
    lease.revision === revision &&
    performance.now() < lease.expires &&
    lease.current()
  );
}
function hideOwned(lease: Lease, element: HTMLElement) {
  if (lease.styles.has(element)) return;
  const styles = new Map<string, SavedStyle>();
  for (const property of [
    "transition-property",
    "animation-play-state",
    "opacity",
    "visibility",
  ])
    styles.set(property, {
      value: element.style.getPropertyValue(property),
      priority: element.style.getPropertyPriority(property),
    });
  lease.styles.set(element, styles);
  lease.watchdog ??= setTimeout(() => {
    if (capture === lease) cancelCapture();
  }, SUPPRESSION_MS);
  element.style.setProperty("transition-property", "none", "important");
  element.style.setProperty("animation-play-state", "paused", "important");
  element.style.setProperty("opacity", "0", "important");
  element.style.setProperty("visibility", "hidden", "important");
}
export function restoreOverlay(captureId: string) {
  const lease = capture;
  if (!lease || lease.identity.captureId !== captureId || lease.restored)
    return;
  lease.restored = true;
  clearTimeout(lease.watchdog);
  for (const [element, styles] of lease.styles) {
    for (const property of [
      "opacity",
      "visibility",
      "animation-play-state",
      "transition-property",
    ]) {
      const previous = styles.get(property)!;
      if (previous.value)
        element.style.setProperty(property, previous.value, previous.priority);
      else element.style.removeProperty(property);
    }
  }
}
export function cancelCapture() {
  const lease = capture;
  if (!lease) return;
  restoreOverlay(lease.identity.captureId);
  clearTimeout(lease.watchdog);
  clearTimeout(lease.expiry);
  capture = undefined;
  lease.abort.abort();
  if (!notify) {
    for (const root of rootObservers.keys()) unobserveRoot(root);
  }
}
type Walk = {
  viewport: CaptureMetadata["viewport"];
  masks: CaptureMetadata["masks"];
  focusRegions: CaptureMetadata["focusRegions"];
  proof: string;
};
/** One complete mask-only traversal. No field values or DOM text are read. */
async function privacySnapshot(lease: Lease): Promise<Walk> {
  const started = performance.now(),
    viewport = currentViewport(),
    extent = navigationViewportExtent(viewport),
    geometry = new GeometrySnapshot(),
    roots = new Set<Document | ShadowRoot>(),
    owners = new Set<number>(),
    masks = new Map<string, CaptureMetadata["masks"][number]>();
  const stack: {
    node: Node | null;
    private: boolean;
    unsupportedPaint: boolean;
    single?: boolean;
  }[] = [
    { node: document.documentElement, private: false, unsupportedPaint: false },
  ];
  let privatePixels = false,
    activeAnimation = false,
    backdropPaint = false;
  let focus: CaptureMetadata["masks"][number] | undefined;
  const seeRoot = (root: Document | ShadowRoot) => {
    roots.add(root);
    observeRoot(root);
    if (!rootIds.has(root)) rootIds.set(root, ++identity);
  };
  seeRoot(document);
  const rectangle = (rect: DOMRect | DOMRectReadOnly) => {
    if (
      ![
        rect.left,
        rect.top,
        rect.right,
        rect.bottom,
        rect.width,
        rect.height,
      ].every(Number.isFinite) ||
      rect.width < 0 ||
      rect.height < 0
    )
      throw Error("Private geometry is unavailable.");
    const x = Math.max(0, rect.left),
      y = Math.max(0, rect.top),
      width = Math.min(extent.width, rect.right) - x,
      height = Math.min(extent.height, rect.bottom) - y;
    return width > 0 && height > 0 ? { x, y, width, height } : undefined;
  };
  const mask = (rect: DOMRect | DOMRectReadOnly) => {
    const box = rectangle(rect);
    if (!box) return;
    masks.set(JSON.stringify(box), box);
    if (masks.size > VISION_CAPTURE_LIMITS.maxMasks)
      throw Error("Private mask budget exceeded.");
  };
  while (stack.length) {
    const slice = performance.now();
    do {
      if (!live(lease) || performance.now() - started > PRIVACY_WALK_MS)
        throw Error("Privacy capture was invalidated or timed out.");
      const entry = stack[stack.length - 1],
        node = entry.node;
      if (!node) {
        stack.pop();
        continue;
      }
      entry.node = entry.single ? null : node.nextSibling;
      if (node instanceof Element) {
        if (node instanceof HTMLElement && node.matches(ownedSelector)) {
          if (!ownedIds.has(node)) ownedIds.set(node, ++identity);
          owners.add(ownedIds.get(node)!);
          if (!lease.styles.has(node)) {
            if (lease.metadata || lease.restored)
              throw Error("Owned capture surface changed.");
            hideOwned(lease, node);
          }
          if (!lease.restored && Number(getComputedStyle(node).opacity) !== 0)
            throw Error("Owned capture surface is not suppressed.");
          continue;
        }
        const style = geometry.style(node),
          animations = node.getAnimations();
        activeAnimation ||= animations.some(
          (animation) => animation.playState === "running" || animation.pending,
        );
        if (
          style.display === "none" ||
          (style.opacity !== "" && Number(style.opacity) === 0)
        )
          continue;
        backdropPaint ||=
          !!style.backdropFilter && style.backdropFilter !== "none";
        const privateScope = entry.private || isPixelPrivateElement(node),
          unsupportedPaint =
            entry.unsupportedPaint ||
            [style.filter, style.backdropFilter, style.textShadow].some(
              (value) => !!value && value !== "none",
            );
        if (privateScope) {
          privatePixels = true;
          if (unsupportedPaint)
            throw Error("Private painted overflow is unsupported.");
          for (const rect of node.getClientRects()) mask(rect);
        } else if (
          node instanceof HTMLElement &&
          node.matches(
            '[role="menu"],[role="listbox"],[role="dialog"],dialog[open]',
          )
        ) {
          const box = rectangle(geometry.rect(node));
          const hit =
            box &&
            document.elementFromPoint?.(
              box.x + box.width / 2,
              box.y + box.height / 2,
            );
          if (
            box &&
            box.width >= 40 &&
            box.height >= 24 &&
            hit &&
            node.contains(hit)
          )
            focus = box;
        }
        // Replaced fields and complete iframe pixels are opaque leaves. Their
        // native editor internals never become semantic or text evidence.
        if (node.matches("input,select,textarea,iframe")) continue;
        if (node instanceof HTMLSlotElement) {
          // Assigned light DOM inherits the slot's composed privacy scope.
          // Each assignment is isolated so its DOM siblings cannot inherit it.
          for (const assigned of node.assignedNodes({ flatten: false }))
            stack.push({
              node: assigned,
              private: privateScope,
              unsupportedPaint,
              single: true,
            });
        }
        if (node.firstChild)
          stack.push({
            node: node.firstChild,
            private: privateScope,
            unsupportedPaint,
          });
        if (node instanceof HTMLElement) {
          const root = privacyShadowRoot(node);
          if (root) {
            seeRoot(root);
            stack.push({
              node: root.firstChild,
              private: privateScope,
              unsupportedPaint,
            });
          }
        }
      } else if (node.nodeType === Node.TEXT_NODE && entry.private) {
        const range = document.createRange();
        try {
          range.selectNodeContents(node);
          for (const rect of range.getClientRects()) mask(rect);
        } finally {
          range.detach();
        }
      }
    } while (stack.length && performance.now() - slice < 8);
    if (stack.length)
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
  }
  if (privatePixels && activeAnimation)
    throw Error("Private capture during animation is unsupported.");
  if (privatePixels && backdropPaint)
    throw Error("Private capture through backdrop paint is unsupported.");
  if (
    !live(lease) ||
    JSON.stringify(currentViewport()) !== JSON.stringify(viewport)
  )
    throw Error("Capture viewport changed.");
  for (const root of rootObservers.keys())
    if (!roots.has(root)) unobserveRoot(root);
  const sortedMasks = [...masks.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([, box]) => box);
  return {
    viewport,
    masks: sortedMasks,
    focusRegions: focus ? [focus] : [],
    proof: JSON.stringify({
      viewport,
      masks: sortedMasks,
      roots: [...roots]
        .map((root) => rootIds.get(root))
        .sort((a, b) => a! - b!),
      owners: [...owners].sort((a, b) => a - b),
    }),
  };
}
export async function captureMetadata(
  value: CaptureIdentity,
  current: () => boolean,
): Promise<CaptureMetadata> {
  cancelCapture();
  const lease: Lease = {
    identity: value,
    current,
    revision,
    expires: performance.now() + CAPTURE_LIFETIME_MS,
    styles: new Map(),
    restored: false,
    abort: new AbortController(),
  };
  capture = lease;
  lease.expiry = setTimeout(() => {
    if (capture === lease) cancelCapture();
  }, CAPTURE_LIFETIME_MS);
  try {
    await privacySnapshot(lease);
    await new Promise<void>((resolve, reject) => {
      let frame = 0;
      const stopped = () => {
        cancelAnimationFrame(frame);
        reject(Error("Capture paint was cancelled."));
      };
      lease.abort.signal.addEventListener("abort", stopped, { once: true });
      frame = requestAnimationFrame(() => {
        frame = requestAnimationFrame(() => {
          lease.abort.signal.removeEventListener("abort", stopped);
          resolve();
        });
      });
      if (lease.abort.signal.aborted) stopped();
    });
    const walked = await privacySnapshot(lease);
    const metadata = captureMetadataSchema.parse({
      version: 1,
      ...value,
      viewportRevision: revision,
      at: Date.now(),
      viewport: walked.viewport,
      masks: walked.masks,
      focusRegions: walked.focusRegions,
      masking: { version: 1, complete: true },
    });
    lease.metadata = metadata;
    lease.proof = walked.proof;
    return metadata;
  } catch {
    if (capture === lease) cancelCapture();
    throw Error("Complete private capture evidence is unavailable.");
  }
}
export async function checkCapture(
  captureId: string,
): Promise<{ current: boolean; viewportRevision: number }> {
  const lease = capture;
  if (
    !lease ||
    lease.identity.captureId !== captureId ||
    !lease.metadata ||
    !live(lease)
  )
    return { current: false, viewportRevision: revision };
  if (!lease.checking)
    lease.checking = privacySnapshot(lease)
      .then((walked) => live(lease) && walked.proof === lease.proof)
      .catch(() => false)
      .finally(() => {
        lease.checking = undefined;
      });
  const current = await lease.checking;
  if (!current && capture === lease) cancelCapture();
  return { current, viewportRevision: revision };
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
