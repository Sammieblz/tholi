import { hash, type PageControl } from "../page-model";
import { safeName, sanitizeText } from "../privacy-redaction";
import { authenticationIntent } from "../goal-planner/task-intent";
import { authenticationStage, presentedMetadataField } from "./screen-state";

export function formContext(
  element: HTMLElement,
  cache: Map<HTMLFormElement, PageControl["form"]>,
): PageControl["form"] {
  const form =
    element instanceof HTMLInputElement ||
    element instanceof HTMLButtonElement ||
    element instanceof HTMLSelectElement ||
    element instanceof HTMLTextAreaElement
      ? element.form
      : element.closest("form");
  if (!form) return;
  if (cache.has(form)) return cache.get(form);
  const root = form.getRootNode() as Document | ShadowRoot;
  const localHeading = form.querySelector('h1,h2,h3,[role="heading"],legend');
  const pageHeading = form
    .closest('main,[role="main"],dialog,[role="dialog"]')
    ?.querySelector('h1,h2,[role="heading"]');
  const heading = localHeading || pageHeading;
  const name = sanitizeText(
    [form.getAttribute("aria-label"), heading && safeName(heading)]
      .filter(Boolean)
      .join(" "),
  );
  const submits = [...form.elements]
    .filter(
      (e) =>
        (e instanceof HTMLInputElement || e instanceof HTMLButtonElement) &&
        e.type === "submit",
    )
    .map((e) =>
      e instanceof HTMLInputElement
        ? sanitizeText(
            e.getAttribute("aria-label") || e.getAttribute("value") || "",
          )
        : safeName(e),
    );
  // Inspect authored input types/autocomplete hints only. Never read a field's
  // current value or include password controls in the discovered control list.
  const password = [...form.elements].filter(
    (e) =>
      e instanceof HTMLInputElement &&
      e.type === "password" &&
      presentedMetadataField(e),
  );
  // A page heading alone cannot turn appearance/search forms into login forms.
  const localName = [
    form.getAttribute("aria-label"),
    localHeading && safeName(localHeading),
  ]
    .filter(Boolean)
    .join(" ");
  const declared =
    authenticationIntent(localName + " " + submits.join(" ")) ||
    (password.length ? authenticationIntent(name) : undefined);
  const authentication =
    declared ||
    (password.some((e) => e.getAttribute("autocomplete") === "new-password")
      ? "register"
      : password.some(
            (e) => e.getAttribute("autocomplete") === "current-password",
          )
        ? "login"
        : password.length
          ? "credentials"
          : undefined);
  const stage = authenticationStage(form, name);
  const context: NonNullable<PageControl["form"]> = {
    key: hash(name + "|" + [...root.querySelectorAll("form")].indexOf(form)),
    authentication: authentication || (stage ? "credentials" : undefined),
    stage,
  };
  cache.set(form, context);
  return context;
}
