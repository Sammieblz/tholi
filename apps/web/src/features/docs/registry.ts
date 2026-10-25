import { articleCatalog, type ArticleMetadata } from "./catalog";
import gettingStarted from "../../../../../docs/help/getting-started.md?raw";
import usingTholi from "../../../../../docs/help/using-tholi.md?raw";
import journeys from "../../../../../docs/help/journeys.md?raw";
import sessions from "../../../../../docs/help/sessions.md?raw";
import appearance from "../../../../../docs/help/appearance.md?raw";
import security from "../../../../../docs/help/security.md?raw";
import troubleshooting from "../../../../../docs/help/troubleshooting.md?raw";
import developers from "../../../../../docs/help/developers.md?raw";
import { repositorySourceUrl } from "../../config/project";

export { repositoryUrl } from "../../config/project";
export { documentationGroups } from "./catalog";
export type DocumentationArticle = ArticleMetadata & { markdown: string };
const markdown: Record<string, string> = {
  "getting-started": gettingStarted,
  "using-tholi": usingTholi,
  journeys,
  sessions,
  appearance,
  troubleshooting,
  security,
  developers,
};
export const articles: DocumentationArticle[] = articleCatalog.map(
  (article) => ({ ...article, markdown: markdown[article.slug] }),
);
export function headingId(text: string) {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s-]/g, "")
    .trim()
    .replace(/\s+/g, "-");
}
export function searchableText(markdown: string) {
  return markdown
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/[#*_`[\]()>|]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
export function searchDocumentation(query: string) {
  const terms = query
    .trim()
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 12);
  return articles.filter((article) => {
    const text =
      `${article.title} ${article.description} ${searchableText(article.markdown)}`.toLowerCase();
    return terms.every((term) => text.includes(term));
  });
}
const legacySources: Record<string, string> = {
  "chrome-handoff.md": "docs/guides/getting-started.md",
  "tholi-ui.md": "docs/guides/using-tholi.md",
  "task-routing.md": "docs/guides/journeys.md",
  "session-lifecycle.md": "docs/architecture/sessions.md",
  "adaptive-appearance.md": "docs/guides/appearance.md",
  "api-setup.md": "docs/guides/backend.md",
  "live-diagnostics.md": "docs/guides/troubleshooting.md",
  "privacy.md": "docs/architecture/privacy.md",
  "security.md": "docs/architecture/security.md",
  "live-navigation.md": "docs/architecture/navigation.md",
  "nlp-architecture.md": "docs/architecture/natural-language.md",
  "page-context.md": "docs/architecture/page-context.md",
  "frontend-architecture.md": "docs/architecture/frontend/README.md",
  "passive-guidance.md": "docs/architecture/frontend/guidance.md",
  "naming.md": "docs/development/naming.md",
  "product-screenshots.md": "docs/development/media-capture.md",
  "accuracy-benchmark.md": "docs/development/testing/acceptance.md",
  "route-authoring.md": "docs/architecture/authored-routes.md",
  "route-registry.md": "docs/architecture/authored-routes.md",
  "maintenance.md": "docs/releases/records/2026-10-maintenance.md",
  "build-evidence.md": "docs/releases/records/legacy-build-evidence.md",
  "dashboard-navigation.md": "docs/releases/v0.9.2/navigation.md",
  "ui-refinement.md": "docs/releases/v0.10.1/ui-audit.md",
  "ui-audit-redesign.md": "docs/releases/v0.10.1/ui-audit.md",
  "website-redesign.md": "docs/releases/v0.10.1/website.md",
  "v0.10.0-validation.md": "docs/releases/v0.10.0/validation.md",
  "v0.7.0-validation.md": "docs/releases/v0.7.0/validation.md",
  "v0.7.1-navigation-fixes.md": "docs/releases/v0.7.1/navigation-fixes.md",
  "v0.8.0-architecture.md": "docs/releases/v0.8.0/architecture.md",
  "v0.8.0-capabilities.md": "docs/releases/v0.8.0/capabilities.md",
  "v0.8.0-validation.md": "docs/releases/v0.8.0/validation.md",
  "v0.9.0-validation.md": "docs/releases/v0.9.0/validation.md",
  "v0.9.1-validation.md": "docs/releases/v0.9.1/validation.md",
};
export function resolveDocumentationLink(
  href: string,
  source: string,
): { href: string; local: boolean } {
  if (!href) return { href: "", local: false };
  if (href.startsWith("#")) return { href, local: true };
  if (/^(?:https?:|mailto:)/i.test(href)) return { href, local: false };
  if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("//"))
    return { href: "", local: false };
  const sourceBase = new URL(source, repositorySourceUrl);
  const target = new URL(href, sourceBase);
  const prefix = new URL(repositorySourceUrl).pathname;
  if (!target.pathname.startsWith(prefix))
    return { href: target.href, local: false };
  let relative: string;
  try {
    relative = decodeURIComponent(target.pathname.slice(prefix.length));
  } catch {
    return { href: "", local: false };
  }
  // Current help links take precedence over old, basename-only source aliases.
  if (!articles.some((article) => article.source === relative))
    relative = legacySources[relative.split("/").at(-1)!] || relative;
  const registered = articles.find((article) => article.source === relative);
  return registered
    ? { href: `/docs/${registered.slug}${target.hash}`, local: true }
    : {
        href: `${repositorySourceUrl}${relative}${target.hash}`,
        local: false,
      };
}
