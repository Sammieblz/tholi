import gettingStarted from "../../../../../docs/chrome-handoff.md?raw";
import usingTholi from "../../../../../docs/tholi-ui.md?raw";
import journeys from "../../../../../docs/task-routing.md?raw";
import sessions from "../../../../../docs/session-lifecycle.md?raw";
import appearance from "../../../../../docs/adaptive-appearance.md?raw";
import troubleshooting from "../../../../../docs/live-diagnostics.md?raw";
import security from "../../../../../docs/security.md?raw";
import architecture from "../../../../../docs/live-navigation.md?raw";
import naturalLanguage from "../../../../../docs/nlp-architecture.md?raw";
import backend from "../../../../../docs/api-setup.md?raw";
import contributing from "../../../../../CONTRIBUTING.md?raw";
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
    source: "docs/chrome-handoff.md",
    markdown: gettingStarted,
  },
  {
    slug: "using-tholi",
    title: "Using Tholi",
    description:
      "Guide, Conversation, the floating widget and the local practice.",
    group: "Start here",
    source: "docs/tholi-ui.md",
    markdown: usingTholi,
  },
  {
    slug: "journeys",
    title: "Continuous journeys",
    description:
      "How destinations, corrections and return routes work across screens.",
    group: "Using Tholi",
    source: "docs/task-routing.md",
    markdown: journeys,
  },
  {
    slug: "sessions",
    title: "Your session",
    description:
      "Pause, Stop, close, resume and understand session continuity.",
    group: "Using Tholi",
    source: "docs/session-lifecycle.md",
    markdown: sessions,
  },
  {
    slug: "appearance",
    title: "Appearance",
    description: "Website appearance and the extension's contrasting guidance.",
    group: "Using Tholi",
    source: "docs/adaptive-appearance.md",
    markdown: appearance,
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description:
      "Understand missing evidence and safely export local diagnostics.",
    group: "Using Tholi",
    source: "docs/live-diagnostics.md",
    markdown: troubleshooting,
  },
  {
    slug: "security",
    title: "Security and boundaries",
    description: "Permissions, private inputs, review and verified outcomes.",
    group: "Under the hood",
    source: "docs/security.md",
    markdown: security,
  },
  {
    slug: "architecture",
    title: "How guidance works",
    description: "Discovery, grounded planning, live binding and verification.",
    group: "Under the hood",
    source: "docs/live-navigation.md",
    markdown: architecture,
  },
  {
    slug: "natural-language",
    title: "Natural language",
    description:
      "English interpretation, local models and contextual retrieval.",
    group: "Under the hood",
    source: "docs/nlp-architecture.md",
    markdown: naturalLanguage,
  },
  {
    slug: "backend",
    title: "Optional backend",
    description: "Connect a self-hosted API when you choose to use one.",
    group: "Under the hood",
    source: "docs/api-setup.md",
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
  const registered = articles.find((article) => article.source === relative);
  return registered
    ? { href: `/docs/${registered.slug}${target.hash}`, local: true }
    : {
        href: `${repositorySourceUrl}${relative}${target.hash}`,
        local: false,
      };
}
