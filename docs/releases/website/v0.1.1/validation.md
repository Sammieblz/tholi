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

The site now builds 22 plain HTML documents, route-specific metadata, structured
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

## Publication and deployment

Run the existing **Full validation** workflow on the reviewed default branch
before publishing a certified website archive. PR and focused reports do not
authorize packaging. Preserve existing tags and archives.

After the approved Cloudflare deployment, record its revision and verify the
rendered primary routes, compiled assets, both exact store-link destinations and
`/website-release.json` reporting 0.1.1. Live deployment checks remain pending.
