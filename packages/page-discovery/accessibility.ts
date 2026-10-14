/**
 * Adapted from Microsoft Playwright roleUtils.ts and ariaSnapshot.ts.
 * Copyright (c) Microsoft Corporation. Apache-2.0.
 * Upstream: a69a313712e43e09a53c57ae04ed6f110621875d.
 * Changes: bounded structural reads, no editable values, no full text snapshot.
 */
import {
  isSensitiveElement,
  safeName,
  sanitizeText,
} from "../privacy-redaction";
const roles = new Set(
  "button link heading checkbox radio switch combobox listbox option menu menuitem menuitemradio menuitemcheckbox tab tablist tree treeitem textbox searchbox slider spinbutton dialog navigation banner contentinfo main region group grid row cell separator progressbar status alert img none presentation".split(
    " ",
  ),
);
export function accessibleRole(element: HTMLElement): string {
  const explicit = (element.getAttribute("role") || "")
    .split(/\s+/)
    .find((r) => roles.has(r));
  const implicit = element.matches("a[href],area[href]")
    ? "link"
    : element.matches(
          "button,summary,input[type=button],input[type=submit],input[type=reset]",
        )
      ? "button"
      : element.matches("input[type=checkbox]")
        ? "checkbox"
        : element.matches("input[type=radio]")
          ? "radio"
          : element.matches("input[type=range]")
            ? "slider"
            : element.matches("input[type=search]")
              ? "searchbox"
              : element.matches("input[type=number]")
                ? "spinbutton"
                : element.matches("select")
                  ? (element as HTMLSelectElement).multiple ||
                    (element as HTMLSelectElement).size > 1
                    ? "listbox"
                    : "combobox"
                  : element.matches("input,textarea,[contenteditable=true]")
                    ? "textbox"
                    : element.matches("h1,h2,h3,h4,h5,h6")
                      ? "heading"
                      : element.matches("dialog")
                        ? "dialog"
                        : "";
  // Playwright's presentation-conflict resolution retains focusable native roles.
  if (explicit === "none" || explicit === "presentation")
    return element.tabIndex >= 0 ? implicit : explicit;
  return explicit || implicit || "generic";
}
export function accessibleName(element: HTMLElement): string {
  if (
    isSensitiveElement(element) ||
    element.matches(
      "input,textarea,[contenteditable],[role=textbox],[role=searchbox]",
    )
  )
    return "";
  const named = safeName(element);
  if (named) return named;
  const root = element.getRootNode() as Document | ShadowRoot;
  const references = (element.getAttribute("aria-labelledby") || "")
    .split(/\s+/)
    .filter(Boolean);
  if (references.length)
    return sanitizeText(
      references
        .slice(0, 8)
        .map((id) => {
          const ref = root.getElementById(id);
          return ref && !isSensitiveElement(ref) ? safeName(ref) : "";
        })
        .join(" "),
    );
  return sanitizeText(
    element.getAttribute("aria-label") ||
      element.getAttribute("title") ||
      [
        ...element.querySelectorAll(
          'img[alt],svg title,svg[aria-label],[role="img"][aria-label]',
        ),
      ]
        .slice(0, 4)
        .filter(
          (e) =>
            !isSensitiveElement(e) &&
            !e.closest('[aria-hidden="true"],[hidden],[inert]'),
        )
        .map(
          (e) =>
            e.getAttribute("aria-label") ||
            e.getAttribute("alt") ||
            e.textContent ||
            "",
        )
        .join(" "),
  );
}
export const customControlSelector =
  '[tabindex]:not([tabindex="-1"]),[onclick],[onpointerdown],[onmousedown]';
export function customInteraction(
  element: HTMLElement,
): "declared" | "pointer" | undefined {
  if (element.matches(customControlSelector)) return "declared";
  // Run only on bounded leaf candidates, never every node in a large document.
  if (
    element.childElementCount < 3 &&
    element.matches("span,div,label") &&
    (element.hasAttribute("aria-label") || element.hasAttribute("title")) &&
    getComputedStyle(element).cursor === "pointer"
  )
    return "pointer";
}
