import type { PageControl } from "../page-model";

const commits =
  /\b(delete|purchase|pay|checkout|transfer|send|publish|upload|unsubscribe|confirm cancellation|submit|save(?: changes)?|log ?in|sign ?in)\b/i;
const commitOperation =
  /^(delete|remove|purchase|pay|checkout|transfer|send|publish|upload|unsubscribe|submit|save|login|signin)$/i;

function committingEndpoint(href: string) {
  try {
    const url = new URL(href, location.href);
    return (
      [...url.searchParams].some(
        ([key, value]) =>
          /^(action|do|operation|command)$/i.test(key) &&
          commitOperation.test(value),
      ) || url.pathname.split("/").some((part) => commitOperation.test(part))
    );
  } catch {
    return false;
  }
}

export function interactionRisk(
  element: HTMLElement,
  kind: PageControl["kind"],
  label: string,
  description: string,
): Pick<PageControl, "risk" | "riskReason"> {
  // Focusing a field or reaching a heading does not submit its containing form.
  // A nearby heading, form endpoint, or sibling's label is not this control's effect.
  if (kind === "focus" || kind === "section") return { risk: "ordinary" };
  const purpose = label + " " + description;
  if (commits.test(purpose))
    return { risk: "consequential", riskReason: "commit" };

  if (
    element instanceof HTMLButtonElement ||
    element instanceof HTMLInputElement
  ) {
    const form = element.form;
    const method = element.getAttribute("formmethod") || form?.method;
    // The DOM type includes a button's implicit submit default and the form
    // property also resolves externally associated controls (form="...").
    if (form && element.type === "submit" && method?.toLowerCase() === "post")
      return { risk: "consequential", riskReason: "form-submit" };
    if (
      form &&
      element.type === "submit" &&
      method?.toLowerCase() !== "dialog"
    ) {
      const action =
        element.getAttribute("formaction") ??
        form.getAttribute("action") ??
        location.href;
      if (committingEndpoint(action))
        return { risk: "consequential", riskReason: "commit" };
    }
  }

  if (kind === "navigation") {
    const href = element.getAttribute("href");
    if (href && committingEndpoint(href))
      return { risk: "consequential", riskReason: "commit" };
  }

  // Edit is an entry point when the page declares navigation or a popup. An
  // opaque Edit button could instead change data immediately; do not assume.
  if (/\bedit\b/i.test(purpose) && kind !== "navigation" && kind !== "expand")
    return { risk: "consequential", riskReason: "unknown-edit-effect" };
  return { risk: "ordinary" };
}
