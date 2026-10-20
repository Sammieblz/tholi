# Tholi 0.11.0

Prepared October 18, 2026; automated certification completed October 19.
**Release candidate: both browser packages passed full automated certification.**

This minor release adds optional assisted navigation and improves the shared
local navigation engine for Chromium and Firefox. The product, extension,
optional API and bundled workspaces use the same `0.11.0` release number.
It follows the `0.10.1` source series; it does not replace an existing download.

## Changes

- Prepare browser-store submission with Firefox's optional backend data consent.
  Backend requests check the current grant, including after revocation; local
  guidance remains available without data-transmission consent.
- Pre-release performance follow-up: stop self-observation/replanning loops,
  prioritize Pause/Stop and release idle workers. See [measurements and validation
  scope](performance.md), including cache sizing and heavy-page limitations.
- Keep a destination through transient scan changes, with bounded recovery and
  fresh observations instead of repeatedly showing a page-change error.
- Hold automatic recovery while a new foreground destination is planning, so an
  older request cannot close its inference channel or install stale guidance.
- Interpret natural sign-up/sign-in requests, synonyms and Unicode punctuation
  more consistently while protecting quoted names and URLs.
- Reconcile selected menus, routes and foreground content to avoid repeatedly
  suggesting an already-open navigation section. Remember unreliable observed
  route edges without inventing new paths or outcomes.
- Add **Settings → Assisted navigation**, off by default, for eligible menus and
  explicitly requested view options. Credentials, forms and final actions remain
  manual. Every assisted interaction requires fresh document and safety checks.
- Prioritize user requests over continuations and suggestions in one bounded
  inference queue. Improve foreground OCR selection after privacy masking.
- Reduce Firefox test-installation memory use and correct sidebar-harness focus
  and live-session handling without weakening the outcome assertions.
- Align package, API and extension versions and require matching release notes.
  CI rejects version drift and tags that do not match the release number.

See [the implementation and pre-version validation record](navigation-reliability.md)
for ownership, regression coverage and measured limitations.

The preceding source series also includes the shared Chromium/Firefox engine,
Guide/Conversation redesign, responsive widget and launcher, local website,
documentation and cookie preferences, and faster tiered CI. Their original
implementation records remain under [0.10.1](../../README.md#design-and-implementation-records);
their historical passes do not certify the new version.

## Installation and compatibility

Build from the repository root with Node 24.19.x:

```sh
npm ci
npm run check:version
npm run build
```

- Chromium 140+: load `dist/extension` unpacked in Chrome, Edge or Brave.
- Firefox 153+: use `about:debugging` → **This Firefox** → **Load Temporary Add-on**
  and choose `dist/extension-firefox/manifest.json`. The unsigned developer preview
  is removed on browser restart.
- Start the local website with `npm run dev:web` on port **5174**.

Reload Tholi and refresh website tabs after updating. Existing package names,
browser add-on ID, permissions, local knowledge identifiers, API contracts,
frozen models and acceptance goals are retained. No storage migration or
cross-browser synchronization is introduced. Assisted navigation remains off
until explicitly enabled. [Browser setup](../../guides/getting-started.md) covers
permissions and surface recovery.

The website's download version remains the version of its eligible archive.
Existing screenshots and video still truthfully identify their `0.10.1` capture;
they are not evidence for this release.

## Validation and release status

The earlier navigation checks ran before the version bump on `0.10.1` bytes.
They remain historical evidence in the implementation record and cannot certify
`0.11.0`. The final coordinated full run passed on the exact packaged bytes.
Validation and remaining manual checks are recorded in
[validation.md](validation.md).

October 20 AMO submission follow-up: the original Firefox ZIP used Windows
separators in 244 archive paths. The corrected upload candidate is
`tholi-firefox-0.11.0-amo.zip`, with the same 273 certified file contents and
unchanged `0.11.0` manifest. Mozilla's validator reports zero errors and 12
bundled-code warnings on this actual ZIP. The original archives and source
package remain intact. See the [repair record](validation.md#october-20-firefox-amo-archive-repair).

Known limits include incomplete signed-in Cloudflare/GitHub/Amazon verification,
long frames on the busy-page stress scene, and a frozen GitHub held-out target
mismatch within the existing quality threshold. No universal website accuracy,
identical browser timing or smooth busy-page rendering is claimed.

The gated packager created `tholi-0.11.0.zip` and `tholi-firefox-0.11.0.zip` from
the exact tested bytes, with checksums and target-specific evidence. These are
unsigned store-submission candidates. Firefox signing, browser-store submission
and deployment remain pending. GitHub release assets record publication status.
See [store submission](../../development/store-submission.md) and the
[release procedure](../../development/releasing.md).
