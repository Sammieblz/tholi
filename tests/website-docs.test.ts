import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DocumentationBody,
  documentHeadings,
} from "../apps/web/src/features/docs/DocsPage";
import {
  articles,
  headingId,
  resolveDocumentationLink,
  searchDocumentation,
} from "../apps/web/src/features/docs/registry";

describe("published website documentation", () => {
  it("publishes the eleven allowlisted current references with unique public paths", () => {
    expect(articles).toHaveLength(11);
    expect(new Set(articles.map((article) => article.slug)).size).toBe(11);
    expect(articles.every((article) => article.markdown.length > 100)).toBe(
      true,
    );
    expect(
      articles.some((article) => article.source.includes("validation")),
    ).toBe(false);
  });
  it("finds words in current content without sending search text elsewhere", () => {
    expect(
      searchDocumentation("permissions").map((article) => article.slug),
    ).toContain("security");
    expect(
      searchDocumentation("Widget menu").map((article) => article.slug),
    ).toContain("using-tholi");
    expect(searchDocumentation("zzzz-no-such-reference")).toEqual([]);
    expect(searchDocumentation("")).toHaveLength(11);
  });
  it("resolves local references and fragments while leaving historical records as source links", () => {
    expect(
      resolveDocumentationLink(
        "session-lifecycle.md#verification",
        "docs/task-routing.md",
      ),
    ).toEqual({ href: "/docs/sessions#verification", local: true });
    expect(
      resolveDocumentationLink("../CONTRIBUTING.md", "docs/task-routing.md"),
    ).toEqual({ href: "/docs/contributing", local: true });
    expect(resolveDocumentationLink("#same-page", "docs/security.md")).toEqual({
      href: "#same-page",
      local: true,
    });
    expect(
      resolveDocumentationLink(
        "v0.9.1-validation.md",
        "docs/chrome-handoff.md",
      ),
    ).toEqual({
      href: "https://github.com/Sammieblz/web-navigator/blob/main/docs/v0.9.1-validation.md",
      local: false,
    });
    expect(
      resolveDocumentationLink("javascript:alert(1)", "docs/security.md").href,
    ).toBe("");
    expect(
      resolveDocumentationLink("//tracker.example/x", "docs/security.md").href,
    ).toBe("");
    expect(
      resolveDocumentationLink("bad%file.md", "docs/security.md").href,
    ).toBe("");
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
          group: "Under the hood",
          source: "docs/security.md",
          markdown:
            '# Fixture\n\n## Safe heading\n\n<script>alert("private")</script>\n\n<img src="https://tracker.example/pixel" onerror="alert(1)" />\n\n[bad](javascript:alert%281%29)\n\n![Remote picture](https://tracker.example/photo.png)\n\n[Session](session-lifecycle.md)\n\n| Name | Value |\n| --- | --- |\n| Safe | Yes |',
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
