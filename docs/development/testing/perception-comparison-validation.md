# Perception comparison preparation and validation

Recorded October 31, 2026 for [#43](https://github.com/Sammieblz/tholi/issues/43).
This record concerns the operator implementation and its checks. The live
comparison, independent quality decision and issue acceptance remain pending.
It does not authorize model calls, certify a release or change a historical report.

## Implementation and source ownership

The [protocol](perception-comparison.md) freezes the declarations, outcome rules,
270 trial tuples, balanced order, limits and interpretation before quality results.
The original 18-case corpus is unchanged. Six fresh cases were independently
reviewed before any Tholi/model projection or outcome collection; the protocol
records both review-time and final frozen file hashes. Offline dry runs exclude
that fresh holdout.

The operator profile extends the existing model port, authenticated HTTP routes,
PostgreSQL repositories, native observation pipeline and single journey owner.
Ordinary startup and consumer choices remain fake-only. An operator activation is
temporary, bound to the declared account/workspace/client, exact goal, scope,
manifest, arm and generation. Local, revocation, expiry and sign-out withdraw it.
It cannot restore itself from saved settings or transfer browser/OS authority.

The content-free journal reserves aggregate worst-case liability before dispatch,
records exact serialized-body hashes and distinguishes count/generation intents
from provider receipt. Valid measured settlement is durable before reuse.
Unknown usage, a privacy canary or uncertain accounting stops the run. Cancellation
starts one durable cleanup even after the caller stops waiting; late preparation
cannot dispatch a model. These temporary operator reservations are separate from
the production credit engine planned in #44.

The report retains fixed denominators, unsuccessful attempt costs, conditional
rendered-target precision and rejected-output counts. It leaves all-emitted-target
precision unavailable where it has not been observed. Known-sentinel evidence
does not claim a broader privacy audit. Missing device measurements or unsettled
costs remain unavailable; they are not zeros or a beta pass.

## Focused source checks

| Check                                                   | Result     | Evidence under ignored `output/qa/`                                                    |
| ------------------------------------------------------- | ---------- | -------------------------------------------------------------------------------------- |
| Client contracts, identity, lifecycle and widget owners | 159 passed | `comparison-43-client-unit/c297bdf5-cd98-4155-9248-e1564718c6ee/unit.json`             |
| API authorization and request lifecycle                 | 38 passed  | `comparison-43-api-authorization/09f01cd5-7b4a-45fd-a947-9d078b26e859/unit.json`       |
| Journal, spending and actual policy owner               | 43 passed  | Existing model-experiment focused owner; superseded by matching full CI when completed |
| Persistent grant-only fixture variant                   | 4 passed   | `comparison-43-variant-unit/d64e020e-0b04-461c-a292-3379b90e0cf2/unit.json`            |
| Final comparison/metrics tooling                        | 7 passed   | Final focused tooling owner; superseded by matching full CI when completed             |
| Whole-project TypeScript                                | Passed     | `comparison-43-typecheck-3.log`                                                        |
| Production build                                        | Passed     | `comparison-43-build.log` and `output/build-manifest.json`                             |

The focused client report SHA-256 is
`38aad2c5efae1522444593501505b0ddf5007e19401b91ab2fc430656ba1cbb8`;
the final focused API report is
`d723161e5f2e783e5751b5320123c7941cad1d0e2b2f10ed35ce27cd92cea0ac`;
the persistent-variant report is
`41351d418aa9cdb025f32b0e12c5c649984dd1a2e5cf9361d8eeabc68432a04e`.

The fresh build-manifest SHA-256 is
`2c6e8b6845272baf5597ea80d2983297e676622f9b2acffdf54d8a3ad1422585`.
The first complete CI attempt,
`aa2e0c50-d69f-41fc-b07a-5688dbc62276`, stopped in unit tests: 1,010/1,011 passed.
The first API fixture exceeded the existing five-second test limit at 5.131
seconds. An isolated follow-up passed all 38 authorization checks, with that case
completing in 1.116 seconds, under
`comparison-43-api-authorization-ci-followup/fbf41585-e260-4c0e-a317-d03e9a4c027f`.
No source, test limit or build artifact changed for the rerun. This isolated
check does not replace a complete CI pass. All browser groups remained unrun in
the failed CI attempt; copied reports carrying other run IDs are excluded.

The second complete attempt, `34da9cb2-8362-438e-8bb6-95f1d1c51741`, used the
same verified artifacts and port 5188. Its matching reports establish:

| Group                                      | Actual result                           |
| ------------------------------------------ | --------------------------------------- |
| Unit                                       | 1,011 passed                            |
| Installed Chromium core                    | 56 passed                               |
| NLP / multi-app / continuity / reliability | 8 / 8 / 3 / 1 passed                    |
| Native Firefox                             | 4 failed during shutdown                |
| UI                                         | Not run by this failed complete attempt |

The independent UI cohort `7ea46971-1cf7-4e67-a378-b9a5e56ecceb` then passed
67/67 against the same production artifacts. It is separate evidence, not a
replacement whole-CI pass. Both complete local CI attempts remain failed.

All four native Firefox 159 cases reported the existing thirty-second quit
timeout. A private Gecko trace identified Firefox's
`RemoteSettingsExperimentLoader: disabling` blocking the `quit-application`
barrier. [Mozilla records this shutdown signature](https://bugzilla.mozilla.org/show_bug.cgi?id=2018640).
This machine also exhibited it in the preserved #42 follow-up before #43.
Teardown can mask an earlier exception; the report does not establish that every
case body passed. Case 3 separately recorded its sidebar, minimized arrival,
draft retention and request retention checks as true.

A temporary BiDi-close diagnostic closed its socket in three milliseconds but
did not resolve quit. A temporary experiment-policy candidate was inconclusive;
the release browser's alternate-path gate cannot be safely enabled through its
[security-disabling automation configuration](https://searchfox.org/firefox-main/source/js/xpconnect/src/xpcpublic.h).
No such configuration was applied. All temporary probe sources and policy JSON
were removed. Native helper files, the user's Firefox, global settings and browser
installations remain unchanged. The raw trace is private QA evidence with SHA-256
`a73e6a2f55b9e9aeca00718fc9469af701ec3dc999cddf4e99057ae5d891758a`;
its bounded phase-summary hash is
`5c8752df5447f91bda60763bc38fa8ee0ed494a07a654914d2b9807cfd990ccb`.
Exact-head hosted checks must all pass before merge; local failures are retained.

## Presentation guidance

The existing [accessibility skill](../../../.codex/skills/fixing-accessibility/SKILL.md)
and [UI guidance](../../../.codex/skills/ui-ux-pro-max/SKILL.md) informed the
reused account surfaces: native processing-group labels, associated image-consent
helpers, existing 44-pixel targets and visible focus, keyboard-operable Local
withdrawal and one stable polite/atomic Processing status. Temporary operator
labels name fake or Vertex explicitly without inventing plans or balances.
Existing fonts, tokens and motion remain; no button arrows were added. Focused
source checks cover operator labels and Local/image withdrawal. Actual
screen-reader speech and native permission prompts are not claimed.

## Actual local setup

The existing Compose stack was started as a new disposable project with seven
healthy services. A direct port mapping on the internal-only database network
produced no listener, despite appearing in Docker's requested port bindings.
The operator overlay now reuses the pinned gateway image through Compose
inheritance as an eighth, fixed-destination SQL proxy. The actual loopback SQL
connection and proxy health passed; PostgreSQL remains internal-only. Normal
Compose still exposes no SQL port. Existing API runtime credentials and normal
identity are reused. No second database, source checkout, SDK installation or
dependency tree was created in the workspace.

The actual installed callback preflight passed with runtime-manifest SHA-256
`b780c7188f1b81737433479a0b5b222dc5a3da759611c3bb1c6dfaa3e0a3669a`.
One persistent grant-only fixture path keeps Chrome's unpacked identity stable.
Every reused file is checked against the built artifact; no identity key is added.

Normal local OIDC, broker and PKCE sign-in then passed with the registered callback
and a synthetic local account. Current page-context and image consent was recorded
explicitly for that fake evaluation account. The bounded private session wrapper
is stored only under the allocated ignored QA directory. No token is included in
this report. This verifies the local service flow, not a native sign-in window,
production identity provider or permission prompt. No model was invoked.

## Integrated capture fix and final fake readiness

The geometry-corrected cohort
`evaluation-43-corrected-readiness/da2ecd2b-7a62-4e29-b07a-cc8d9eb01d0c` still
failed all three multimodal attempts after a client reservation but before API
admission. Both required server consents were confirmed unchanged and granted.
Source tracing found the actual capture bug: `PREPARE_CAPTURE` compared page and
perception object identity, while required fresh `GET_PAGE` observations recreate
those objects. Removing those observations would weaken freshness verification.

The existing PageCoach now owns a semantic capture-current predicate. It permits
equivalent fresh scans and preserves the actual document, request/task/progress,
review, DOM, viewport, Stop and expiry checks. Large perception evidence is
normalized once per fresh snapshot, not for every node in the privacy walk.
Original masking revalidation, native browser identity, grants, visibility,
fifteen-second visual lease and the original service deadline remain intact.
The existing reliability owner passed 15/15 source checks, including one new
regression exercising real rescans and capture metadata. Its report SHA-256 is
`6224d2a93e5e5ea9109638b70cde5b8844dda2db384ac0ebf4cee0803c0e98fc`.
Its actual executed validation run is
`03ffc3b4-7e75-4ce7-b1d4-7ed64106ea19`; the preserved-copy folder
`comparison-43-capture-rescan/63cc5163-3597-4441-bf60-08b833c3b768`
has a separate capture identifier. The existing build digest in that unit report
is source-test context, not certification of the subsequently rebuilt extension.

The subsequent whole-project typecheck and production build passed. The new
manifest hash is
`afd20ace581f98b71387c3c7bb715320b32d8a62db241616b7b7909417deef0e`.
Only `content.js` and its source map changed in each extension target relative
to the earlier build; website files did not change. Earlier CI/UI reports are
not relabeled as checks of this new build.

Final focused fake collection
`evaluation-43-capture-fix-readiness/5cc8270a-5441-433f-8139-28733bf8f245`
verified nine of nine correct grounded Help dispositions: three Local, three
structured and three multimodal. All six service trials reached matched guiding
terminals with no terminal error. Every arm recorded an actual 1280 by 900
viewport, visual scale one and matching started geometry. There were no test-user
actions or observed false arrivals in these synthetic guidance-only cases.

The real runtime shutdown closed the journal normally. The shared audit/finalizer
verified six fake claims, authorizations and generation intents, zero unresolved
usage, zero known sentinel leaks within its stated audit scope and zero fake
cost. Finalized report SHA-256:
`6494e65b856ade0ff6ecdb93097b02a478958b10bc94aed9cf7be16b50b68b0c`.
It retains 270 configured attempts and 261 missing attempts;
`qualityEvidenceAvailable` remains false. This verifies the integrated image path,
not real-model improvement, independent holdout performance or beta acceptance.

The private initial session is now claimed once before its first refresh, using
an exclusive durable marker keyed by its opaque credential hash. Copying a
wrapper does not authorize a second collector. Rotations remain in the serial
parent's memory; an uncertain refresh stops use. A later independent collection
requires a fresh normal PKCE bootstrap. Preparation remains read-only. Focused
comparison/metrics tooling passed 9/9, including concurrent session-use checks.

## Earlier feedback and remaining gates

The first API cohort failed 19/36 checks at AJV startup because defaults had moved
inside conditional request alternatives. Its evidence remains at
`comparison-43-api-authorization-failed/331b9916-b7c3-4344-875e-e92fb08ceef6`.
The canonical request now keeps shared defaults outside its profile discriminator;
strict validation remains intact. The later 60-check and final 38-check cohorts
are separate evidence. Initial TypeScript feedback identified an unused import,
an optional path narrowing and the missing comparison attachment type; the third
whole-project run passed. Earlier logs remain in ignored QA output.

The first offline fake gateway startup was refused before any model call. Its
consumed, closed zero-claim journal is retained in the disposable QA directory;
it cannot be reused. Build-byte verification still passed. The gateway refusal
was resolved by the isolated SQL proxy described above.

The first installed fake collection,
`evaluation-43-readiness/268c5c41-05fb-49ee-9f38-b3dc9f234749`, retained all 270
declared denominators while collecting only the nine page-injection tuples.
Three Local and three structured trials produced correctly grounded Help guidance;
all three multimodal attempts failed readiness before any reservation or HTTP
dispatch. These are synthetic guidance checks, not completed real workflows or
navigation-quality improvement. The journal recorded exactly three fake claims,
authorizations and generation intents with reported usage and zero cost.

The open journal remained provisional. A terminal interrupt did not reach that
owned gateway; after verifying zero unresolved usage/liability, only its exact
verified fake process was stopped. The original journal remains unchanged and
open as interrupted evidence. No closed-journal success is inferred from it.

A discard-only native capture probe then proved missing capture permission in
the RPC-started fixture. Actual `Extensions.triggerAction` on the native tab
enabled capture without new flags or grants. Its 500 by 905 PNG exposed the second
fixture issue: emulated metadata still reported 1280 by 900. Both probe sources
were removed; no pixels were persisted. A native action and real window geometry
must be applied consistently across all comparison arms before rerunning.

The live Vertex comparison requires new exact-data and
bounded-spending approval; the earlier $0.02 one-shot approval is consumed.
An expired, reformatted, incomplete or fake run cannot satisfy that gate.

Issue #43 stays open until actual repeated comparison evidence and an independent
go/no-go decision are recorded. Paid rollout, native Firefox model quality,
production identity, native permission prompts, screen-reader speech, release
certification, packaging and deployment remain separate checks. Desktop
implementation #54 remains deferred.
