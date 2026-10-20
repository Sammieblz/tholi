# Website 0.1.0 validation

Status: **source prerelease published, merged into `main` and deployed on
Cloudflare Pages**. Local and hosted PR checks passed. Full archive certification
and browser-store approval are not established by this record.

## Source and environment

- Published tag: `web-v0.1.0`, source revision
  `2a07c1c1be456a07ee1bd364a30657c8da35799a` from `web-release`.
- Merged revision: `897048618a53fe7037f280ebe0dfa53812a5b3f3` on `main`, through
  [PR #22](https://github.com/Sammieblz/tholi/pull/22).
- Product version: 0.11.0. Website delivery version: 0.1.0.
- Windows, Node 24.19.0 and npm 11.17.0.
- Date: October 20, 2026.

## Publication and deployment evidence

- [GitHub release](https://github.com/Sammieblz/tholi/releases/tag/web-v0.1.0)
  published October 20 at 19:28 UTC. It remains marked prerelease and provides
  GitHub's source archives; no built website ZIP or other assets are attached.
- PR #22 merged at 20:38 UTC. The hosted **Validate offline navigation** PR gate
  [passed on the merged revision](https://github.com/Sammieblz/tholi/actions/runs/39493670268).
  This is PR evidence, not a complete Full validation run.
- The owner deployed the website on Cloudflare Pages at **https://tholi.io**.
  A public browser smoke check on October 20 rendered `/`, `/about`, `/support`,
  `/contact`, `/privacy`, `/terms` and `/download` successfully, with HTTP 200
  responses, the expected page headings and no page runtime errors.
- `/website-release.json` returned JSON version `0.1.0`; the page loaded the
  compiled entry `/assets/index-FBLKuLNO.js`. These observations establish the
  visible website version, not the deployment's exact Git commit.
- The public download page reports no packaged download available and offers
  source setup. Chrome and Firefox store buttons remain labeled previews.
- Cloudflare's injected script at `static.cloudflareinsights.com/beacon.min.js`
  loaded successfully, and `/cdn-cgi/rum` returned 204 before a cookie choice.
  Tholi's application analytics boundary remains inactive. The deployment
  follow-up corrects the notices and cookie-settings copy to describe the
  independent Cloudflare measurements; it does not change dashboard settings.

## Passing source checks

- `npm run typecheck` and `npm run check:website`.
- Production website build with locally bundled GSAP and fonts.
- `npm run test:ci`: **312 unit checks, 107 browser checks**, comprising 47 core,
  20 integration, 2 native Firefox and 38 UI checks. Run identity:
  `57b74697-c67b-43cc-9fda-4c34f05dc634`. This complete run includes the current
  hero actions, Zulu name credit and Contact/Support pages, plus the earlier
  arrow and motion corrections. It supersedes the preceding PR evidence from
  `89b7fb9f-dff4-4c07-857c-e535c7b0fefe` and
  `10419506-0b80-42b0-82d3-51fb787d06a4`.
- The coordinator typechecked, built once and froze the complete build before
  running the checks. Its final build manifest was verified again. Website test
  port 5188 avoids an already occupied default port; review preview uses 5194.
- Current route-reflow in Chromium and Firefox covered 14 routes, including
  Contact and Support, × 4 widths (320, 375, 768 and 1440 pixels) × 2 themes ×
  2 engines = **224 combinations**, with no horizontal overflow. These two
  focused checks reused the frozen build through the separate preview on 5194;
  their output is under `output/qa/website-0.1.0/reflow`. They do not certify a
  release. Full reflow coverage runs again in post-merge certification.
- Release-tooling coverage verifies increasing website versions, matching notes,
  unchanged product versioning and opt-in empty-directory handling. Archive
  verification still rejects unexpected files; extension defaults remain strict.
- Workflow YAML and script syntax checked. Publication depends on build, tests
  and certification, requires the default branch and an explicit website input,
  and leaves existing tags/releases untouched. The source prerelease already
  exists, so this publication path will skip `web-v0.1.0`; no full-certification
  publication run is claimed.
- Prettier and `git diff --check` pass.

Local evidence is under `output/qa`, including `timing-ci-all.json`, `unit.json`
and `ui-build.json`. These reports were collected at the **PR** tier; later
focused invocations may replace local report files and do not recertify that run.

## Deployment follow-up validation

The status records and hosting/analytics disclosures were updated after the
published source tag. These source changes require a commit, push and Cloudflare
redeployment before the corrected notices appear on the public website.

- Focused existing website unit suites: **20 checks passed** across four files.
- Existing Chromium and Firefox browser checks: **4 passed**, covering publication
  and operator disclosures, Cloudflare measurement disclosure, preference-cookie
  withdrawal and keyboard operation at a 320 px viewport.
- TypeScript, website version metadata and the production Vite build passed.
- Prettier and whitespace checks passed on the changed files.

This follow-up does not rerun or relabel the original PR cohort, provide Full
validation evidence, change the published tag or create an archive.

## Visual and interaction review

Review captures and the disposable-browser evidence are under
`output/qa/website-0.1.0`:

- `home-light.png`, `home-dark.png`.
- `download-light.png`, `download-dark.png`, `download-mobile.png`.
- `signup-light.png` and `visual-review.json`.
- `scroll-reveal-review.webm` and `scroll-reveal-mobile.webm`: normal-motion
  desktop and mobile previews of the corrected scroll entrances.
- `scroll-reveal-mobile-during.png`, `scroll-reveal-mobile-after.png`,
  `practice-label-controls.png` and `practice-mobile-label-controls.png`.
- `scroll-reveal-review.json` and `arrow-free-review.json`: the corrected build
  produced 64 intermediate heading-opacity frames, finished fully visible,
  exposed all pending text on keyboard input and reported no page runtime errors.
- Current hero/name/contact/support review: `about-name-credit.png`,
  `contact-light.png`, `contact-dark.png`, `contact-mobile.png`,
  `contact-prepared-mobile.png`, `contact-prepared-viewport.png`,
  `support-light.png`, `support-dark.png`, `support-mobile.png` and
  `support-contact-review.json`. Home screenshots were refreshed with the two
  hero actions. Motion recordings retain the earlier arrow-correction stage.

Reviewed desktop and mobile layouts, both appearances, actual browser artwork,
signup entry points and manual installation instructions. A normal-motion press
check confirmed visible button scaling and no page runtime errors. Automated
checks verify header return on upward scroll/focus, lazy-route reveals,
reduced-motion changes, browser-specific anchors, keyboard navigation and mock
account boundaries. The correction checks progressive text entrances, heading/
body ordering and one-time playback in both Chromium and Firefox. The embedded
Guide and Send labels remain visible without arrow icons; at a 375 px viewport,
the Send control measured 64 × 44 px with no horizontal overflow. These checks do
not establish real-device GPU performance.

The Contact/Support addition is checked in Chromium and Firefox: inline
validation and first-invalid-field focus, support-topic handoff, encoded email
draft contents, clipboard success/failure, invalidation after editing, no form
submission requests, no message data in browser storage and footer navigation.
The contact form does not claim delivery. Its email and copy buttons each measure
275 × 50 px at the reviewed 375 px viewport. Screen-reader speech and actual email
client launch/delivery remain manual checks; no email was sent by validation.

## Remaining capabilities and archive certification

1. Run complete **Full validation** before creating a certified website archive.
   Local or hosted PR evidence cannot authorize packaging. The publication job
   verifies the same full build and records the exact clean source revision,
   file hashes and archive hash. The existing tag and source release stay intact;
   use the next website version for a future automatic archive publication.
2. Native Chrome installation/permission checks, screen-reader speech and signed-in
   manual workflows remain pending until performed. Engine tests and screenshots
   do not replace them.
3. Accounts and store destinations remain explicitly mocked by the owner's
   instruction. Real authentication and approved store URLs belong to a later
   version.
   Contact drafts work locally; SMTP and backend delivery remain pending.
4. Professional legal review and confirmation of the Cloudflare dashboard's
   logging/retention configuration remain outstanding. The live analytics beacon
   is independent of the app's cookie choices; changing it requires the hosting
   configuration. Publish the corrected notices with the deployment follow-up.
5. Existing extension ZIPs are about 29 MB each, exceeding the
   [Cloudflare Pages 25 MiB asset limit](https://developers.cloudflare.com/pages/platform/limits/#file-size).
   Choose suitable download hosting and verified links before enabling packaged
   downloads on the live website. The current deployment uses source setup.
