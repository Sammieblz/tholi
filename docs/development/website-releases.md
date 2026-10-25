# Website releases

Website delivery has an independent `MAJOR.MINOR.PATCH` identifier in
`apps/web/release.json`. It does not change the synchronized extension/API product
version or relabel old captures and downloads. Website tags use `web-vVERSION`;
product tags continue to use `vVERSION` under [the product procedure](releasing.md).

## Current deployment

Website **0.1.1** is published at **[tholi.io](https://tholi.io)** on Cloudflare
Pages. The [certified GitHub release](https://github.com/Sammieblz/tholi/releases/tag/web-v0.1.1) was published on October
25, 2026 from [`8269c96`](https://github.com/Sammieblz/tholi/commit/8269c963123ba65348919e1d21c9025b465350bd), after complete
[Full validation](https://github.com/Sammieblz/tholi/actions/runs/40228633819). The website ZIP, per-file provenance JSON and
SHA256 record are attached to that release.

The initial Cloudflare deployment of that source was verified: website version
0.1.1, primary routes, compiled assets and both approved store destinations.
See the [release record](../releases/website/v0.1.1/README.md) and
[certification and deployment evidence](../releases/website/v0.1.1/validation.md).
Extension/API version remains 0.11.0.

The previous 0.1.0 source release and its original tag remain unchanged.
Its deployment and source-only archive history are preserved in the
[0.1.0 record](../releases/website/v0.1.0/README.md).

## Prepare and validate

Website **0.1.1** is released. Use the next independent website version for
further changes; the published-store and account-free installation behavior is
recorded in its release notes.

1. Add `docs/releases/website/vVERSION/README.md` with first line
   `# Tholi website VERSION`, changes, boundaries and actual validation status.
2. For later releases, run `npm run release:website -- VERSION`. The number must
   increase and notes must already exist. `npm run check:website` verifies them.
3. Run focused website checks and the deterministic PR gate. Merge the reviewed
   branch into the repository's default branch. Git writes may need the owner's
   Git client in a workspace that restricts Git metadata.
4. In GitHub Actions, run **Full validation** on that default branch with
   **Publish the website release after certification** enabled. Leave extension
   candidate packaging disabled unless separately needed. Run the entire
   workflow again after a failed attempt; do not combine attempts.

## Certified archive publication

The website publication job requires the default branch and the successful
build, test and certification jobs. It downloads their immutable artifacts and
checks the full evidence again. `npm run package:website` uses the existing ZIP
writer and per-file verification; it never rebuilds or overwrites release files.
The resulting ZIP, JSON provenance and SHA256 record are attached to a GitHub
release for the exact tested commit. Publication is idempotent: an existing tag
or release makes the job stop rather than replace assets. Website releases do
not change which product release GitHub considers latest.

For 0.1.0, a source-only prerelease was published before merge with PR validation
recorded. It does not qualify as a certified archive. Because `web-v0.1.0`
already exists, the automatic job skips it. Prepare the next website version
and follow the full certification procedure above for future archive
publication; do not move the old tag or silently replace its evidence or assets.

This workflow does not merge branches, submit browser-store packages or deploy
Cloudflare. Version 0.1.0's account/store demonstrations are historical. Version
0.1.1 hides mock accounts and links to the published stores. Contact remains an
email-draft workflow; it does not send form submissions.

## Cloudflare Pages

The static route, favicon, sitemap and crawler outputs are part of `build:web`.
See [website SEO](website-seo.md) for owners, public crawl policy and post-deploy
checks. Cloudflare edge redirects and 404 behavior require a deployed check.

Run the build from the repository root. Use these settings for this repository:

| Setting                    | Value                         |
| -------------------------- | ----------------------------- |
| Production branch          | `main`                        |
| Root directory             | Leave blank (repository root) |
| Build command              | `npm run build:web`           |
| Build output directory     | `dist/web`                    |
| `NODE_VERSION`             | `24.19.0`                     |
| `VITE_THOLI_PUBLIC_ORIGIN` | `https://tholi.io`            |

`apps/web` contains source, not the files to publish. The Vite build writes
`dist/web`, including compiled JavaScript and `website-release.json`. The
public origin defaults to `https://tholi.io`; set the environment variable when
deploying to another origin. Cloudflare's
[build configuration](https://developers.cloudflare.com/pages/configuration/build-configuration/)
and [build image settings](https://developers.cloudflare.com/pages/configuration/build-image/)
describe the dashboard fields and Node override.

After deployment, open both store actions and verify their exact listing
destinations, then open primary routes directly and check their rendered
headings, compiled asset responses and `/website-release.json`. HTTP 200 alone
does not establish a working route because the SPA fallback can serve HTML.
Record the Cloudflare deployment revision separately when available; version
metadata alone does not identify its exact Git commit.

The current public deployment injects Cloudflare's analytics/performance
beacon. This runs independently of Tholi's preference-cookie controls and
inactive application analytics provider. Cloudflare can
[inject Web Analytics from the Pages dashboard](https://developers.cloudflare.com/pages/how-to/web-analytics/).
Review that configuration whenever measurement behavior changes, update the
privacy/cookie notices and verify actual network requests. App consent code
does not control a host-injected script.

Pages has a [25 MiB asset limit](https://developers.cloudflare.com/pages/platform/limits/#file-size),
while existing extension ZIPs are about 29 MB each. Published store links are the
primary installation path. Use suitable download hosting and verified links
before enabling developer ZIP downloads. Keep target-specific
checksums and versions intact; a local generated archive should not be copied
into a deployment merely because it is present in `output/`.
