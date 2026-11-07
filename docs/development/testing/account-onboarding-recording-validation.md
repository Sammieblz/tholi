# Onboarding recordings and shared player validation

This record covers replacement of the illustrated introduction with actual
extension recordings. It is separate from the earlier account/identity and
illustrated-showcase records. Website 0.1.1 and extension/API 0.11.0 remain
unchanged. It does not authorize packaging, deployment or store publication.

## Scope and provenance

The three new 1040 x 800, 30 fps VP9 clips show a natural-language request in the
floating widget, live page highlighting, Guide/Conversation, Pause/Resume,
independently verified arrival and the actual no-account welcome path. They use
the current local engine, warmed before filming, on a synthetic reading fixture in a disposable Chromium
profile. External HTTP is blocked by the capture owner. No external model calls
were made. No personal browser profile, credentials or private page data appears.

`apps/public/media/onboarding/provenance.json` identifies the exact capture build,
platform, architecture, browser version, fixture hash, compositor viewports,
verified worker outcome and SHA-256 of each video, poster, caption and transcript.
Its build is capture evidence, distinct from the final artifacts validated below.
The original version-0.10.1 Wikipedia videos remain unchanged.

The shared player preserves the homepage recording's pause and visibility
behavior. Onboarding recordings start paused, play once on request, offer native
seeking/captions/fullscreen and stop offscreen or in background tabs. They do not
advance the introduction or change extension/account state. Missing metadata or
media leaves the introduction and Local exit available.

## Design guidance

Applied project-local ui-ux-pro-max guidance for click-to-play media, visible
controls, transcripts, stable aspect ratio and no offscreen playback; animate
for explanatory motion with actual product timing and a 220ms chapter entrance;
fixing-accessibility for native keyboard controls, meaningful labels, heading
focus, descriptive captions and reduced-motion states. The former simulated UI,
layout-preview selectors and scene keyframes are removed. The homepage and
onboarding share one playback owner and stylesheet.

## Checks

TypeScript/version checks and the production build passed. The focused website
cohort passed all 32 cases in Chromium and Firefox, covering all chapters in both
themes at 375, 768, 1024 and 1440px; real VP9 decoding; captions and transcripts;
offscreen pause; reduced-motion playback; controlled visibility events; media
failure; unavailable/invalid metadata; Next/Back/refresh and keyboard heading
focus; and the unchanged homepage player. The browser-native visibility signal
is exercised explicitly because headless page switches do not hide a page.
This does not claim manual native background-window verification.

Capture browser: Chromium 156.0.8078.4 on Windows x64. Capture build SHA-256:
`30bfa5e0734b66a4c8490be8a457c13c77b1e5194b75a7f08658eeaf35106488`.
The wall-clock takes are 6.229s, 10.824s and 4.739s. Encoded videos total
2,867,538 bytes; native controls report their encoded playback lengths. Posters,
captions and transcripts are separately hashed in provenance. Line endings for
byte-checked text assets and the capture fixture are pinned to LF.

The complete deterministic `npm run test:ci` gate passed: 1,301 tests across
95 unit files, 57 core browser cases, 20 integration cases, five native Firefox
cases and 90 UI cases. All 172 browser cases passed. The coordinated PR run is
`ca8857a7-593a-432c-a0c7-3ec1dd0fe58f`. The documented prepared-build option
verified `output/build-manifest.json` before running; no artifacts were rebuilt
inside the gate. The separate 32-case focused website run is
`d43b0cb9-485d-498a-b9a0-f6cb729f97c2`.

Native Firefox 159.0.1 with GeckoDriver 0.37.1 passed the packaged welcome flow,
real VP9 decoding, introduction progress and Local completion within its existing
conformance owner. The standalone Program Files Firefox binary was selected using
the existing `THOLI_FIREFOX_BINARY` override, as recorded in the prior showcase
validation. No browser lifecycle or safety budget was changed.

The separate native Chrome smoke also passed: Chrome and ChromeDriver
156.0.8078.80, run `fe6476d2-b288-4b1c-914a-5c5b80a56a66`. It verifies the private
packaged video, onboarding chapters, Local completion and a real independently
verified website interaction. It is focused full-tier evidence, not full
certification.

Final immutable artifact digests:

| Artifact           | SHA-256 of its sorted artifact-file map                            |
| ------------------ | ------------------------------------------------------------------ |
| Chromium extension | `c409acfbf2251c6e3b57db0d853a074dd1d567da56691fa3f95ca6b9eb7a0f3a` |
| Firefox extension  | `22463aaa7d36fa1fe3485d68e4f04b8fdf16e4ab843dd2bf061166835d0b1d20` |
| Website            | `63a79fea2d50c9aa8fd669a37ce0bacf56b83feebaa387c5ff66d534946ed9f3` |

Local raw evidence remains under `output/qa/`: `onboarding-recording-focused.json`,
`onboarding-recording-core.json`, `onboarding-recording-ci-ui.json`,
`firefox-build.json`, `branded-build.json` and the feature's build/test logs.
Screenshots in the existing website case output cover all three chapters, both
themes and four widths. A paused-player inspection confirmed decoded media,
`paused: true` and no running video-control animation after loading settled.
Generated output is excluded from this source change; earlier committed reports
are not overwritten or relabeled. Full certification and publication remain
separate.

Native store installation, manual permission interaction, screen-reader speech
and native macOS runs remain pending. These Windows UI checks do not certify
those cases or production identity/cloud deployment. The existing local identity
cohorts remain separately recorded on their original account-foundation build.
