import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DocumentationBody,
  documentHeadings,
} from "../../../apps/web/src/features/docs/DocsPage";
import {
  articles,
  headingId,
  resolveDocumentationLink,
  searchDocumentation,
} from "../../../apps/web/src/features/docs/registry";
import { documentationRedirect } from "../../../apps/web/src/features/docs/redirects";

describe("published website documentation", () => {
  it("publishes eight user guides with unique public paths and separate technical sources", () => {
    expect(articles.map((article) => article.slug)).toEqual([
      "getting-started",
      "using-tholi",
      "journeys",
      "sessions",
      "appearance",
      "security",
      "troubleshooting",
      "developers",
    ]);
    expect(new Set(articles.map((article) => article.slug)).size).toBe(8);
    expect(articles.every((article) => article.markdown.length > 100)).toBe(
      true,
    );
    expect(
      articles.every((article) => article.source.startsWith("docs/help/")),
    ).toBe(true);
    expect(
      articles.every((article) => !article.markdown.includes("\u2014")),
    ).toBe(true);
    for (const article of articles) {
      for (const match of article.markdown.matchAll(
        /\[[^\]]*\]\(([^\s)]+)\)/g,
      )) {
        const resolved = resolveDocumentationLink(match[1], article.source);
        expect(
          resolved.href,
          `Unusable link in ${article.source}: ${match[1]}`,
        ).not.toBe("");
        if (!resolved.local) continue;
        const url = new URL(
          resolved.href,
          `https://tholi.io/docs/${article.slug}`,
        );
        const target = articles.find(
          (item) => url.pathname === `/docs/${item.slug}`,
        );
        expect(target, `Missing help article: ${url.pathname}`).toBeDefined();
        if (target && url.hash)
          expect(
            documentHeadings(target.markdown).map((heading) => heading.id),
          ).toContain(decodeURIComponent(url.hash.slice(1)));
      }
    }
  });
  it("finds words in current content without sending search text elsewhere", () => {
    expect(
      searchDocumentation("permissions").map((article) => article.slug),
    ).toContain("security");
    expect(
      searchDocumentation("Widget menu").map((article) => article.slug),
    ).toContain("using-tholi");
    expect(searchDocumentation("zzzz-no-such-reference")).toEqual([]);
    expect(
      searchDocumentation("reset current session").map(
        (article) => article.slug,
      ),
    ).toContain("sessions");
    expect(searchDocumentation("MiniLM")).toEqual([]);
    expect(searchDocumentation("")).toHaveLength(8);
  });
  it("resolves local references and fragments while leaving historical records as source links", () => {
    expect(
      resolveDocumentationLink(
        "session-lifecycle.md#verification",
        "docs/guides/journeys.md",
      ),
    ).toEqual({
      href: "https://github.com/Sammieblz/tholi/blob/main/docs/architecture/sessions.md#verification",
      local: false,
    });
    expect(
      resolveDocumentationLink(
        "sessions.md#reset-the-session",
        "docs/help/journeys.md",
      ),
    ).toEqual({ href: "/docs/sessions#reset-the-session", local: true });
    expect(
      resolveDocumentationLink("security.md", "docs/help/getting-started.md"),
    ).toEqual({ href: "/docs/security", local: true });
    expect(
      resolveDocumentationLink(
        "../../CONTRIBUTING.md",
        "docs/guides/journeys.md",
      ),
    ).toEqual({
      href: "https://github.com/Sammieblz/tholi/blob/main/CONTRIBUTING.md",
      local: false,
    });
    expect(
      resolveDocumentationLink("#same-page", "docs/architecture/security.md"),
    ).toEqual({
      href: "#same-page",
      local: true,
    });
    expect(
      resolveDocumentationLink(
        "v0.9.1-validation.md",
        "docs/guides/getting-started.md",
      ),
    ).toEqual({
      href: "https://github.com/Sammieblz/tholi/blob/main/docs/releases/v0.9.1/validation.md",
      local: false,
    });
    expect(
      resolveDocumentationLink(
        "javascript:alert(1)",
        "docs/architecture/security.md",
      ).href,
    ).toBe("");
    expect(
      resolveDocumentationLink(
        "//tracker.example/x",
        "docs/architecture/security.md",
      ).href,
    ).toBe("");
    expect(
      resolveDocumentationLink("bad%file.md", "docs/architecture/security.md")
        .href,
    ).toBe("");
  });
  it("keeps retired technical bookmarks and raw exports on the matching GitHub references", () => {
    const sources = {
      architecture: "docs/architecture/navigation.md",
      "natural-language": "docs/architecture/natural-language.md",
      backend: "docs/guides/backend.md",
      contributing: "CONTRIBUTING.md",
    };
    for (const [slug, source] of Object.entries(sources)) {
      for (const suffix of ["", "/", ".html"])
        expect(
          documentationRedirect(`/docs/${slug}${suffix}`, "#details"),
        ).toBe(
          `https://github.com/Sammieblz/tholi/blob/main/${source}#details`,
        );
      expect(documentationRedirect(`/docs/${slug}.md`, "#details")).toBe(
        `https://raw.githubusercontent.com/Sammieblz/tholi/main/${source}#details`,
      );
    }
    expect(documentationRedirect("/docs/security")).toBeUndefined();
    expect(documentationRedirect("/docs/backend-extra")).toBeUndefined();
  });
  it("gives headings stable unique anchors without interpreting code fences", () => {
    expect(headingId("Your session: Pause & Resume")).toBe(
      "your-session-pause-resume",
    );
    expect(
      documentHeadings(
        "## Context\n```md\n## Not a heading\n```\n## Context\n### More details",
      ),
    ).toEqual([
      { line: 1, text: "Context", level: 2, id: "context" },
      { line: 5, text: "Context", level: 2, id: "context-1" },
      { line: 6, text: "More details", level: 3, id: "more-details" },
    ]);
  });
  it("renders GFM safely without raw HTML, executing links or remote images", () => {
    const html = renderToStaticMarkup(
      createElement(DocumentationBody, {
        article: {
          slug: "fixture",
          title: "Fixture",
          description: "Fixture",
          group: "Help and privacy",
          source: "docs/help/security.md",
          markdown:
            '# Fixture\n\n## Safe heading\n\n<script>alert("private")</script>\n\n<img src="https://tracker.example/pixel" onerror="alert(1)" />\n\n[bad](javascript:alert%281%29)\n\n![Remote picture](https://tracker.example/photo.png)\n\n[Session](sessions.md)\n\n| Name | Value |\n| --- | --- |\n| Safe | Yes |',
        },
      }),
    );
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<img");
    expect(html).not.toContain("onerror");
    expect(html).not.toContain('href="javascript:');
    expect(html).toContain('href="/docs/sessions"');
    expect(html).toContain('id="safe-heading"');
    expect(html).toContain("<table>");
  });
});
