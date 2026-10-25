import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { createServer, type Plugin } from "vite";

/** Emit crawler-readable pages from the same React owners used by the browser. */
export function staticSite(): Plugin {
  let outputDirectory = "";
  let mode = "production";
  const styles = new Map<string, string[]>();
  return {
    name: "tholi-static-site",
    apply: "build",
    configResolved(config) {
      outputDirectory = resolve(config.root, config.build.outDir);
      mode = config.mode;
    },
    generateBundle(_options, bundle) {
      for (const chunk of Object.values(bundle)) {
        if (chunk.type === "chunk") {
          const metadata = (
            chunk as typeof chunk & {
              viteMetadata?: { importedCss: Set<string> };
            }
          ).viteMetadata;
          styles.set(chunk.name, [...(metadata?.importedCss ?? [])]);
        }
      }
    },
    async closeBundle() {
      if (!outputDirectory) return;
      const server = await createServer({
        configFile: false,
        root: resolve("apps/web"),
        publicDir: false,
        mode,
        appType: "custom",
        server: { middlewareMode: true, watch: null, hmr: false },
        optimizeDeps: { noDiscovery: true },
      });
      try {
        const site = await server.ssrLoadModule("/src/entry-server.tsx");
        const template = await readFile(
          resolve(outputDirectory, "index.html"),
          "utf8",
        );
        const write = async (path: string, content: string) => {
          const destination = resolve(outputDirectory, path);
          await mkdir(dirname(destination), { recursive: true });
          await writeFile(destination, content);
        };
        // Keep a single slashless canonical convention. Pages serves /about.html as /about.
        const routes = [
          ...site.publicPages,
          { ...site.metadataForPath("/404"), path: "/404" },
        ];
        for (const page of routes) {
          const body = await site.renderPage(page.path);
          if (!body.includes("<h1"))
            throw new Error(`Missing static heading: ${page.path}`);
          const routeStyles = (styles.get(page.chunk) ?? [])
            .map((file) => `<link rel="stylesheet" href="/${file}">`)
            .join("\n");
          const html = template
            .replace(
              /<!-- tholi:seo:start -->[\s\S]*?<!-- tholi:seo:end -->/,
              () =>
                `<!-- tholi:seo:start -->\n${site.seoTags(page)}\n<!-- tholi:seo:end -->`,
            )
            .replace("</head>", () => `${routeStyles}\n</head>`)
            .replace(
              '<div id="root"></div>',
              () => `<div id="root">${body}</div>`,
            );
          await write(
            page.path === "/" ? "index.html" : page.path.slice(1) + ".html",
            html,
          );
        }
        const indexed = site.publicPages.filter(
          (page: { index: boolean }) => page.index,
        );
        await write(
          "sitemap.xml",
          `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${indexed.map((page: { path: string }) => `  <url><loc>${site.escapeHtml(site.absoluteUrl(page.path))}</loc></url>`).join("\n")}\n</urlset>\n`,
        );
        // Public retrieval is allowed, with the same access rules for humans and bots.
        await write(
          "robots.txt",
          `User-agent: *\nAllow: /\n\nSitemap: ${site.absoluteUrl("/sitemap.xml")}\n`,
        );
        await write(
          "_redirects",
          [
            ...site.retiredAccountPaths.flatMap((path: string) => [
              `${path} /download 301`,
              `${path}/ /download 301`,
            ]),
            ...Object.entries(site.documentationRedirects).map(
              ([path, destination]) => `${path} ${destination} 301`,
            ),
          ].join("\n") + "\n",
        );
        await write(
          "_headers",
          "/llms.txt\n  Content-Type: text/plain; charset=utf-8\n/llms-full.txt\n  Content-Type: text/plain; charset=utf-8\n/docs/*.md\n  Content-Type: text/markdown; charset=utf-8\n  X-Content-Type-Options: nosniff\n/icons/*\n  Cache-Control: public, max-age=604800\n",
        );
        const summary = `# Tholi\n\n> Tholi is a local website-navigation guide for desktop Chrome and Firefox. Users choose a destination, follow instructions and make their own clicks. No Tholi account is required.\n\nTholi is shortened from umtholi, the Zulu word for finder. It is operated by ILUNỌNSEN LLC in Ohio, United States. The current local extension is available on both stores. Cloud accounts, paid plans and credits are future roadmap work, not current services.\n\nNormal guidance runs locally. A private backend is optional and requires explicit configuration. Guidance can be incomplete on complex or unsupported websites. A store link click does not establish installation, and a website click does not establish task completion. Website practice is isolated from the installed extension.\n\n## Product\n\n- [Get Tholi](${site.absoluteUrl("/download")}): Published stores and installation help.\n- [About Tholi](${site.absoluteUrl("/about")}): Name, purpose and current limitations.\n- [Chrome Web Store](${site.stores.chromium.url}): Official Chrome listing.\n- [Firefox Add-ons](${site.stores.firefox.url}): Official Firefox listing.\n\n## Documentation\n\n${site.articles.map((article: { slug: string; title: string; description: string }) => `- [${article.title}](${site.absoluteUrl(`/docs/${article.slug}.md`)}): ${article.description}`).join("\n")}\n\n## Support and policies\n\n- [Support](${site.absoluteUrl("/support")}): Installation and navigation help.\n- [Contact](${site.absoluteUrl("/contact")}): Email-draft contact workflow.\n- [Privacy](${site.absoluteUrl("/privacy")}): Local data, optional backends and website measurements.\n- [Terms](${site.absoluteUrl("/terms")}): Current service boundaries.\n- [Cookies](${site.absoluteUrl("/cookies")}): Cookie controls and independent Cloudflare measurements.\n\n## Optional\n\n- [Complete documentation](${site.absoluteUrl("/llms-full.txt")}): Combined public documentation.\n- [Source repository](${site.repositoryUrl}): MIT-licensed source and development.\n`;
        await write("llms.txt", summary);
        const full = [summary];
        for (const article of site.articles) {
          // Resolve relative links against the existing documentation owner, not the export path.
          const markdown = article.markdown
            .replace(
              /(!?\[[^\]]*\]\()([^\s)]+)(\))/g,
              (
                _match: string,
                prefix: string,
                href: string,
                suffix: string,
              ) => {
                const resolved = site.resolveDocumentationLink(
                  href,
                  article.source,
                );
                return (
                  prefix +
                  (resolved.local
                    ? site.absoluteUrl(
                        resolved.href.startsWith("#")
                          ? `/docs/${article.slug}${resolved.href}`
                          : resolved.href,
                      )
                    : resolved.href || href) +
                  suffix
                );
              },
            )
            .replace(/\u2014/g, " - ");
          await write(`docs/${article.slug}.md`, markdown);
          full.push(
            `\n\nSource: ${site.absoluteUrl(`/docs/${article.slug}`)}\n\n${markdown}`,
          );
        }
        await write("llms-full.txt", full.join("\n"));
        console.log(
          `Prerendered ${routes.length} public pages, sitemap and LLM documentation exports.`,
        );
      } finally {
        await server.close();
      }
    },
  };
}
