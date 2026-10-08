import type { UIState, Landmark } from "../shared-types";
import type { Target } from "../route-schema";
import {
  safeName,
  sanitizeText,
  isSensitiveElement,
} from "../privacy-redaction";
import { rankTargets } from "../semantic-locator";
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
        isSensitiveElement(element) ||
        !visible(element)
      )
        continue;
      const name = safeName(element);
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
        enabled:
          !element.hasAttribute("disabled") &&
          element.getAttribute("aria-disabled") !== "true",
      });
      this.elements.set(id, element);
    }
    return {
      platform: "web",
      application: location.hostname,
      origin: location.origin,
      pathname: location.pathname,
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
    const interval = setInterval(() => {
      if (location.href !== url) {
        url = location.href;
        schedule();
      }
    }, 250);
    window.addEventListener("popstate", schedule);
    window.addEventListener("hashchange", schedule);
    document.addEventListener("focusin", schedule);
    return () => {
      clearTimeout(timer);
      clearInterval(interval);
      observer.disconnect();
      window.removeEventListener("popstate", schedule);
      window.removeEventListener("hashchange", schedule);
      document.removeEventListener("focusin", schedule);
    };
  }
}
