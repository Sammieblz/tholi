import { createElement, useMemo, useState, type ReactNode } from "react";
import Markdown, { type ExtraProps } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Search } from "iconoir-react";
import { SiteLink } from "../../app/router";
import {
  articles,
  documentationGroups,
  headingId,
  repositoryUrl,
  resolveDocumentationLink,
  searchDocumentation,
  type DocumentationArticle,
} from "./registry";
import "./docs.css";

export function documentHeadings(markdown: string) {
  const used = new Map<string, number>();
  let fenced = false;
  return markdown.split(/\r?\n/).flatMap((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) {
      fenced = !fenced;
      return [];
    }
    if (fenced) return [];
    const match = line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (!match) return [];
    const text = match[2].replace(/[*_`]/g, "");
    const base = headingId(text);
    const occurrence = used.get(base) || 0;
    used.set(base, occurrence + 1);
    return [
      {
        line: index + 1,
        text,
        level: match[1].length,
        id: `${base}${occurrence ? `-${occurrence}` : ""}`,
      },
    ];
  });
}
export function DocumentationBody({
  article,
}: {
  article: DocumentationArticle;
}) {
  const markdown = article.markdown.replace(/^# [^\r\n]+\r?\n/, "");
  const headings = documentHeadings(markdown);
  function Heading({ children, node }: ExtraProps & { children?: ReactNode }) {
    const heading = headings.find(
      (item) => item.line === node?.position?.start.line,
    );
    const tag = node?.tagName === "h1" ? "h2" : node?.tagName || "h2";
    return createElement(
      tag,
      { id: heading?.id, className: "docs-heading" },
      children,
      heading && (
        <SiteLink
          to={`#${heading.id}`}
          className="docs-heading-link"
          aria-label={`Link to ${heading.text}`}
        >
          <span aria-hidden="true">#</span>
        </SiteLink>
      ),
    );
  }
  return (
    <>
      {headings.some((heading) => heading.level <= 3) && (
        <nav className="docs-contents" aria-label="On this page">
          <p>On this page</p>
          <ul>
            {headings
              .filter((heading) => heading.level <= 3)
              .map((heading) => (
                <li key={heading.id}>
                  <SiteLink to={`#${heading.id}`}>{heading.text}</SiteLink>
                </li>
              ))}
          </ul>
        </nav>
      )}
      <div className="docs-prose">
        <Markdown
          remarkPlugins={[remarkGfm]}
          skipHtml
          components={{
            h1: Heading,
            h2: Heading,
            h3: Heading,
            h4: Heading,
            h5: Heading,
            h6: Heading,
            a: ({ href = "", children }) => {
              const resolved = resolveDocumentationLink(href, article.source);
              if (!resolved.href) return <span>{children}</span>;
              return resolved.local ? (
                <SiteLink to={resolved.href}>{children}</SiteLink>
              ) : (
                <a href={resolved.href} rel="noreferrer">
                  {children}
                </a>
              );
            },
            img: ({ alt, src }) => {
              const resolved = resolveDocumentationLink(
                src || "",
                article.source,
              );
              return resolved.href ? (
                <a href={resolved.href}>{alt || "View source illustration"}</a>
              ) : null;
            },
            table: ({ children }) => (
              <div className="docs-table">
                <table>{children}</table>
              </div>
            ),
          }}
        >
          {markdown}
        </Markdown>
      </div>
    </>
  );
}
export function DocsPage({ slug }: { slug?: string }) {
  const [query, setQuery] = useState("");
  const results = useMemo(() => searchDocumentation(query), [query]);
  const article = articles.find((item) => item.slug === slug);
  return (
    <section className="docs-layout">
      <aside className="docs-sidebar">
        <SiteLink to="/docs" className="docs-home">
          Tholi documentation
        </SiteLink>
        <label htmlFor="docs-search" className="docs-search-label">
          Search documentation
        </label>
        <div className="docs-search-field">
          <Search aria-hidden="true" />
          <input
            id="docs-search"
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Find an answer"
            autoComplete="off"
          />
        </div>
        {query.trim() ? (
          <nav aria-label="Documentation search results">
            <p role="status" className="docs-result-count">
              {results.length} {results.length === 1 ? "article" : "articles"}{" "}
              found
            </p>
            <ul className="docs-navigation">
              {results.map((item) => (
                <ArticleNavigationItem
                  key={item.slug}
                  item={item}
                  slug={slug}
                />
              ))}
            </ul>
            {!results.length && (
              <p className="docs-empty">
                Try a shorter phrase, such as permissions or widget.
              </p>
            )}
          </nav>
        ) : (
          <nav aria-label="Documentation chapters">
            {documentationGroups.map((group) => (
              <div className="docs-nav-group" key={group}>
                <h2>{group}</h2>
                <ul className="docs-navigation">
                  {articles
                    .filter((item) => item.group === group)
                    .map((item) => (
                      <ArticleNavigationItem
                        key={item.slug}
                        item={item}
                        slug={slug}
                      />
                    ))}
                </ul>
              </div>
            ))}
          </nav>
        )}
      </aside>
      <div className="docs-content">
        {article ? (
          <article key={article.slug}>
            <header className="docs-article-header">
              <p className="eyebrow">{article.group}</p>
              <h1>{article.title}</h1>
              <p className="web-intro">{article.description}</p>
              <a
                className="docs-source-link"
                href={`${repositoryUrl}/blob/main/${article.source}`}
              >
                Read the Markdown source
              </a>
            </header>
            <DocumentationBody article={article} />
            <footer className="docs-article-footer">
              <p>
                This page comes from the current repository reference. Dated
                validation reports describe their recorded build, rather than
                promising results on every website.
              </p>
              <a href={`${repositoryUrl}/issues`}>
                Report a documentation issue
              </a>
            </footer>
          </article>
        ) : slug ? (
          <div className="docs-not-found">
            <h1>That article isn’t here.</h1>
            <p>
              Choose a chapter from the documentation or start with
              installation.
            </p>
            <SiteLink className="web-primary" to="/docs/getting-started">
              Getting started
            </SiteLink>
          </div>
        ) : (
          <>
            <header className="docs-index-header">
              <p className="eyebrow">A little direction</p>
              <h1>Make yourself at home.</h1>
              <p className="web-intro">
                Start with your first destination, understand how Tholi keeps
                your place, or look under the hood. These are the same reference
                documents maintained with the product.
              </p>
            </header>
            <div className="docs-index-grid">
              {results.map((item) => (
                <SiteLink
                  className="docs-index-card"
                  to={`/docs/${item.slug}`}
                  key={item.slug}
                >
                  <span>{item.group}</span>
                  <h2>{item.title}</h2>
                  <p>{item.description}</p>
                </SiteLink>
              ))}
            </div>
            {!results.length && (
              <p role="status">No articles match that search.</p>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ArticleNavigationItem({
  item,
  slug,
}: {
  item: DocumentationArticle;
  slug?: string;
}) {
  return (
    <li>
      <SiteLink
        to={`/docs/${item.slug}`}
        aria-current={slug === item.slug ? "page" : undefined}
      >
        {item.title}
      </SiteLink>
    </li>
  );
}
