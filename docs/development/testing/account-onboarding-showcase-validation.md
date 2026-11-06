# Onboarding product showcase validation

November 6, 2026. This record covers the refinement after account-onboarding
commit `f715426b`. The [earlier account/identity evidence](account-onboarding-validation.md)
retains its original build hashes and scope. This update changes shared
presentation, welcome copy and tests; authentication and setup authority are
unchanged. Website 0.1.1 and extension/API 0.11.0 remain unchanged.

## Guidance applied

Applied the project-local ui-ux-pro-max, animate and fixing-accessibility skills:
show recognizable product value with concrete requests, keep Skip/Back/Local
available, use native pressed buttons and descriptive preview names, preserve
visible focus and 44px targets, and avoid filled selection pills. The existing
editorial fonts, jade/gold tokens, Wayfinder and Iconoir artwork remain the owners.

Motion is first-time explanation: CSS transform/opacity with the existing easing,
a 220ms entrance and finite explanation sequences ending within 2.4 seconds.
Controls never wait for motion. Reduced-motion and keyboard scenes remain static;
offscreen scenes stop. Sidebar/widget switches change illustration state only.
No model calls, automatic clicks, data uploads or task-completion claims occur.

## Fresh evidence

| Check                                                                | Status                  |
| -------------------------------------------------------------------- | ----------------------- |
| TypeScript, version checks and production build                      | Passed                  |
| Three chapters, sidebar/widget previews, both themes and four widths | Passed focused checks   |
| Bounded motion, offscreen suspension and keyboard interaction        | Passed in both browsers |
| Native packaged welcome in Chrome and Firefox                        | Passed                  |
| Complete deterministic PR gate                                       | Passed                  |

Complete PR run `d8ffaccb-3034-4b37-8267-0a7150307ced` passed 1,300 unit tests
across 95 files and 169 browser cases: 57 core, 20 integration, 5 Firefox and 87 UI.
The documented prepared-build option verified the immutable production build
before the gate. The final native Firefox cohort used Firefox 159.0.1 and
geckodriver 0.37.1 on Windows x64 through the existing standalone-binary override.
It exercised the updated welcome preview choices and Local completion alongside
native document binding and restart behavior. Windows evidence does not certify
macOS. External model calls: zero.

Focused website run `9a73f8b5-2940-4f9b-9d78-8bc92e2ab720` passed 20 cases in
Chromium and Firefox. Each responsive case covers all chapters and both guide
placements, with synthetic visual captures. The normal-motion cases verify finite
explanation timing, actual offscreen geometry, suspended animation, no automatic
chapter advance and native keyboard preview selection. Pointer chapter changes
were reviewed with mobile captures; selected preview controls remain transparent
with a gold underline.

Native Chrome run `e7ce1540-98ad-480b-8b4b-1c46169d3ec6` passed the existing built
Chromium-target smoke check, including both welcome preview choices, the three
chapters, Local completion and independently verified website interaction. It used
Chrome 156.0.8078.80 on Windows x64, with matching driver 156.0.8078.80.

| Built target | Digest                                                             |
| ------------ | ------------------------------------------------------------------ |
| Chromium     | `2765592a89412eaef8a9871ac75a0d561784ef02ee613cb14677e13db65dc10b` |
| Firefox      | `2bb5cda928b49c0f13cd0540590006fbf8cb2acbaf528518b97da39ed295e4c4` |

Visual captures contain synthetic example UI only. Native identity forms are not
captured. Production account deployment, signed store installation, manual screen
reader checks, release certification and publication are outside this refinement.
