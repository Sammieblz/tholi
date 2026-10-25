// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  absoluteUrl,
  metadataForPath,
  publicPages,
  safeJson,
  seoTags,
  structuredData,
} from "../../../apps/web/src/features/seo/metadata";
import { articleCatalog } from "../../../apps/web/src/features/docs/catalog";
import { resolvePublicOrigin } from "../../../apps/web/src/config/project";

describe("website search metadata contracts", () => {
  it("gives every public route a unique title, description and canonical with safe metadata", () => {
    expect(new Set(publicPages.map((page) => page.path)).size).toBe(
      publicPages.length,
    );
    expect(new Set(publicPages.map((page) => page.title)).size).toBe(
      publicPages.length,
    );
    expect(new Set(publicPages.map((page) => page.description)).size).toBe(
      publicPages.length,
    );
    for (const page of publicPages) {
      const document = new DOMParser().parseFromString(
        `<head>${seoTags(page)}</head>`,
        "text/html",
      );
      expect(document.title).toBe(page.title);
      expect(document.querySelectorAll('link[rel="canonical"]')).toHaveLength(
        1,
      );
      expect(
        document.querySelector('link[rel="canonical"]')?.getAttribute("href"),
      ).toBe(absoluteUrl(page.path));
      expect(
        JSON.parse(
          document.querySelector('script[type="application/ld+json"]')!
            .textContent!,
        ),
      ).toEqual(structuredData(page));
      expect(page.title + page.description).not.toContain("\u2014");
      expect(
        document
          .querySelector('meta[property="og:image:width"]')
          ?.getAttribute("content"),
      ).toBe("1200");
      expect(
        document
          .querySelector('meta[name="twitter:card"]')
          ?.getAttribute("content"),
      ).toBe("summary_large_image");
    }
  });
  it("canonicalizes queries, fragments and trailing slashes while keeping unknown and retired routes out of the index", () => {
    expect(
      metadataForPath("/download/?browser=firefox#installation-firefox").path,
    ).toBe("/download");
    expect(metadataForPath("/docs/no-such-article").index).toBe(false);
    expect(metadataForPath("/no-such-page").index).toBe(false);
    expect(metadataForPath("/onboarding").index).toBe(false);
    for (const path of ["/signin", "/signup", "/welcome"]) {
      expect(metadataForPath(path).path).toBe("/download");
      expect(metadataForPath(path).index).toBe(false);
    }
    expect(
      articleCatalog.every((article) =>
        publicPages.some((page) => page.path === `/docs/${article.slug}`),
      ),
    ).toBe(true);
  });
  it("escapes attribute, element and JSON boundaries and refuses credential-bearing origins", () => {
    const value = `</script><script>alert("x")</script>\u2028`;
    expect(safeJson({ value })).not.toContain("<");
    const document = new DOMParser().parseFromString(
      `<head>${seoTags({ ...publicPages[0], title: value, description: value })}</head>`,
      "text/html",
    );
    expect(document.querySelectorAll("script")).toHaveLength(1);
    expect(document.title).toBe(value);
    expect(resolvePublicOrigin(undefined)).toBe("https://tholi.io");
    expect(resolvePublicOrigin("https://example.org/subpath")).toBe(
      "https://example.org",
    );
    expect(() =>
      resolvePublicOrigin("https://user:secret@example.org"),
    ).toThrow();
    expect(() => resolvePublicOrigin("javascript:alert(1)")).toThrow();
  });
});
