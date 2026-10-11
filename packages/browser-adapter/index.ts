import type { UIState, Landmark } from "../shared-types";
import type { Target, Route } from "../route-schema";
import {
  safeName,
  sanitizeText,
  isSensitiveElement,
} from "../privacy-redaction";
import { rankTargets } from "../semantic-locator";
import { routeSupportsUrl } from "../safety-policy";
export function roleOf(element: Element): string {
  const explicit = element.getAttribute("role");
  if (explicit) return explicit;
  const tag = element.tagName.toLowerCase();
  if (/^h[1-6]$/.test(tag)) return "heading";
  if (tag === "button") return "button";
  if (tag === "a" && element.hasAttribute("href")) return "link";
  if (tag === "dialog") return "dialog";
  return "";
}
export function visible(element: Element): boolean {
  if (
    !element.isConnected ||
    element.closest('[hidden], [aria-hidden="true"], [inert]')
  )
    return false;
  const style = getComputedStyle(element);
  return (
    style.display !== "none" &&
    style.visibility !== "hidden" &&
    style.opacity !== "0" &&
    element.getClientRects().length > 0
  );
}
export class BrowserAdapter {
  private selectors: string[];
  constructor(private route?: Route) {
    this.selectors = [
      ...new Set(
        route
          ? [
              ...route.states.flatMap((s) =>
                [...s.landmarks, ...s.absentLandmarks].flatMap((l) =>
                  l.selector ? [l.selector] : [],
                ),
              ),
              ...route.transitions.flatMap((t) =>
                [t.target.selector, t.target.stableSelector].filter(
                  (s): s is string => !!s,
                ),
              ),
            ]
          : [],
      ),
    ];
  }
  elements = new Map<string, HTMLElement>();
  private ids = new WeakMap<Element, string>();
  private counter = 0;
  snapshot(): UIState {
    this.elements.clear();
    const landmarks: Landmark[] = [];
    const all = document.querySelectorAll<HTMLElement>(
      'h1,h2,h3,h4,h5,h6,button,a[href],dialog,[role="button"],[role="link"],[role="heading"],[role="tab"]',
    );
    for (const element of all) {
      if (
        element.closest("#internet-navigator-overlay") ||
        isSensitiveElement(element)
      )
        continue;
      // Checkbox buttons expose only authored accessibility metadata, never field values.
      const checkboxButton = element.matches(
        'input[type="checkbox"][role="button"][aria-label]',
      );
      const presentation = checkboxButton
        ? (element as HTMLInputElement).labels?.[0]
        : undefined;
      const geometry = presentation || element;
      const labelStyle = presentation && getComputedStyle(presentation);
      const presented =
        presentation &&
        !element.closest(
          '[hidden],[inert],[aria-hidden="true"],[contenteditable],[data-sensitive="true"]',
        ) &&
        !presentation.closest(
          "[hidden],[inert],[contenteditable],[data-sensitive=true]",
        ) &&
        presentation.getBoundingClientRect().width > 0 &&
        presentation.getBoundingClientRect().height > 0 &&
        labelStyle?.display !== "none" &&
        labelStyle?.visibility !== "hidden" &&
        labelStyle?.opacity !== "0" &&
        getComputedStyle(element).display !== "none" &&
        getComputedStyle(element).visibility !== "hidden" &&
        element.getBoundingClientRect().width > 0 &&
        element.getBoundingClientRect().height > 0;
      if (checkboxButton ? !presented : !visible(element)) continue;
      const name = checkboxButton
        ? sanitizeText(element.getAttribute("aria-label") || "")
        : safeName(element);
      if (!name) continue;
      let id = this.ids.get(element);
      if (!id) {
        id = "c" + ++this.counter;
        this.ids.set(element, id);
      }
      const container = element.closest(
        'section,nav,dialog,[role="dialog"],article,main',
      );
      const heading = container?.querySelector('h1,h2,h3,[role="heading"]');
      const context = sanitizeText(
        (container?.getAttribute("aria-label") || "") +
          " " +
          (heading ? safeName(heading) : ""),
      );
      landmarks.push({
        id,
        role: roleOf(element),
        name,
        context,
        visible: true,
        selectors: this.selectors.filter((selector) => {
          try {
            return element.matches(selector);
          } catch {
            return false;
          }
        }),
        inViewport: (() => {
          const r = geometry.getBoundingClientRect();
          return (
            r.width > 0 &&
            r.height > 0 &&
            r.top >= 0 &&
            r.bottom <= innerHeight &&
            r.left >= 0 &&
            r.right <= innerWidth
          );
        })(),
        enabled:
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-disabled") !== "true",
      });
      this.elements.set(id, checkboxButton ? element : geometry);
    }
    return {
      platform: "web",
      application: location.hostname,
      origin: location.origin,
      pathname: location.pathname,
      hasQuery: !!location.search,
      routeUrlAllowed: this.route
        ? routeSupportsUrl(this.route, location.href)
        : undefined,
      landmarks,
      modal: [
        ...document.querySelectorAll('dialog[open],[role="dialog"]'),
      ].some(visible),
    };
  }
  locate(target: Target) {
    return rankTargets(target, this.snapshot().landmarks);
  }
  observe(callback: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | undefined;
    let url = location.href;
    const schedule = () => {
      clearTimeout(timer);
      timer = setTimeout(callback, 150);
    };
    const observer = new MutationObserver((records) => {
      if (
        records.every((r) =>
          (r.target as Element).closest?.("#internet-navigator-overlay"),
        )
      )
        return;
      schedule();
    });
    observer.observe(document.documentElement, {
      subtree: true,
      childList: true,
      attributes: true,
      characterData: true,
    });
    const shadowRoots = new Set<ShadowRoot>();
    const connectRoots = (root: Document | ShadowRoot) => {
      for (const element of root.querySelectorAll("*")) {
        const shadow = element.shadowRoot;
        if (!shadow) continue;
        if (!shadowRoots.has(shadow)) {
          shadowRoots.add(shadow);
          observer.observe(shadow, {
            subtree: true,
            childList: true,
            attributes: true,
            characterData: true,
          });
          shadow.addEventListener("change", schedule);
          schedule();
        }
        connectRoots(shadow);
      }
    };
    connectRoots(document);
    let rootTicks = 0;
    const interval = setInterval(() => {
      if (++rootTicks % 4 === 0) connectRoots(document);
      if (location.href !== url) {
        url = location.href;
        schedule();
      }
    }, 250);
    window.addEventListener("popstate", schedule);
    window.addEventListener("hashchange", schedule);
    document.addEventListener("focusin", schedule);
    document.addEventListener("change", schedule);
    window.addEventListener("scroll", schedule, true);
    window.addEventListener("resize", schedule);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      observer.disconnect();
      for (const shadow of shadowRoots)
        shadow.removeEventListener("change", schedule);
      shadowRoots.clear();
      window.removeEventListener("popstate", schedule);
      window.removeEventListener("hashchange", schedule);
      document.removeEventListener("focusin", schedule);
      document.removeEventListener("change", schedule);
      window.removeEventListener("scroll", schedule, true);
      window.removeEventListener("resize", schedule);
    };
  }
}
