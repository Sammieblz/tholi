# Automatic onboarding recordings validation

This record covers automatic muted looping of the shared signup and extension
welcome recordings, with playback controls, caption text, subtitle tracks and
transcript links removed. It supersedes the controlled-playback presentation,
without relabeling its earlier validation. Website 0.1.1 and extension/API 0.11.0
remain unchanged. Publication, deployment and store certification are separate.

## Implementation and capture

The existing shared player owns visibility, browser background signals,
reduced-motion and data-saving gates. Onboarding has no native or custom player
controls. Playback resumes when visible and never advances setup. Reduced motion
and data saving keep the poster. The homepage keeps its existing deliberate
Pause/Resume toolbar and transcript links.

All three clips were freshly captured with the existing local recorder and
bundled engine. The welcome recording now contains the updated interface, so
older controls and transcript links no longer appear inside its footage. The
capture explicitly verifies that the welcome video is playing, loops and has no
controls, caption tracks, caption text or links. It also requires independently
verified website completion and disabled cloud transmission after Local setup.
No external HTTP or model calls are made. Capture provenance and exact asset
hashes remain in `apps/public/media/onboarding/provenance.json`.

Caption and transcript files are source capture evidence only. The onboarding
catalog no longer exposes their URLs, and the player does not render or link
them. Old release archives and the 0.10.1 homepage recordings remain unchanged.

## Design guidance

Applied the project-local animate guidance for explanatory product motion and
visibility/reduced-motion handling, fixing-accessibility for silent playback,
meaningful naming and keyboard setup navigation, and ui-ux-pro-max for existing
brand tokens, aspect-ratio stability and uncluttered presentation. The user's
explicit request supersedes the default suggestion to show video controls.
No additional motion library or parallel player was introduced.

## Validation

TypeScript/version checks and the production build passed. All 32 focused
website cases passed in Chromium and Firefox, run
`8a4f8c77-5b84-43cd-924b-d4038d228e56`. They cover all three chapters in both
themes at 375, 768, 1024 and 1440px; actual silent automatic playback and wraparound;
absence of native/custom controls, caption text, tracks and transcript links;
offscreen pause/resume; controlled browser visibility events; reduced-motion
changes; data saving; failed media/metadata; keyboard setup progress; and the
preserved homepage player. Headless visibility events are exercised explicitly,
without claiming manual native-window behavior.

Capture browser: Chromium 156.0.8078.4 on Windows x64. The capture build is
`1015e36c177bf866e5161a470c47ccb4545a67e47df680d6f35ded07711eb6e9`.
Wall-clock takes are 6.520s, 10.947s and 4.783s; native playback uses the encoded
stream lengths. Video bytes total 2,888,780. The refreshed welcome poster was
visually checked for the removed player bar, transcript links and caption text.

Final immutable artifact digests:

| Artifact           | SHA-256 of its sorted artifact-file map                            |
| ------------------ | ------------------------------------------------------------------ |
| Chromium extension | `ee888e7adfc43af6ed3b03b96e8dff3197e2f2fbbdb1d6e2538493174017ee69` |
| Firefox extension  | `d26629ec7bfe59c77cb16d17e414c61c46d865a702261bafe27fe3d957750fce` |
| Website            | `fc5e484eec6ead910af4ae41641e46463c1e6874335e29d8f27abafd19966226` |

The focused native Chrome check passed with Chrome/ChromeDriver 156.0.8078.80,
run `8a8abfff-5095-400b-aeaa-2d0132f0e860`. It checks actual automatic playback,
zero player controls/caption UI, onboarding progress, Local completion and a
verified website interaction. The native helper scrolls the video into view
before expecting playback. Its initial 764 x 429 window exposed only about 36%
of the frame, below the existing 45% visibility threshold. The check now respects
that threshold instead of calling `play()` directly. Temporary diagnostic output
was removed. No visibility, timeout or navigation budget was increased.

An initial gate attempt stopped when one existing authorization case exceeded
its five-second test timeout. Its entire 54-case owner passed on focused rerun,
without backend or timeout changes; the fresh coordinated run has also passed
all 1,301 unit cases. Initial logs are retained separately rather than relabeled.

The fresh complete `npm run test:ci` gate passed, coordinated run
`a747dee4-5011-48c7-95df-18681d8c4d38`: 1,301 unit tests across 95 files and all
174 browser cases (57 core, 20 integration, five native Firefox and 92 UI).
It used the documented prepared-build option after verifying immutable artifacts
against `output/build-manifest.json`. Application artifacts and safety budgets
remained unchanged throughout that run.

Native Firefox 159.0.1 with GeckoDriver 0.37.1 passed actual packaged automatic
playback, absent caption/control UI, onboarding and Local completion through the
same shared native welcome check. Both native browser checks use their own target
artifact digest and retain Windows x64 scope.

Raw local evidence is retained under `output/qa/`: `onboarding-autoplay-focused.json`,
`onboarding-autoplay-core.json`, `onboarding-autoplay-ci-ui.json`,
`firefox-build.json`, `branded-build.json`, and the autoplay build/test logs.
The initial failed run and diagnostic outputs have separate filenames. The
earlier controlled-playback validation and release evidence remain historical.
This is preparation evidence, not full release certification.

Native store installation, native macOS and manual screen-reader validation
remain pending. These local checks do not certify production cloud/account
hosting or authorize an extension/store release.

## PR #90 CI repair, 7 November 2026

The [first hosted run](https://github.com/Sammieblz/tholi/actions/runs/42333822042)
failed before container startup because its job had not installed the theme
compiler. It now uses the existing dependency setup action. Theme compilation
loads esbuild only when requested, so plain-Node initialization and status still
work before dependency installation. A dependency-free temporary checkout tests
that bootstrap contract.

The native welcome check previously expected autoplay even when macOS requested
reduced motion. GitHub's [runner configuration](https://github.com/actions/runner-images/blob/fad015e47059f40cf0786dcb4593384f6a0720d3/images/macos/scripts/build/configure-system.sh)
enables that preference. The shared check now verifies a decoded poster and
paused player for reduced motion or data saving, and decoded playback otherwise.
Sanitized evidence records the actual preference, playback stage and dimensions.
It does not disable accessibility preferences or call `play()` to bypass gates.

Both native harnesses now wait for the actual automatically opened welcome tab
before returning an installed fixture. Extension installation can resolve before
the background install handler finishes creating that tab. Waiting preserves the
exactly-one-tab assertion and prevents late installation focus from racing
website guidance. It does not create a tab to manufacture installation evidence,
weaken native document checks or retry a guidance request.

Fresh Windows x64 checks passed against the unchanged artifact digests above:
TypeScript/version checks, 34 focused infrastructure/platform contracts, native
Chrome welcome and verified interaction, and all five native Firefox cases.
The native checks used a requested 2x backing scale. Logs are under
`output/qa/pr90-ci/`. The complete deterministic gate, Linux container result and
all four native macOS results are tracked by the replacement run on PR #90;
the earlier failed run and validation records remain historical. These fixes do
not establish native store installation, screen-reader behavior or release
certification.

The first repair commit passed [every hosted PR gate](https://github.com/Sammieblz/tholi/actions/runs/42363177787),
including Linux containers, all Windows suites and native Chrome/Firefox on all
four macOS targets. Each native report retains its own OS/architecture and target
digests. Both macOS 15 reports confirm that native reduced motion is enabled and
the welcome check verifies its paused poster state.

A separate local run exposed an overbroad reduced-motion assertion in the
existing quota-message check. A temporary diagnostic identified finite, single
80ms `color` and `scrollbar-color` transitions, permitted by the existing tokens;
it was removed after verification. The assertion now permits only those bounded
color transitions and still rejects other running effects, loops and spatial
motion. No animation style, timeout or product budget changed. The earlier local
failures, including an authorization timeout while the container smoke was also
running, remain separate logs under `output/qa/pr90-ci/`.

The following run exposed an additional Firefox settings interaction on macOS
15 Apple Silicon: Local processing was not acknowledged immediately after the
cloud-forgetting confirmation. The native helper now waits for settings entrance
and confirmation teardown before sending keys, then independently checks the
radio selection and background acknowledgement. Cancellation follows the same
readiness owner. This retains the real keyboard interaction, explicit Local
choice, privacy checks and existing request deadlines. The failed run remains
separate from the final PR checks.

The next hosted run also exposed the install-tab race in the Playwright harness:
its failed saved-route snapshot had advanced mode enabled but no active website.
Fresh initialization now waits for the same exact automatic welcome-tab count
used by WebDriver before creating website/panel fixtures. Browser restart does
not wait for a new install event.

An Intel macOS capture was correctly rejected at the current-proof stage. The
native pixel fixture now creates its processing worker only after that capture
and its privacy check, keeping cold compilation outside the proof's critical
path. Failures record sanitized prepare/capture/check durations and whether the
viewport revision changed. The exact earlier invalidation cause remains unknown;
no privacy deadline, suppression budget, identity check or rejection was relaxed,
and captures are not retried automatically.

Fresh Intel diagnostics then measured 34ms preparation, 1,240ms native screenshot
encoding and a 2ms rejected check, with an unchanged viewport revision. The
existing one-second owned-UI suppression watchdog had expired. That guard is
unchanged. Chrome's pixel cohort now explicitly measures a 960 x 800 native
viewport on every OS. Firefox retains its 1280 x 900 native sidebar window.
Both retain 2x backing scale, 0.8/1.25/2 zoom and every masking,
crop, OCR, comparison and lease assertion. The separate native layout cohort
retains its larger viewports. This bounded pixel evidence does not promise that
larger screenshots on slower hardware finish before the guard; those captures
continue to fail closed. Successful pixel reports retain sanitized timing too.
