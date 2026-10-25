# Tholi website 0.1.1

Tholi is published on the Chrome Web Store and Firefox Add-ons. This website
update makes store installation the main path for the account-free local
extension.

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

Existing branding, fonts, themes, motion and arrow-free button styling remain.
Real accounts, cloud plans, payments and credits stay in the existing roadmap.
Extension/API version remains **0.11.0**. Existing tags, archives and historical
validation records are unchanged.

See [validation](validation.md) for actual checks. Publication of a certified
website archive requires the existing full-certification workflow. Merge and
Cloudflare deployment follow [website releases](../../../development/website-releases.md).

After deployment, verify both store links, primary route headings and
`/website-release.json` at tholi.io, and record the Cloudflare deployment revision.
