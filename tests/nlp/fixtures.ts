import type { PageControl, PageSnapshot } from "../../packages/page-model";
export const labels = [
  "Log in",
  "Create account",
  "Languages",
  "Spanish",
  "Dark",
  "Large",
  "References",
  "Contents",
  "Search",
  "Edit",
  "View history",
  "Appearance",
  "Wide",
  "Tools",
  "Donate",
  "Download",
  "Help",
  "Contact",
  "Settings",
  "Notifications",
];
export function fixture(duplicate?: string): PageSnapshot {
  const controls: PageControl[] = labels.map((label, i) => ({
    id: `w0000000000000000-${i}`,
    signature: "signature-" + i,
    role:
      label === "Search"
        ? "searchbox"
        : ["Dark", "Large", "Wide"].includes(label)
          ? "radio"
          : "link",
    label,
    context: ["Dark", "Large", "Wide"].includes(label)
      ? "Appearance"
      : label === "Spanish"
        ? "Languages"
        : "",
    group: "Page",
    kind:
      label === "Search"
        ? "focus"
        : [
              "Languages",
              "Appearance",
              "Tools",
              "Settings",
              "Notifications",
            ].includes(label)
          ? "expand"
          : ["Dark", "Large", "Wide"].includes(label)
            ? "choice"
            : ["References", "Contents"].includes(label)
              ? "section"
              : "navigation",
    visible: true,
    enabled: true,
    inViewport: true,
    revealIds: [],
    risk: "ordinary",
    scope: "page",
    ...(["Dark", "Large", "Wide"].includes(label) ? { checked: false } : {}),
    ...(["References", "Contents"].includes(label)
      ? { sectionVisible: false }
      : {}),
    ...(label === "Spanish" ? { targetLanguage: "es" } : {}),
  }));
  if (duplicate)
    controls.push({
      ...controls.find((c) => c.label === duplicate)!,
      id: "w0000000000000000-40",
      signature: "duplicate-" + duplicate,
      context: "Account",
      scope: "page",
    });
  return {
    origin: "https://example.test",
    pageKey: "page",
    path: "/",
    stateKey: "initial",
    templateKey: "layout",
    fingerprint: "fingerprint",
    revision: 1,
    layout: "wide",
    language: "en",
    controls,
    partial: false,
  };
}
