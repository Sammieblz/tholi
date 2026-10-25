# Website 0.1.1 validation

Validation was performed on Windows with Node 24.19.0 on October 25, 2026.
Website metadata is **0.1.1**; extension/API metadata remains **0.11.0**.
No certified archive, GitHub publication or Cloudflare deployment has been made
for this update.

## Published-store preparation checks

These completed checks describe the store-launch preparation before the SEO
follow-up. The additional SEO work has its own validation record below.

- Focused website unit suites: **28 passed** across five files.
- Production website build and TypeScript: passed. The production JavaScript
  contains no mock account runtime or controls. The cookie notice alone mentions
  the ignored legacy storage key.
- Website browser scope: **52 passed** in Chromium 156.0.8078.4 and Playwright
  Firefox 157.0. Run `ba3d46d1-9690-4de3-83d1-e8b4d2a4c8af` used the full tier
  with a focused website selection. This is feedback, not full certification.
  The final documentation alignment and legacy-session assertions are also
  included in the coordinated PR gate below.
- `npm run test:ci`: **passed**, run
  `43f62787-0a65-4a3a-b76f-194fc0e9bac8`, complete PR selection. All **321 unit
  tests** and **124 browser cases** passed: core 47, integration 20, installed
  Firefox 2 and UI 55. The original run passed TypeScript and the production
  build; the complete rerun verified those unchanged artifacts using the
  documented `THOLI_BUILD_PREPARED=1` option after the test-only readiness
  correction described below.
- Existing Chromium, Firefox, Firefox AMO and source ZIPs still match their
  recorded SHA-256 files. Existing archives were not overwritten.

Browser coverage includes exact store destinations and actual intercepted
navigation clicks, no metadata fetch until developer disclosure, missing/invalid/
unavailable metadata, target rejection, developer ZIP checksums, query/fragment
links, retired-route replacement history, account-free practice, desktop/mobile
navigation, contact drafts and cookie choices. Existing layout coverage exercised
320, 375, 768 and 1440 pixels in both themes, keyboard focus, reduced motion and
normal scroll reveals.

Feedback artifacts are under `output/qa/website-0.1.1/`: the preserved
`website-focused-build.json` and timing report, the coordinated `test-ci.log`,
`test-ci-core-regressions.json`, UI evidence and desktop/mobile review captures.
The tracked historical core report was restored after preserving this run’s
generated evidence separately. These generated files are excluded from the
source change. Review covered browser cards, header actions and onboarding;
existing branding, fonts, themes and button styling are retained.

The first PR-gate attempt exposed a Firefox fixture race: it inserted and clicked
a legacy bookmark before the lazy About route completed its initial focus. The
test now waits for that real heading before inserting the bookmark; redirect,
Back/Forward and stale-session assertions are unchanged. Three repetitions of
each retired route passed in Firefox (**9 cases**). The original failed run and
trace are retained separately; they are not counted as a successful gate.

Website version checks, formatting and whitespace checks passed. No temporary
diagnostic source or additional production dependency was introduced.

## Design guidance

Applied project-local guidance:

- `.codex/skills/ui-ux-pro-max/SKILL.md`: preserve the established visual identity,
  predictable Back navigation, progressive disclosure, 44-pixel targets,
  keyboard access and responsive layouts. Targeted local searches informed
  navigation guidance; no unrelated design system was introduced.
- `.codex/skills/fixing-accessibility/SKILL.md`: native anchors and disclosure,
  descriptive link names, decorative browser logos, visible focus, reduced motion
  and existing dialog focus behavior. Upstream skill files remain unchanged.

Store listings were checked on October 25, 2026: Chrome returned the Tholi listing
and Firefox's official add-on API returned Tholi 0.11.0 with Firefox 153 minimum.
This does not certify native installation, permission dialogs, screen-reader
speech or signed-in website workflows; those checks remain pending.

## SEO follow-up

The initial SEO follow-up built 22 plain HTML documents, route-specific metadata, structured
data, a sitemap, crawler guidance and Markdown exports. Brand-derived icons and
the social preview are committed assets. The runtime shares route metadata with
the generated HTML. Details and primary references are in
[website SEO](../../../development/website-seo.md).

- Focused website unit checks: **31 passed** across six files.
- Complete website feedback scope: **58 passed**, Chromium and Firefox, run
  `d36c637b-3a59-41b0-970a-16c325a33113`. Coverage includes all public pages with
  JavaScript disabled, native store navigation, raw metadata, JSON-LD, canonical
  history, crawler exports, icon formats and existing four-width/two-theme UI.
- TypeScript and the complete production build passed. The first PR-gate attempt,
  `e9af6b8a-dc64-4e14-a501-9b95bf2cd106`, stopped before UI cases because the default
  preview port was occupied. Its reports are retained separately as failed-run
  evidence.
- The complete `test:ci` rerun, `ba1699b1-3894-4650-9bb7-e4c18ddf094e`, passed:
  **324 unit tests and 130 browser cases** (47 core, 20 integration, 2 native
  Firefox and 61 UI). It used the documented prepared-build option, verified the
  unchanged build manifest, and explicitly selected UI port 5188. No source or
  build artifacts changed between these attempts.

Current evidence is preserved under `output/qa/website-seo/`, separate from the
earlier store-launch feedback. The final PR gate also checks Apple shortcut
naming and disabled static contact controls. No new dependencies were added.
The generated core report was preserved there before restoring the tracked
historical report to its pre-task bytes. Formatting, whitespace and website
version consistency checks passed. Extension release ZIP checksums are unchanged.

Visual review confirmed the 1200 x 630 cream social card, the 96 px favicon and
the padded maskable mark use the existing logo, fonts and palette. The two local
skill searches found no specific favicon/brand-icon entry, so asset dimensions
follow the cited platform specifications. New SEO copy and LLM exports use no
em dashes. Native iOS/Android shortcut behavior and actual search indexing remain
post-deployment checks.

## Documentation focus clipping follow-up

The scrollable documentation sidebar had no inline space for its outer focus
ring. Eight pixels of padding with matching negative margins preserve content
alignment and scrolling while keeping the existing ring visible. Applied the
minimal-change and visible-focus guidance from `fixing-accessibility`, plus the
verified `ui-ux-pro-max` search for "focus not obscured".

The production website build passed. All **6 existing documentation, notice and
responsive-layout cases** passed in Chromium and Firefox, run
`cd6111f2-5942-439a-a104-3382378730e7`. A temporary browser probe verified keyboard
focus in **16 combinations** of both engines, both themes and widths 320, 375,
768 and 1440. The 6 px outer ring now has at least 8 px of clearance, with no
horizontal overflow. Dark/light screenshots were visually reviewed. Evidence is
under `output/qa/docs-focus/`; no diagnostic source or permanent CSS-only test
was added. Subsequent formatting only normalized line endings.

The earlier complete PR gate predates this CSS correction. This focused follow-up
does not certify a release archive; full certification remains required before
packaging.

## Consumer documentation follow-up

Public documentation now contains eight task-oriented guides from `docs/help/`,
with a short developer entry linking to repository references. The earlier
technical guides, architecture documents and contributor instructions remain
unchanged. A shared map redirects retired technical bookmarks and raw exports to
their matching GitHub sources. The public build now contains 18 public HTML
pages plus `404.html`, with 17 indexable routes.

The existing catalog, local search, safe Markdown renderer, heading navigation
and metadata owners are retained. Public help uses `Article` structured data.
Support and Contact links stay in a consistent article-footer order, following
the verified `ui-ux-pro-max` Consistent Help guidance. Its narrower plain-language
search had no database match; short instructions and actual control labels follow
the approved content plan. `fixing-accessibility` guidance preserves semantic
headings, native links, keyboard navigation and the existing visible focus rings.
No visual identity or upstream skill files changed.

TypeScript, the production website build and **32 focused website unit tests**
passed. A further run of the six documentation unit cases passed after adding
checks for every local help link and fragment. All **60 website browser cases**
passed in Chromium and Firefox, run `2e5286ed-2f0f-49f3-a713-6cd751ab3638`.
Coverage includes public HTML without JavaScript, search, retained anchors,
Article metadata, public-only exports, all retired technical destinations,
replacement history, four widths and both themes. Screenshots of the help index
and privacy guide were captured at 375 and 1440 px in both themes and reviewed.

Existing technical reference hashes still match the pre-task copies. Current
feedback is preserved under `output/qa/consumer-docs/`, including separate
focused build/timing records. The fresh complete `test:ci` run,
`798c6cb7-5cb2-4154-8531-36924b262efe`, passed TypeScript, the complete production
build, **325 unit tests and 132 browser cases** (47 core, 20 integration,
2 native Firefox and 63 UI). No prepared-build shortcut was used.

This run's reports and log are preserved separately from the earlier checks.
The generated tracked core report was restored to its pre-task bytes after
saving the new evidence. Formatting, whitespace and version checks passed.
Website 0.1.1 and extension/API 0.11.0 remain unchanged. Existing release archive
checksums still match; no archive, publication or deployment was performed.
Cloudflare's actual HTTP redirects still require a post-deployment check; local
checks verified their definitions and intercepted client navigation.

## Documentation styling follow-up

The documentation CSS now bounds article prose to 68ch, uses 17 px body text
(16 px on mobile), increases list and heading spacing, and moves the contents
navigation to a sticky right rail at widths of 1200 px or more. Smaller layouts
keep an inline contents panel. Sidebar labels and cards use the established
Source Sans 3 and Newsreader fonts with the existing theme tokens. Sticky
navigation leaves room for the returning site header. Search-ring padding is
retained.

Section headings keep their focus destination and stable anchors. Mouse clicks
do not draw a heading outline; native keyboard focus uses a small outline around
the heading rather than the full article row. Permalink targets are at least
44 px. No content, routing, JavaScript behavior or animation was changed.

Applied `baseline-ui` guidance for hierarchy, existing tokens and no added
animation, `ui-ux-pro-max` verified Line Length and Line Height guidance, and
`fixing-accessibility` guidance for visible keyboard focus. The production website
build passed. A temporary probe passed **32 combinations** of Chromium/Firefox,
Light/Dark, widths 320/375/768/1440, and the installation/destination guides.
It checked natural Tab-and-Enter navigation, pointer focus, search-ring
clearance, readable font sizes, contents placement and horizontal overflow.
Screenshots of desktop/mobile articles, pointer navigation and keyboard focus
were visually reviewed. No permanent CSS-only test or diagnostic source was
added. Feedback is under `output/qa/docs-style/`.

The complete existing website browser scope passed: **60 cases**, Chromium and
Firefox, run `b543ac21-e9c3-4766-a99f-c36107e7d8a0`. It covered the existing
four-width/two-theme route matrix, search, anchors, Back navigation, redirects,
static HTML, crawler files and motion. Build and timing evidence is preserved
under `output/qa/docs-style/`. Formatting and whitespace checks passed.

The earlier repository PR gate predates this CSS-only follow-up and has not
been relabeled. Native screen-reader speech and release certification remain
pending. No version, archive, publication or deployment changed.

## Documentation navigation and motion follow-up

Sidebar groups now use 20 px Newsreader headings and thin dividers, separate
from the 14 px Source Sans 3 links. The current guide uses stronger ink text
and a narrow marker without a filled background. Mobile navigation keeps the
four groups in two columns. Native links, `aria-current`, 44 px targets and
the search field's focus-ring clearance are preserved.

The existing GSAP reveal owner handles short documentation entrances: 280 ms,
8 px translation and opacity with the established `power2.out` curve. Headings
and guide cards enter once; paragraphs and sidebar controls stay available.
The current marker uses the existing 140 ms press token. Keyboard input,
including typing after pointer focus, ends pending reveals. Reduced-motion
changes revert GSAP styles and remove marker movement. No animation library,
per-frame React state or separate documentation animation driver was added.

Applied the local `animate` guidance for occasional entrances and immediate
keyboard actions, `animation-performance` for transform/opacity and cleanup,
`fixing-accessibility` for focus and current-location semantics, and the
`ui-ux-pro-max` Active State search result for a clear navigation indicator.
Removed duplicate active rules, redundant mobile and inherited CSS declarations,
the overlapping documentation page fade, self-repeating registry properties
and a repeated developer prompt on the index. A temporary PostCSS inspection
found no repeated documentation selectors or properties within the same scope.

A temporary visual/focus probe passed **32 combinations** of Chromium/Firefox,
Light/Dark, widths 320/375/768/1440 and two guides. Desktop and mobile screenshots
were reviewed, including keyboard focus. Evidence is preserved separately under
`output/qa/docs-navigation/`; no diagnostic source was retained.

Fresh complete `test:ci` run `71da05f2-c033-4ab9-bf39-cd1260d0a585` passed
TypeScript, the complete production build, **325 unit tests and 134 browser
cases** (47 core, 20 integration, 2 native Firefox and 65 UI). No prepared-build
shortcut was used. The new documentation motion regression passed in Chromium
and Firefox, covering one-time entrances, direct search typing, keyboard
navigation and live reduced-motion changes. Existing search, fragments, Back,
static HTML and metadata checks also passed.

The log and all nine reports were saved with the same validation identity.
The generated tracked core report was restored to its pre-task bytes after
saving the fresh evidence. Formatting and whitespace checks passed. Earlier
reports remain historical. Website 0.1.1 and extension/API 0.11.0 remain
unchanged; no archive, publication or deployment is part of this follow-up.
Native screen-reader speech and release certification remain pending.

## Publication and deployment

Run the existing **Full validation** workflow on the reviewed default branch
before publishing a certified website archive. PR and focused reports do not
authorize packaging. Preserve existing tags and archives.

After the approved Cloudflare deployment, record its revision and verify the
rendered primary routes, compiled assets, both exact store-link destinations and
`/website-release.json` reporting 0.1.1. Live deployment checks remain pending.
