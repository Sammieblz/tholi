import contributing from "../../../../../CONTRIBUTING.md?raw";
import naturalLanguage from "../../../../../docs/architecture/natural-language.md?raw";
import architecture from "../../../../../docs/architecture/navigation.md?raw";
import security from "../../../../../docs/architecture/security.md?raw";
import sessions from "../../../../../docs/architecture/sessions.md?raw";
import appearance from "../../../../../docs/guides/appearance.md?raw";
import backend from "../../../../../docs/guides/backend.md?raw";
import gettingStarted from "../../../../../docs/guides/getting-started.md?raw";
import journeys from "../../../../../docs/guides/journeys.md?raw";
import troubleshooting from "../../../../../docs/guides/troubleshooting.md?raw";
import usingTholi from "../../../../../docs/guides/using-tholi.md?raw";
import { repositorySourceUrl } from "../../config/project";

export { repositoryUrl } from "../../config/project";
export type DocumentationArticle = {
  slug: string;
  title: string;
  description: string;
  group: "Start here" | "Using Tholi" | "Under the hood";
  source: string;
  markdown: string;
};
export const articles: DocumentationArticle[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    description:
      "Install the preview, grant website access and begin a destination.",
    group: "Start here",
    source: "docs/guides/getting-started.md",
    markdown: gettingStarted,
  },
  {
    slug: "using-tholi",
    title: "Using Tholi",
    description:
      "Guide, Conversation, the floating widget and the local practice.",
    group: "Start here",
    source: "docs/guides/using-tholi.md",
    markdown: usingTholi,
  },
  {
    slug: "journeys",
    title: "Continuous journeys",
    description:
      "How destinations, corrections and return routes work across screens.",
    group: "Using Tholi",
    source: "docs/guides/journeys.md",
    markdown: journeys,
  },
  {
    slug: "sessions",
    title: "Your session",
    description:
      "Pause, Stop, close, resume and understand session continuity.",
    group: "Using Tholi",
    source: "docs/architecture/sessions.md",
    markdown: sessions,
  },
  {
    slug: "appearance",
    title: "Appearance",
    description: "Website appearance and the extension's contrasting guidance.",
    group: "Using Tholi",
    source: "docs/guides/appearance.md",
    markdown: appearance,
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description:
      "Understand missing evidence and safely export local diagnostics.",
    group: "Using Tholi",
    source: "docs/guides/troubleshooting.md",
    markdown: troubleshooting,
  },
  {
    slug: "security",
    title: "Security and boundaries",
    description: "Permissions, private inputs, review and verified outcomes.",
    group: "Under the hood",
    source: "docs/architecture/security.md",
    markdown: security,
  },
  {
    slug: "architecture",
    title: "How guidance works",
    description: "Discovery, grounded planning, live binding and verification.",
    group: "Under the hood",
    source: "docs/architecture/navigation.md",
    markdown: architecture,
  },
  {
    slug: "natural-language",
    title: "Natural language",
    description:
      "English interpretation, local models and contextual retrieval.",
    group: "Under the hood",
    source: "docs/architecture/natural-language.md",
    markdown: naturalLanguage,
  },
  {
    slug: "backend",
    title: "Optional backend",
    description: "Connect a self-hosted API when you choose to use one.",
    group: "Under the hood",
    source: "docs/guides/backend.md",
    markdown: backend,
  },
  {
    slug: "contributing",
    title: "Contributing",
    description:
      "Development, regression checks and truthful release artifacts.",
    group: "Under the hood",
    source: "CONTRIBUTING.md",
    markdown: contributing,
  },
];
export const documentationGroups = [
  "Start here",
  "Using Tholi",
  "Under the hood",
] as const;
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
  relative = legacySources[relative.split("/").at(-1)!] || relative;
  const registered = articles.find((article) => article.source === relative);
  return registered
    ? { href: `/docs/${registered.slug}${target.hash}`, local: true }
    : {
        href: `${repositorySourceUrl}${relative}${target.hash}`,
        local: false,
      };
}
