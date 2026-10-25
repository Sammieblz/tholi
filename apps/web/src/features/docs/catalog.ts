/** Shared metadata for documentation, SEO and static exports. No article bodies. */
export type ArticleMetadata = {
  slug: string;
  title: string;
  description: string;
  group: "Start here" | "Using Tholi" | "Under the hood";
  source: string;
};
export const articleCatalog: ArticleMetadata[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    description:
      "Install from the store, grant website access and begin a destination.",
    group: "Start here",
    source: "docs/guides/getting-started.md",
  },
  {
    slug: "using-tholi",
    title: "Using Tholi",
    description:
      "Guide, Conversation, the floating widget and the local practice.",
    group: "Start here",
    source: "docs/guides/using-tholi.md",
  },
  {
    slug: "journeys",
    title: "Continuous journeys",
    description:
      "How destinations, corrections and return routes work across screens.",
    group: "Using Tholi",
    source: "docs/guides/journeys.md",
  },
  {
    slug: "sessions",
    title: "Your session",
    description:
      "Pause, Stop, close, resume and understand session continuity.",
    group: "Using Tholi",
    source: "docs/architecture/sessions.md",
  },
  {
    slug: "appearance",
    title: "Appearance",
    description: "Website appearance and the extension's contrasting guidance.",
    group: "Using Tholi",
    source: "docs/guides/appearance.md",
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description:
      "Understand missing evidence and safely export local diagnostics.",
    group: "Using Tholi",
    source: "docs/guides/troubleshooting.md",
  },
  {
    slug: "security",
    title: "Security and boundaries",
    description: "Permissions, private inputs, review and verified outcomes.",
    group: "Under the hood",
    source: "docs/architecture/security.md",
  },
  {
    slug: "architecture",
    title: "How guidance works",
    description: "Discovery, grounded planning, live binding and verification.",
    group: "Under the hood",
    source: "docs/architecture/navigation.md",
  },
  {
    slug: "natural-language",
    title: "Natural language",
    description:
      "English interpretation, local models and contextual retrieval.",
    group: "Under the hood",
    source: "docs/architecture/natural-language.md",
  },
  {
    slug: "backend",
    title: "Optional backend",
    description: "Connect a self-hosted API when you choose to use one.",
    group: "Under the hood",
    source: "docs/guides/backend.md",
  },
  {
    slug: "contributing",
    title: "Contributing",
    description:
      "Development, regression checks and truthful release artifacts.",
    group: "Under the hood",
    source: "CONTRIBUTING.md",
  },
];
