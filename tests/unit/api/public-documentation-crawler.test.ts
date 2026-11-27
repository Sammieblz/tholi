import { describe, expect, it } from "vitest";
import {
  createPublicDocumentationCrawler,
  isPublicDocumentationAddress,
} from "../../../apps/api/src/adapters/public-documentation-crawler";
import {
  createPublicDocumentationFetcherServer,
  createRemotePublicDocumentationCrawler,
} from "../../../apps/api/src/adapters/public-documentation-fetcher";
import { publicDocumentationCrawlSchema } from "../../../packages/navigation-core/contracts-organization";

const input = publicDocumentationCrawlSchema.parse({
  schemaVersion: 1,
  origin: "https://docs.example.test",
  url: "https://docs.example.test/docs/",
});

describe("bounded public documentation discovery", () => {
  it("follows robots and a same-origin sitemap within the requested docs section", async () => {
    const requested: string[] = [];
    const crawler = createPublicDocumentationCrawler(
      async (url, _signal, maxBytes) => {
        requested.push(url.href);
        if (url.pathname === "/robots.txt")
          return {
            status: 200,
            contentType: "text/plain",
            body: "User-agent: *\nDisallow: /docs/private\nSitemap: https://docs.example.test/sitemap.xml",
          };
        if (url.pathname === "/sitemap.xml")
          return {
            status: 200,
            contentType: "application/xml",
            body: "<urlset><url><loc>https://docs.example.test/docs/start</loc></url><url><loc>https://docs.example.test/docs/private</loc></url><url><loc>https://docs.example.test/admin</loc></url></urlset>",
          };
        expect(maxBytes).toBeGreaterThan(0);
        return {
          status: 200,
          contentType: "text/html; charset=utf-8",
          body: `<main><h1>${url.pathname}</h1><script>not executed</script><a href="/docs/linked">Next</a></main>`,
        };
      },
    );

    const result = await crawler.crawl(input, new AbortController().signal);
    expect(result.documents.map((page) => new URL(page.url).pathname)).toEqual([
      "/docs/",
      "/docs/start",
    ]);
    expect(result.documents[0].title).toBe("/docs/");
    expect(result.documents[0].html).toContain("not executed");
    expect(result.skipped).toBe(1);
    expect(requested).not.toContain("https://docs.example.test/docs/private");
    expect(requested).not.toContain("https://docs.example.test/admin");
  });

  it("never follows a redirect to another origin or to an insecure scheme", async () => {
    const requested: string[] = [];
    const crawler = createPublicDocumentationCrawler(async (url) => {
      requested.push(url.href);
      return {
        status: 302,
        contentType: "text/plain",
        location: "https://attacker.example.test/collect",
        body: "",
      };
    });
    await expect(
      crawler.crawl(input, new AbortController().signal),
    ).rejects.toThrow("CRAWL_REDIRECT_BLOCKED");
    expect(requested).toEqual(["https://docs.example.test/robots.txt"]);
  });

  it("applies robots and the approved section before requesting each redirected page", async () => {
    for (const location of ["/other/guide", "/docs/private/help"]) {
      const requested: string[] = [];
      const crawler = createPublicDocumentationCrawler(async (url) => {
        requested.push(url.pathname);
        if (url.pathname === "/robots.txt")
          return {
            status: 200,
            contentType: "text/plain",
            body: "User-agent: *\nDisallow: /docs/private",
          };
        if (url.pathname === "/sitemap.xml")
          return { status: 404, contentType: "text/plain", body: "" };
        return { status: 302, contentType: "text/html", location, body: "" };
      });
      const result = await crawler.crawl(input, new AbortController().signal);
      expect(result.documents).toHaveLength(0);
      expect(requested).toEqual(["/robots.txt", "/sitemap.xml", "/docs/"]);
    }
  });

  it("rejects noncanonical, credentialed, queried and out-of-scope seeds", async () => {
    for (const url of [
      "http://docs.example.test/docs/",
      "https://user:pass@docs.example.test/docs/",
      "https://docs.example.test/docs/?token=hidden",
      "https://docs.example.test/help/",
    ]) {
      const candidate = publicDocumentationCrawlSchema.safeParse({
        ...input,
        url,
      });
      if (url.includes("/help/")) {
        expect(candidate.success).toBe(true);
        const crawler = createPublicDocumentationCrawler(async () => ({
          status: 404,
          contentType: "text/plain",
          body: "",
        }));
        // A different approved section is allowed as its own seed. It cannot
        // expand the crawl to siblings outside that section.
        const result = await crawler.crawl(
          candidate.data!,
          new AbortController().signal,
        );
        expect(result.documents).toHaveLength(0);
      } else {
        expect(candidate.success).toBe(false);
      }
    }
  });

  it("rejects private, link-local, special-use, mapped and documentation IPs", () => {
    for (const address of [
      "0.0.0.0",
      "10.0.0.1",
      "100.64.0.1",
      "127.0.0.1",
      "169.254.169.254",
      "172.16.0.1",
      "192.168.1.1",
      "198.51.100.1",
      "224.0.0.1",
      "::1",
      "::ffff:127.0.0.1",
      "fc00::1",
      "fe80::1",
      "2001:db8::1",
      "2606:4700:4700::1111%eth0",
    ])
      expect(isPublicDocumentationAddress(address), address).toBe(false);
    expect(isPublicDocumentationAddress("8.8.8.8")).toBe(true);
    expect(isPublicDocumentationAddress("2606:4700:4700::1111")).toBe(true);
  });

  it("fails closed when robots access is unavailable and respects cancellation", async () => {
    const unavailable = createPublicDocumentationCrawler(async () => ({
      status: 503,
      contentType: "text/plain",
      body: "temporarily unavailable",
    }));
    await expect(
      unavailable.crawl(input, new AbortController().signal),
    ).rejects.toThrow("CRAWL_ROBOTS_UNAVAILABLE");

    const controller = new AbortController();
    controller.abort();
    await expect(unavailable.crawl(input, controller.signal)).rejects.toThrow();
  });

  it("bounds and validates the private API-to-fetcher contract", async () => {
    const server = createPublicDocumentationFetcherServer({
      async crawl(request, signal) {
        expect(request).toEqual(input);
        expect(signal.aborted).toBe(false);
        return {
          documents: [
            {
              url: "https://docs.example.test/docs/",
              title: "Start here",
              html: "<main><h1>Start here</h1></main>",
            },
          ],
          visited: 1,
          skipped: 0,
        };
      },
    });
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    const address = server.address();
    if (!address || typeof address === "string")
      throw Error("Missing test port");
    try {
      const remote = createRemotePublicDocumentationCrawler(
        `http://127.0.0.1:${address.port}`,
      );
      await expect(
        remote.crawl(input, new AbortController().signal),
      ).resolves.toMatchObject({
        visited: 1,
        documents: [{ title: "Start here" }],
      });
    } finally {
      await new Promise<void>((resolve, reject) =>
        server.close((error) => (error ? reject(error) : resolve())),
      );
    }
  });
});
