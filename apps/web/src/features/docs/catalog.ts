/** Shared metadata for documentation, SEO and static exports. No article bodies. */
export const documentationGroups = [
  "Start here",
  "Everyday use",
  "Help and privacy",
  "Developers",
] as const;
export type ArticleMetadata = {
  slug: string;
  title: string;
  description: string;
  group: (typeof documentationGroups)[number];
  source: string;
};
export const articleCatalog: ArticleMetadata[] = [
  {
    slug: "getting-started",
    title: "Getting started",
    description: "Install Tholi, open it on a website and try your first task.",
    group: "Start here",
    source: "docs/help/getting-started.md",
  },
  {
    slug: "using-tholi",
    title: "Using Tholi",
    description:
      "Follow instructions, use Conversation and keep your guide beside the page.",
    group: "Start here",
    source: "docs/help/using-tholi.md",
  },
  {
    slug: "journeys",
    title: "Choosing and changing a destination",
    description:
      "Write a useful request, clarify your goal and continue across pages.",
    group: "Everyday use",
    source: "docs/help/journeys.md",
  },
  {
    slug: "sessions",
    title: "Pausing and resuming",
    description: "Pause, stop, minimize or return to an unfinished task.",
    group: "Everyday use",
    source: "docs/help/sessions.md",
  },
  {
    slug: "appearance",
    title: "Appearance",
    description:
      "Adjust website appearance and understand extension contrast and motion.",
    group: "Everyday use",
    source: "docs/help/appearance.md",
  },
  {
    slug: "security",
    title: "Privacy and permissions",
    description:
      "Choose website access and manage your local tasks, routes and memory.",
    group: "Help and privacy",
    source: "docs/help/security.md",
  },
  {
    slug: "troubleshooting",
    title: "Troubleshooting",
    description:
      "Find checks for missing guidance, access problems and unclear next steps.",
    group: "Help and privacy",
    source: "docs/help/troubleshooting.md",
  },
  {
    slug: "developers",
    title: "For developers",
    description:
      "Find source installation, private backend setup and contribution guides on GitHub.",
    group: "Developers",
    source: "docs/help/developers.md",
  },
];
