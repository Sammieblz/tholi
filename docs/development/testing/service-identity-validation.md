# Portable identity verification, October 30, 2026

Scope: [#30](https://github.com/Sammieblz/tholi/issues/30), following the verified
service API contract milestone in [PR #68](https://github.com/Sammieblz/tholi/pull/68).
This record covers development and PR acceptance. It does not authorize a release,
packaging or production deployment. Extension/API `0.11.0`, website `0.1.1` and
existing archives remain unchanged.

## Acceptance boundaries

The existing service profile composes the identity application port, OIDC
adapter, PostgreSQL session repository and HTTP delivery. The local Keycloak
profile exercises the same application contract used by configurable deployments.
Firebase is evaluated as an optional future adapter, with no mandatory SDK or
hosted service dependency.

The website account boundary uses protected cookie sessions. The native browser
boundary uses PKCE and single-use broker exchange, with credentials confined to
privileged storage. Public pages and practice cannot authenticate the API through
mock browser state. Local journeys, saved knowledge and legacy private-backend
credentials remain separate from account sessions.

Account identity does not enable inference, billing, credits, saved-data sync,
browser host access or OS actions. Current capability metadata distinguishes
account/session security from those planned operations.

## Validation status

| Check                                                                     | Recorded status                                                                          |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Signed OIDC proof and HTTP/session contracts                              | Passed: 18 focused tests                                                                 |
| Identity configuration and composed service boundaries                    | Passed: 54 focused tests                                                                 |
| Explicit retained local-environment upgrade                               | Passed within the 20 local-stack policy tests                                            |
| Fresh PostgreSQL suite after the global-logout correction                 | Passed: 24 contract groups                                                               |
| Complete disposable-stack smoke, including retained and reset paths       | Passed before the subsequent logout-fence correction                                     |
| Focused identity/configuration/client/local-policy suite after correction | Passed: 107 tests                                                                        |
| Current configured website and both unpacked extension builds             | Passed                                                                                   |
| Actual configured website registration, verification and recovery         | Passed in Chromium and Firefox                                                           |
| Native Chrome identity and permissions                                    | Passed in Chrome 155.0.8059.40 after harness cleanup                                     |
| Native Firefox identity and permissions                                   | Passed in Firefox 159.0 after harness cleanup                                            |
| Complete deterministic PR gate on final source                            | Passed: 484 unit, 47 core, 20 integration, 2 installed Firefox and 65 UI tests           |
| Final independent runtime, database and native-harness review             | Passed; no remaining actionable findings                                                 |
| Hosted required checks                                                    | Separate gate on the final PR commit; consult the issue acceptance record before merging |

The complete local PR cohort passed with validation ID
`2b2c23d6-f13d-4839-8096-de9a0b43af2c`. It typechecked and built once, froze the
build manifest, then passed all 618 tests without rebuilding between groups.
Both rebuilt extension digests match the separate passing native cohorts below.
This default website build keeps accounts unconfigured; the configured website
cohorts have their own recorded artifact and evidence.

The first PostgreSQL run exposed an unnecessary explicit row lock in ephemeral
cleanup. The correction preserves SELECT, INSERT and DELETE privileges without
granting mutation of immutable flow and broker proof fields. Fresh real-runtime
role execution passed after the correction. The failed run remains separate from
the passing evidence.

Independent review then found a login/revocation race: a provider proof issued
before global sign-out could be resolved afterward using the new account
revision. The durable grant cutoff now closes that gap, including the same
five-second clock tolerance used by the verifier. A separate fresh PostgreSQL run
passed all 24 groups after this correction. The earlier full-stack smoke is not
relabeled as proof of that later change.

The real Chromium website cohort passed against the configured website build
`9548b91a0a90bf3026d475871cbc2427864b497bda04480d7c5174db3fea97c2`
and the isolated `tholi-smoke-mvupsoj2-9f1f676d` stack. It exercised registration,
captured verification email, post-verification password setup, callback binding
and replay refusal, protected cookies, renewal, a second browser's revocation,
explicit provider logout, recovery/password change, retained realm reconciliation
and sign-out everywhere. The same run checked four account-layout widths, both
themes, keyboard confirmation/focus restoration and reduced motion. Its browser
was Chromium `156.0.8078.4`. A separate Firefox `157.0` run passed the same
cohort against that exact configured build. These website runs do not establish
native extension authentication or permission proof.

The cleaned native cohorts passed together under validation ID
`0721dcfa-9bbc-4c7f-bc22-92ab7247d659`, with normal gateway logging restored and
temporary diagnostic modules and flags removed. Chrome completed in 9.3 seconds
and Firefox in 12.8 seconds.

The separate native Firefox `159.0` cohort passed using an unmodified unpacked
extension in a fresh disposable profile. It clicked the initially ungranted
authentication-information permission notification through its native control,
then exercised cancellation, PKCE broker sign-in, content credential isolation,
refresh, background restart, current-session revocation and sign-out. The pinned
local journey, draft and website knowledge survived the account lifecycle.
Unpacked installation does not establish store-install consent evidence.

The native Chrome `155.0.8059.40` cohort also passed all lifecycle checks with the
same unmodified Chromium artifact. Its test adapter loads through BiDi, then
uses classic WebDriver execution to avoid debugger-paused native authentication.
The adapter preserves website focus while executing in the synthetic panel tab.
Restart verification observes the exact worker disappear and reappear, resumes
only that worker's debugger and requires the real authenticated response. Chrome
can reuse a debugging target ID across a worker restart, so a different ID is
not required after observed termination. The local loopback host was already
declared, so this run does not claim a new Chrome host-permission prompt.

The verified native artifact digests are:

| Target   | SHA-256                                                            |
| -------- | ------------------------------------------------------------------ |
| Chromium | `0b50b43fabb336967d5392505452b5b0f877ab2e83db571f4bed89ac23774a55` |
| Firefox  | `36afbf6a9e251314e31f9847d1f0d63883e1dcc5f7bf183eda33f925f7c9412d` |

For the new account controls, the project accessibility and baseline UI guidance
was applied: native links for provider navigation, associated labels and help,
visible focus, status/error announcements, existing Base UI confirmations and
adequate control targets. Both configured website cohorts checked actual layouts
and keyboard behavior. The separate native cohorts above cover extension
authentication and the stated permission boundaries. No screen-reader result is
claimed.

Generated evidence remains under ignored `output/qa`. Earlier release and PR
records have not been relabeled. This ticket must remain open until its remaining
acceptance checks are performed and recorded.
