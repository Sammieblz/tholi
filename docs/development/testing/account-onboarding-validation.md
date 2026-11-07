# Account onboarding validation

Feature preparation, November 6, 2026. This record does not certify a release,
store upload, deployment, production identity service or production cloud guidance.
Earlier release and identity reports retain their original scope.

## Current evidence

| Check                                                                | Status                                     |
| -------------------------------------------------------------------- | ------------------------------------------ |
| Shared website introduction, routing and honest account availability | Passed focused Chromium and Firefox checks |
| Four widths, both themes and static reduced-motion states            | Passed 16 browser cases                    |
| Setup persistence, local completion and narrow welcome sender role   | Passed focused unit checks                 |
| Late native callback after choosing Local                            | Passed focused regression                  |
| Packaged Firefox welcome through Local guidance                      | Passed focused native Firefox conformance  |
| Packaged Chrome welcome through Local guidance                       | Passed focused native Chrome check         |
| Local registration, verification and recovery                        | Passed Chromium and Firefox cohorts        |
| Native welcome registration entry, cancellation and PKCE sign-in     | Passed Chrome and Firefox cohorts          |
| Complete deterministic PR gate on final source                       | Passed 1,300 unit and 167 browser tests    |

Complete PR run `224ef438-1d7c-42f1-80b8-c98e4b8b9097` passed all five scopes:
1,300 unit tests across 95 files, 57 core browser cases, 20 integration cases,
5 Firefox conformance cases and 85 UI cases. `npm run typecheck` and the production
build passed. The gate used the documented prepared-build option after verifying
the immutable build manifest; no application artifacts changed during the run.
Website 0.1.1 and extension/API 0.11.0 remain unchanged.

The UI cohort checks actual light/dark choices, all three chapters at 375, 768,
1024 and 1440px, and keyboard/Back/refresh behavior in Chromium and Firefox.
It settles the existing brief palette transition before requiring each reduced-
motion scene to remain static. Store destinations, missing/invalid/unavailable
developer metadata and account-independent installation remain covered.

## Local identity evidence

The website identity cohort completed against disposable Compose project
`tholi-smoke-onboarding-a140b6f2`, using Keycloak 26.8.1, PostgreSQL and Mailpit.
Run `6dc004e5-6f10-46fd-95a8-5908346d3729` passed both browser cases: Chromium
156.0.8078.4 and Firefox 157.0. Its configured website build digest is
`0e78e6bacff48544d147ed2a134ebdd5f26b524b9b8648d948233712da2c3d2f`.
Registration, email verification, recovery, cookie sessions, authenticated entry
redirects and retained-realm reconciliation passed. Blank provider registration
forms were checked at 375, 768, 1024 and 1440px in both themes, including readable
fields/labels and adequate input targets. No identity form screenshots or traces
were captured.

Native identity run `16ff894b-0e73-495f-bd11-06378b4aced6` passed Chrome
156.0.8078.80 and Firefox 159.0.1 on Windows x64. It exercised the real packaged
welcome UI, provider registration entry and cancellation, native PKCE sign-in,
metadata-only account status, renewal, revocation, logout and background restart.
The website cohort owns completed registration, verification and recovery; the
native cohort owns extension callback/session behavior. Neither certifies macOS.

| Native artifact | Build digest                                                       |
| --------------- | ------------------------------------------------------------------ |
| Chromium        | `0db3e3c55b612b5397eb8a7812675f38c44bda5152e1a241b4de214f5088a1d2` |
| Firefox         | `aa970ec0b4f2ed2f3d1c8f87e06d6ea3c679743ee8ed4d23d10bcf12ce659e39` |

Native checks exposed two distinct integration regressions corrected here:
Firefox window discovery selected the newly opened welcome tab instead of the
sidebar, and account settings did not refresh after authentication in another
extension page. The harness now finds the exact packaged interface; the existing
privileged panel port sends metadata-free invalidations and settings reload from
the account owner. Provider-form checks also exposed inherited dark-mode input
colors, corrected through scoped theme styles without changing provider forms.

The website identity cohort waits for the existing gateway capacity window before
additional account-entry redirects. Limits and safety budgets remain unchanged.

An initial complete PR gate stopped on Firefox WebDriver shutdown in the installed
Microsoft Store Firefox 159.0.1. An empty disposable Firefox session without Tholi
reproduced the same thirty-second shutdown failure. The separately installed
Mozilla Firefox 159.0.1 starts and closes normally through the existing explicit
`THOLI_FIREFOX_BINARY` override, used for the final gate. This does not change
browser discovery, ordinary user profiles, cleanup ownership or timeout policy.
Temporary diagnostic code and the unsuccessful network-cleanup experiment were
removed before that gate.

The first Chrome welcome check exposed a harness limitation: its BiDi installer
left the API-created welcome page outside WebDriver's window registry. Chrome's
extension API and native target inspection independently showed the installed
page. The final harness verifies that exactly one packaged welcome tab exists,
then uses a controlled native Chrome tab for its UI, matching the existing sidebar
harness pattern. Firefox exercises its automatically opened welcome tab directly.
Temporary diagnostic probes were removed. No production browser checks or safety
budgets were relaxed.

Default website and configured local-identity builds remain separate. Identity
tests use a disposable project, synthetic accounts, local mail capture and protected
runtime credentials. Their screenshots/traces remain disabled. Visual checks of
public introduction scenes contain synthetic content only.

External model calls: zero. Native store installation, manual screen-reader
testing, production accounts and store publication remain pending.

The disposable identity project's containers, networks and volumes were removed
after verification. Automatic review blocked deleting its ignored local output
folder, which remains outside the commit. No other development stack was removed.
