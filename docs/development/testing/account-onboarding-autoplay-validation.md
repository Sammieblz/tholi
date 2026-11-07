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
