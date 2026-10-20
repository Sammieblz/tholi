# Tholi website 0.1.0

Status: **unreleased**. Prepare on `web-release`, merge to the default branch,
then run Full validation with website publication enabled. A local preview or
focused pass does not certify an archive or establish publication.

## Changes

- GSAP reveals on marketing and installation pages: headings, supporting text
  and media enter separately as scrolling reaches each block. Entrances last
  1.1 seconds with an 80 ms stagger and play once per visit, with route cleanup,
  keyboard access and reduced-motion support.
- Header returns on upward scroll; navigation order is About, Get Tholi, Docs,
  Sign in. Get started opens the existing sign-up preview.
- Self-hosted Newsreader headings and Source Sans 3 body text. Tholi's palette,
  wordmark, theme control and shared extension UI remain intact.
- Chrome and Firefox installation cards use official browser artwork and lead
  to their illustrated manual setup. Store destinations remain mocked until
  approved listing URLs exist. Firefox's temporary-installation limit is explicit.
- Clear local account previews and the revised privacy and terms notices.
- Label-led website buttons and links without decorative arrows, including the
  embedded practice controls. Conversation retains a visible Send label.
- One Get started action in the header; the hero pairs Get Tholi with Try it here
  and links directly to the practice. About credits umtholi, Zulu for “finder,”
  and explains that Tholi is a shortened name.
- Dedicated Support and Contact pages, linked from the footer and About. Support
  connects installation, usage, permissions and common questions to current docs.
  The accessible contact form prepares an email draft and offers a copy fallback;
  message delivery and SMTP are not connected. Drafts stay in page memory.

## Compatibility and boundaries

Website delivery is versioned as `web-v0.1.0`. The extension, optional API and
bundled workspaces retain their synchronized product version, currently 0.11.0.
Historical captures, downloads and release evidence retain their original versions.
Accounts remain mock browser sessions; no real authentication or cloud sync is
introduced. No browser-store listing or Cloudflare deployment is implied.

## Design guidance

Applied project-local skills from `.codex/skills`, whose provenance is recorded
in `.codex/skills-manifest.json`:

- `animate`: marketing reveals explain page structure, play once and use a
  32–40 px offset; text blocks stagger rather than fading entire sections at
  once. Button feedback uses fast CSS transitions. Explicit GSAP request takes
  precedence over the general preference to avoid a library for a fade.
- `emil-design-eng`: transform/opacity motion, responsive press states, pointer
  hover gating and accessible interruption.
- `animation-performance`: no React updates per scroll frame, no animated layout
  dimensions, no persistent blanket `will-change` or animated blur.
- `ui-ux-pro-max`: researched product-demo patterns, editorial typography,
  ScrollTrigger reveals and React effect cleanup. Existing brand tokens override
  the generic palette recommendation. Newsreader's editorial readability is
  paired with Source Sans 3 for clear controls and body copy.
- `fixing-accessibility` and `baseline-ui`: native labeled form controls, required
  indicators, inline error associations, focus on the first invalid field and a
  focusable draft heading. Contact stays stationary while editing; copy feedback
  uses a status region with a selectable fallback. The form precedes secondary
  help in DOM and mobile reading order.

The support/contact design-system search informed readable hierarchy and clear
form feedback. Its generic palette and font recommendations were rejected in
favor of Tholi's existing tokens, Newsreader and Source Sans 3. A targeted
error-validation search confirmed inline errors and accessible focus handling.

The existing [website design record](../../v0.10.1/website.md) reserves icons
for functional controls and uses direct action labels on marketing links. The
October 20 correction removes the added CTA arrows and scopes practice styling
to the website's shadow root; installed extension controls are unchanged.

## Validation

Local PR validation passed on October 20, 2026: 312 unit checks and 107 browser
checks on the corrected build. Chromium/Firefox checks cover the contact draft,
copy fallback, validation/focus, footer navigation, hero practice action and Zulu
name credit, as well as one-time reveals and reduced-motion handling. Separate
responsive checks passed 224 route/theme/viewport combinations across all 14
routes. Types, website version metadata, formatting and production build checks
passed. See
[validation scope and evidence](validation.md).

Full certification on the merged source remains required before packaging.

## Publish after merge

See [website release procedure](../../../development/website-releases.md).
The optional publication job reuses the exact build from the same complete,
passing full-validation run; it does not rebuild or package the extensions.
