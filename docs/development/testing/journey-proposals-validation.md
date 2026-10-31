# Journey proposal integration verification, October 31, 2026

Scope: [#41](https://github.com/Sammieblz/tholi/issues/41), extending the tested
#40 source commit `382639cfc5539811978b2abbfa8bf205ace31b1a`, merged through
[PR #79](https://github.com/Sammieblz/tholi/pull/79). This is development and PR
evidence, not release certification. Extension/API `0.11.0`, website `0.1.1` and
existing release archives remain unchanged.

## Implementation and review

The existing background journey owner installs the local plan and schedules
explicitly selected service enrichment outside its routine and local inference
queues. One shared native page-observation helper serves both the existing panel
and the proposal path. The existing masked-capture owner supplies a separately
authorized visual follow-up. No second observer, credential store, persisted
cloud journey or screenshot execution path is introduced.

The background admits known references before an actual-document-targeted content
message. Content refreshes and binds the retained request, task, journey,
workflow, page, viewport and ordinary control. It reuses selection and independent
outcome owners. Service steps are exploratory, including frame results, and do
not establish whole-task arrival without independent objective evidence. Earlier
back/tab/visual actions and stale route
or recovery estimates cannot survive onto a different service-proposed step.

The canonical proposal union is reused by API and content consumers. Processing
metadata has a separate bounded contract, no completion state or private body,
and is removed before persistence and after restoration. Current source labels
distinguish the proposed step from the original local plan's provenance and
confidence. No private-backend or collection consent is implicitly upgraded.

Independent reviews found and corrected incidental scan-UUID comparison,
duplicate admission after asynchronous settings reads, suggestion-provider
selection, optional account-read failures, unbounded queue waits and stale status
resurrection after verified progress. Actual native IDs, generations, permission
checks, original clocks and fixed two-call job limits remain enforced.

Installed-browser investigation also exposed a late local recovery that could
replace an accepted service step. Accepting a proposal now invalidates that
recovery without resetting its safety budgets. A separate desired-state
regression proved that exploration returned before the existing independent
objective check could finalize a genuinely reached destination. The existing
objective owner now decides that case; a verified exploratory step toward an
unknown destination still remains unresolved.

## Validation status

| Check                                                                      | Status                                                                       |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| Shared navigation/model/Vertex adapter contracts                           | Passed: 99 focused checks                                                    |
| Content and background lifecycle                                           | Passed: 80 cases in the final complete cohort                                |
| Existing masked native capture regressions                                 | Passed: 25 checks                                                            |
| TypeScript and synchronized versions                                       | Passed in the final complete cohort                                          |
| Fresh production build and manifest                                        | Passed in `382e85ea-371d-4441-8ed0-b0cfdd9c8f3d`                             |
| Installed-client authenticated service round trip                          | Passed: six Chromium proposal/outcome/interruption cases and native Firefox  |
| Chrome/Firefox planning, OCR and Stop performance budgets                  | Passed, same build, both native browsers                                     |
| Complete deterministic `test:ci`                                           | Passed: 1,100 checks, one fresh build                                        |
| Hosted required PR checks                                                  | All eight passed for code commit `3e5d6a1e`; final head checked before merge |
| Native data-processing/sign-in permission prompts and screen-reader speech | Not performed for this milestone; remain pending                             |

Final cohort `382e85ea-371d-4441-8ed0-b0cfdd9c8f3d` contains 957 unit, 53 core,
20 integration, three Firefox and 67 UI checks. Its manifest SHA-256 is
`145d5dd000a98ea1fc8e922e14cdfff332a2e898fdd091392ac274d9e83b4fe5`;
Chromium/Firefox build digests are
`e3689b5db93290764ef0ff6a28c3d7a9905f4755c8cbc668b5864bcf594322d2` and
`d46fe6a6a7edf0713dd13771a74a4a8d351c420e1db144b2b6fd69031f6c9baf`.
Matching reports and the fresh paired performance result are preserved in
`output/qa/journey-41-ci/382e85ea-371d-4441-8ed0-b0cfdd9c8f3d/`.

The final paired run used Chrome `155.0.8059.40` and Firefox `159.0` on the same
Windows/Node `24.19.0` host. Warm planning p95 was 126.3/259 ms, warm OCR p95
716.1/702 ms and Stop 8.8/18 ms, respectively, against unchanged 750/2000/1000 ms
limits. Cold times, device memory and busy-page frame measurements remain in the
full report: active frame p95 was 267/183.5 ms and stopped baseline p95 was
250.3/216.9 ms. Passing the three retained budgets does not imply smooth rendering
under that 50,000-node synthetic load. The earlier paired result remains under its
separate `c36868d0-4d57-4fc7-97c9-9e81445e3cae` identity.

All eight hosted checks passed for code commit
`3e5d6a1e6ed2b452264a314c5592981fff0c783b` in
[workflow 41176015223](https://github.com/Sammieblz/tholi/actions/runs/41176015223).
The evidence-only commit requires another hosted head check before merge. No
production artifact changed when recording these results. All 23 preserved
release-file checksums still match.

Focused evidence remains under `output/qa/journey-41-*`. It does not relabel the
matching #40 CI, browser or actual-container evidence as #41 validation. Earlier
fixture failures are retained: the background fixture initially omitted required
frame coverage; the corrected fixture now produces fresh scan UUIDs on every
observation, matching the browser's stable-page behavior. No runtime bound was
weakened to fix those fixtures.

Earlier Chromium cohorts remain separate under their original run identities.
The arrival fixture initially used "Set Dark to on", which the existing parser
retained as value "to on". The fixture now uses supported "Turn Dark on" and
asserts the retained target and desired value before inference. This fixture
correction does not claim to fix the broader wording limitation. The independent
objective regression used an already well-formed request and failed before its
outcome fix. The later mutation fixture failure is retained separately: its trace
proved actual cancellation and rejection of the old target, while the test
incorrectly required automatic fresh inference. Explicit user recovery is checked
separately from rejection of stale work.

Complete gate `303ddeba-2868-4d67-be3e-af27b424b4f6` stopped on one five-second
API fixture timeout (955 of 956 unit checks passed); the isolated 31-check API
owner then passed without changing deadlines. Cohort
`3d9ed592-c8de-4e15-9649-1a7901d225e9` passed all 956 unit and 53 core checks,
then stopped with 19 of 20 integration checks passing. The stale-frame request
was rejected, but helper extraction had replaced its useful "unavailable"
explanation with a generic error. Locally authored observation failures are now
distinguished from arbitrary browser errors so the existing explanation survives
without exposing untrusted failure text. These failed cohorts and traces remain
under their original identities; neither is complete passing PR evidence.

## Browser and evidence boundaries

Installed-client checks use a loopback HTTP fake, synthetic account tokens and
explicit fixture grants. Credentials are seeded only in trusted extension
contexts through the existing protected-store boundary. A Firefox grant variant
must differ solely by its declared fixture permissions and record its actual
manifest hash. Original manifests and ordinary fresh-profile conformance remain
unchanged. These checks establish per-browser transport, native identity and
binding behavior; they do not establish native permission prompts or real OAuth.

Unknown goals can verify a step while remaining unresolved. A separate explicit
desired-state case must independently observe its requested value before claiming
arrival. Held responses must not overwrite Stop, Pause, a replacement goal or
changed DOM. Fake provider quality is never scored as Gemini quality.

Run the existing complete PR gate and the paired browser performance owner on
matching verified build bytes. Use `THOLI_UI_PORT=5188` when another local preview
occupies the default port. No paid inference, production deployment, release
packaging or new desktop implementation is authorized by this record. The #43
measured comparison still needs its own approved experiment and spend allowance.
