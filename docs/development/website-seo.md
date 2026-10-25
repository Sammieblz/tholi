# Website search and crawler support

The website build produces public HTML, metadata and discovery files for
tholi.io. This uses the existing React page owners and documentation registry.
It does not require a running backend, a browser in Cloudflare's build image,
or an external rendering service.

## Owners and generated output

- `apps/web/src/features/seo/metadata.ts` owns titles, descriptions, canonical
  URLs, Open Graph, Twitter cards and JSON-LD. Client navigation updates the
  same metadata without accumulating duplicate tags.
- `apps/web/src/features/docs/catalog.ts` shares article metadata with the
  documentation UI, SEO and static exports. The eight public guides live in
  `docs/help/` and stay outside the initial JavaScript bundle. Repository
  architecture, API and contributor references are linked, not imported.
- `apps/web/src/entry-server.tsx` renders the actual public components with
  empty cookie access and an isolated static router. It resolves lazy pages,
  then serializes plain markup without hidden streaming fragments. Static form
  controls are disabled until their client handlers mount. Native links work
  immediately. No browser globals, account data or extension state are mocked.
- `apps/web/build/static-site.ts` extends the existing Vite build. It produces
  18 public page documents and `404.html`, route styles, `sitemap.xml`,
  `robots.txt`, `llms.txt`, `llms-full.txt`, documentation `.md` files, Cloudflare
  `_headers` and `_redirects`. Seventeen canonical routes are indexable. Optional
  onboarding and missing pages use `noindex, follow`.

Run `npm run build:web`. Output remains `dist/web`. Canonicals use
`VITE_THOLI_PUBLIC_ORIGIN`, defaulting to `https://tholi.io`, shared with legal
notices. Invalid or credential-bearing values fail instead of publishing a
misleading origin. Queries and fragments are excluded from canonical URLs.

The existing client app takes over the static markup and retains browser-aware
store actions, local practice, themes, cookie choices and section motion. Without
JavaScript, public copy, store links and documentation remain available. A
visible notice explains that interactive controls need JavaScript and supplies
the support email. Cookie banners and contact forms are hidden in that mode.

JSON-LD describes the operator, website, local application, documentation and
breadcrumb hierarchy. It uses actual store links and the product version. No
review counts, ratings, invented modification dates or future paid plans are
added. Search engines decide whether to index a page or display rich results.
Public help uses `Article` structured data.

`features/docs/redirects.ts` shares retired technical destinations between the
client router and Cloudflare output. The four old technical article URLs, their
trailing-slash and `.html` aliases lead to the matching GitHub references. Their
`.md` aliases lead to raw GitHub Markdown. Client replacement navigation retains
fragments without adding a redirect entry to Back history. Retained help URLs
continue to use local search and heading navigation.

## Favicons and sharing

The source mark and wordmark remain unchanged. Website derivatives use the
existing cream background, green mark and amber point:

| Asset                      | Location                                    | Size                                |
| -------------------------- | ------------------------------------------- | ----------------------------------- |
| Browser icon               | `apps/public/favicon.ico`                   | 16, 32 and 48 px frames             |
| PNG favicons               | `apps/public/icons/favicon-SIZE.png`        | 16, 32, 48 and 96 px                |
| Apple touch icon           | `apps/public/apple-touch-icon.png`          | 180 px                              |
| Android and shortcut icons | `apps/public/icons/icon-SIZE.png`           | 192 and 512 px                      |
| Maskable icon              | `apps/public/icons/maskable-512.png`        | 512 px, mark inside the safe circle |
| Social preview             | `apps/public/media/social/tholi-social.png` | 1200 x 630 px                       |

`site.webmanifest` describes website shortcuts with `display: browser`. It does
not claim to install the browser extension or provide an offline application.
The toolbar theme color follows the site's explicit appearance choice.

Regenerate committed assets with `node scripts/build-web-assets.mjs`. This local
authoring command uses existing Sharp, Playwright and bundled font dependencies.
It needs an installed Playwright Chromium browser. Production builds only copy
the committed files. The social asset's provenance records source image and
font hashes. Existing extension icons and release archives are unchanged.

## AI retrieval

`robots.txt` permits public crawling and points to the sitemap. The same public
HTML is served to humans and bots. This does not export local user knowledge,
tasks, conversations, cookies or private backend information.

`llms.txt` provides a concise product description, current limits and links to
public documentation. Each article has a Markdown export and an alternate link
in its HTML head. Relative documentation links resolve through the existing
registry. `llms-full.txt` combines the public references. New descriptions and
exports avoid em dashes.

`llms.txt` is a discovery convention, not a guarantee of inclusion, ranking or
citation. Search and model-training crawlers have separate policies. The current
wildcard policy allows public crawlers, including training crawlers that honor
it. Change that policy explicitly if different access is desired. Robots rules
are not authentication and cannot override Cloudflare bot or firewall settings.

## Cloudflare and deployment checks

Keep the approved root build command `npm run build:web`, output `dist/web` and
Node 24.19.0. Generated `/about.html` and `/docs/getting-started.html` files use
Cloudflare's extensionless routing, giving `/about` and `/docs/getting-started`
the correct raw HTML. A top-level `404.html` gives missing assets and routes a
real 404 instead of returning the homepage shell. Retired account URLs receive
301 redirects to `/download`; client replacement redirects remain as a fallback.

After the approved deployment:

1. Fetch `/`, `/download`, `/about`, `/docs/getting-started`, `/sitemap.xml`,
   `/robots.txt`, `/llms.txt` and one `.md` export without executing JavaScript.
   Check actual content, canonical URLs and content types.
2. Check 301 responses for the retired account URLs and a 404 for an unknown
   route and missing asset. Vite preview does not emulate Cloudflare edge rules.
3. Check the social image, icons, manifest and `/website-release.json`. Verify
   store links and client Back/Forward behavior after scripts load.
4. Keep Cloudflare preview deployments out of the index. Cloudflare normally
   supplies `X-Robots-Tag: noindex` on previews. Verify it and keep the production
   custom domain indexable. Review any bot rules blocking intended AI retrieval.
5. Submit `https://tholi.io/sitemap.xml` through the owner's Google Search Console
   and Bing Webmaster Tools accounts. Use URL Inspection and Rich Results Test
   on the deployed pages. No unverified ownership or account IDs are embedded.

Focused checks live in the existing website unit/browser owners. Run the PR
gate after implementation and the full certification workflow before publishing
an archive. See [website releases](website-releases.md).

## Guidance and references

Applied `.codex/skills/ui-ux-pro-max/SKILL.md` and
`.codex/skills/fixing-accessibility/SKILL.md`: retain the established logo,
palette and fonts, descriptive image alternatives, semantic headings, native
links and readable content without motion scripts. The targeted favicon and
brand-icon database searches had no verified match. Asset sizes follow the
platform references below; brand treatment follows the existing repository.

- [Google JavaScript SEO](https://developers.google.com/search/docs/crawling-indexing/javascript/javascript-seo-basics)
- [Google favicon guidance](https://developers.google.com/search/docs/appearance/favicon-in-search)
- [Google software application structured data](https://developers.google.com/search/docs/appearance/structured-data/software-app)
- [Open Graph protocol](https://ogp.me/)
- [MDN web app icons](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Manifest/Reference/icons)
- [React static rendering](https://react.dev/reference/react-dom/static)
- [Cloudflare page routing](https://developers.cloudflare.com/pages/configuration/serving-pages/)
- [Cloudflare preview indexing](https://developers.cloudflare.com/pages/configuration/preview-deployments/)
- [OpenAI crawler controls](https://developers.openai.com/api/docs/bots)
- [Anthropic crawler controls](https://support.anthropic.com/en/articles/8896518-does-anthropic-crawl-data-from-the-web-and-how-can-site-owners-block-the-crawler)
- [llms.txt proposal](https://llmstxt.org/)
