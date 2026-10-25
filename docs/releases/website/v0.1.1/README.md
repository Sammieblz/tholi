# Tholi website 0.1.1

Status: **published, certified and deployed** on October 25, 2026.

- [GitHub release `web-v0.1.1`](https://github.com/Sammieblz/tholi/releases/tag/web-v0.1.1), with the verified website ZIP,
  provenance JSON and SHA256 record.
- Certified source [`8269c96`](https://github.com/Sammieblz/tholi/commit/8269c963123ba65348919e1d21c9025b465350bd) after complete
  [Full validation](https://github.com/Sammieblz/tholi/actions/runs/40228633819), run `40228633819-1`.
- The initial Cloudflare deployment serves website 0.1.1 at
  [tholi.io](https://tholi.io). Its primary routes, compiled assets and both
  approved store destinations passed post-deployment checks.

Tholi is published on the Chrome Web Store and Firefox Add-ons. This website
update makes store installation the main path for the account-free local
extension.

## Changes

- Both browser cards link directly to their approved listings. Recognized desktop
  browsers receive a matching header action; other browsers receive Get Tholi.
- Setup explains browser confirmation, opening/pinning Tholi, website access and
  starting guidance. Store clicks never establish completed installation.
- Mock accounts are removed from public routing and production imports. Legacy
  account routes replace their history entry with `/download`. Optional onboarding
  offers installation information and isolated practice without an account.
- Developer ZIPs, integrity information, source builds and manual directions are
  secondary, inside a collapsed disclosure. Metadata loads when opened; existing
  browser/query/fragment links still open the matching developer instructions.
- Current marketing, help and legal copy reflects store publication. Contact
  continues to prepare email drafts without claiming form delivery.
- Public routes include static HTML, route-specific search/social metadata,
  structured data, a sitemap and LLM-readable documentation. Website favicons,
  mobile shortcut icons and the social banner reuse the existing brand assets.
  See [SEO owners and deployment checks](../../../development/website-seo.md).
- Documentation now offers eight practical guides for installation, daily use,
  privacy and troubleshooting, with one short developer overview. Technical
  references remain in the repository; their old public URLs redirect to the
  matching GitHub documents. Search and crawler exports use the public help.
- Documentation styling uses a bounded reading column, larger body text and a
  sticky contents rail on wide screens. Smaller layouts retain inline contents.
  Larger serif group labels and dividers distinguish navigation categories from
  links. A narrow ink marker identifies the current guide without a filled pill.
  Headings and guide cards reveal once with short motion; typing, keyboard use
  and reduced motion keep reading immediate. Mouse section navigation avoids
  a full-row heading outline while keyboard focus remains visible.

Existing branding, fonts, themes and arrow-free button styling remain.
Real accounts, cloud plans, payments and credits stay in the existing roadmap.
Extension/API version remains **0.11.0**. Existing tags, archives and historical
validation records are unchanged.

## Validation

See [validation](validation.md) for certification, archive hashes and deployment
checks. Future website releases follow the same
[release procedure](../../../development/website-releases.md).
