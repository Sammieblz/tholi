# First-run plan handoff validation

Roadmap [#61](https://github.com/Sammieblz/tholi/issues/61), November 7, 2026.
This preparation extends the merged account introduction. It does not certify
production identity, managed inference, payment collection, a release or deployment.
Website 0.1.1 and extension/API 0.11.0 remain unchanged. Earlier onboarding,
identity and macOS reports retain their original builds and scope.

## Acceptance ownership

| Behavior                                                    | Implementation and evidence owner                                                                         |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| Local, Free and paid intent, retained installs and settings | Existing background setup service and packaged welcome; additive version-1 progress field                 |
| Authentication and cancelled/stale native callbacks         | Existing PKCE broker, account settings and native identity cohort                                         |
| Free allowance before processing consent                    | Existing PostgreSQL enrollment/entitlements and service-auth owner; no checkout or model invocation       |
| Paid plans                                                  | Server catalog preference only; checkout and activation gated until #50                                   |
| Website registration and plan return                        | Existing account entry/provider flow; validated tab-scoped preference and replacement navigation to Plans |
| No implicit local imports                                   | Existing saved-data owners; setup explicitly keeps local routes, sync and learning unchanged              |

The welcome sender remains an exact top-level packaged page. It receives no
general inference/provider, saved-data or journey privileges. SETUP_ACTIVATE can
enable only the fake development Free profile after enrollment and explicit
transmission consent. Catalog/version/entitlement checks grant no action or
arrival authority. Current browser observations and independent outcome checks
remain with the existing journey/content owners.

## Focused checks

TypeScript/version checks passed after correcting a test/query conversion that
treated the existing numeric plan version as a string. The initial focused cohort passed
89 checks across extension setup, service authentication, website finance and
account lifecycle. Distinct new regressions cover preference persistence, paid
and forged setup rejection, Local racing late activation, free enrollment with
no inference dispatch, mismatched/inactive entitlements, changed account/choice,
and bounded website preference parsing and removal. All adapter requests use
the existing owned local fixtures. External model calls: zero.

The later consent-owner cohort passed 79 checks in setup and service authentication.
It adds coverage for credential-free catalog reads and withdrawal of retired policy
versions. The first real enrollment exposed a client error: it attempted to create
an image-consent withdrawal with no stored image consent. The server correctly
returned 403. The client now treats absence as denied, and withdraws an existing
grant using its stored version. Server authorization and consent policy are unchanged.

## UI guidance

Applied project-local ui-ux-pro-max guidance for progressive disclosure, honest
availability, native labeled controls and clear asynchronous feedback;
fixing-accessibility for keyboard controls, visible focus, fieldset/legend,
associated checkbox labels, status/error announcements and an available Local
exit; animate for retaining existing 220ms introduction transitions and static
reduced-motion states. Plan review introduces no additional animation library,
automatic progression or large tinted selection pills. Existing typography,
tokens, real product footage and store links remain in use. No button arrows or
em dashes were added.

## Fresh integration evidence

The actual native Chrome/Firefox cohort passed 2/2, run
`bffdb632-e042-4454-a05d-7d36eb6ada5a`, on Windows x64. Chrome 156.0.8078.80
and Firefox 159.0.1 exercised the packaged welcome, real local PKCE, Free
enrollment/entitlement verification, separate context consent, disabled paid
checkout and explicit Local fallback. Refresh, revocation, sign-out, restart and
retained journey/draft/knowledge checks passed. The Firefox authentication-information
permission was initially ungranted and handled through its native notification.
Additional backend data categories were explicitly pregranted for this controlled
fake-transport cohort; it does not certify their native permission prompts.

| Native target | SHA-256 of sorted artifact-file map                                |
| ------------- | ------------------------------------------------------------------ |
| Chromium      | `986a8f7414d097a926e02278d2cac6ef6d0feea5fbed6a7d65494896450b3872` |
| Firefox       | `1b9a36975e0757e6ed0523f70b0141850196ca432f04a68c8609d613073a8d20` |

Early native attempts found harness context/readiness mistakes: classic Chrome
metadata reads changed WebDriver context, the plan review shared the completion
class, and a paid-selection check read progress before its acknowledgement. These
checks now restore the welcome context and wait for the actual saved state.
Later sanitized diagnostics confirmed HTTP 429 during rapid Firefox re-authentication.
Native and website cohorts now share the existing gateway capacity schedule, derived
from the unchanged 120-per-minute, 40-request burst policy. Phases wait for capacity
before execution; they do not retry rejected requests or increase service budgets.
The initially misnamed disposable project was also correctly refused before a browser
ran. Only that owned fixture was removed and recreated with a valid allocated name.
All temporary diagnostics and response fields were removed before the passing cohort.

The three-case focused UI cohort passed in Chromium and Firefox. It covers plan
parameters through introduction/refresh/sign-in/local exit and checks the packaged
choices at 375, 768, 1024 and 1440px in both themes, with reduced motion, keyboard
selection and 44px targets. Its screenshots contain synthetic public footage only.

The configured website cohort passed 2/2, run
`e3230d6e-8b62-4e41-8a2f-ec98a97d57b8`, in Chromium 156.0.8078.4 and
Firefox 157.0. Each completed actual registration, Mailpit email verification,
the retained Free preference and replacement return to Plans, authenticated entry,
recovery, cookie binding, retained-realm reconciliation and account-free installation
and practice. Existing account/provider-form checks cover four widths and both themes.
The configured website build digest is
`12024e3ab0d8271d2ef71beb985141b065df4eaf158ee767c6926fd439d7dbf3`.
Chromium report SHA-256:
`030ec75c52da91f70faa0a59a14cb589a5c374301ddeaeb49f4a1f4e50317b4e`;
Firefox report SHA-256:
`067a27d447cc23c23f9b65339841d0f343161969be291212505e3ed682b8590f`.
This side build stayed under the dedicated QA directory and did not replace the
default website or extension artifacts. The native and website reports remain
separate, coherent cohorts on their recorded builds.

The complete isolated local PR gate passed, run
`b515fac3-6272-48e3-97ad-26807ca278c5`: 1,314 unit checks across 95 files,
57 core cases, 20 integration cases, five native Firefox cases and 95 UI cases.
All 177 browser cases passed. The prepared-build option verified the immutable
artifact manifest; none of those artifacts changed during the cohort.
The initial PR gate stopped on an unchanged authorization test's five-second
deadline while the local containers were starting; its 1,311 passing checks and
one failure are separate from the final gate. The deadline was not changed.

Final review then added the processing-revision fence around enrollment preparation:
a later Local/provider choice in Account settings must cancel an unfinished welcome
activation before it can enable processing. The final focused setup/authentication
cohort passed 80 checks, including that distinct regression; final types, version
checks and the rebuilt extension passed. A review-copy clarification also preserves
the distinction between setup and pre-existing learning/synchronization preferences.
These final edits are separate from the local full-gate/native artifact hashes above.
The final matching-head hosted PR gate is required before merge and its results
are recorded with the implementation PR linked from #61. No earlier report is
relabelled as evidence for the later artifacts.

The first hosted head run exposed a fixture mismatch in Firefox: welcome can read
the real public GET plan catalog without credentials, but the synthetic navigation
server required authentication for that route. The existing fixture now explicitly
serves that public metadata before its unchanged protected-route authentication
check. The Firefox recovery case forces that passive catalog read and verifies it
creates no model decision. The focused native case passed with all original privacy,
keyboard, decision-count and independent-outcome assertions retained.

Raw logs and fresh reports are retained under ignored `output/qa/61-first-run/`.
Both allocated fixture projects were removed with their own containers, volumes
and networks. Their private environment and temporary orchestration file were
deleted after verification. Other development services were not removed.
External model calls: zero. Managed Gemini and paid checkout remain disabled.

Native store installation and data-consent prompts, physical
devices and screen-reader speech remain pending until performed. Live providers,
quality gate #43, billing #50 and production/release certification remain separate.
