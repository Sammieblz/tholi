# macOS, provider connections and private learning validation

Owner: [issue #87](https://github.com/Sammieblz/tholi/issues/87). The
[canonical plan](../../plans/gemini-cloud-and-enterprise.md#macos-byok-and-private-learning-decisions)
records scope, sequencing and privacy boundaries. This feature preparation keeps
extension/API 0.11.0 and website 0.1.1 unchanged. It authorizes no release,
deployment, archive replacement, external model call or paid infrastructure.

## Native compatibility preparation

The reported Mac symptom is an opening interface followed by failed guidance.
Affected browser/OS versions and the failing startup stage are unknown. No
specific Mac runtime cause has been established.

The shared harness now discovers macOS application bundles and platform-correct
Selenium drivers while retaining explicit overrides and Windows discovery.
Cleanup verifies disposable-profile ownership and process identity before
terminating a browser. It never targets a user's ordinary browser by name.

The native matrix reuses existing Chrome smoke, Firefox conformance and native
pixel/privacy tests. Reports stay separate by runner, architecture and browser,
and bind to both immutable extension digests. Requested browser backing scale
must agree with the measured DPR and zoom. A full cohort cannot reuse reports
from an earlier validation run.

Source review found two common recovery defects: a rejected MiniLM initializer
remained cached, and rejected widget registration could leave the interface
unavailable. Initialization now clears only its failed lifetime; widget recovery
asks the existing lifecycle owner again. Worker errors use a closed, content-free
stage/code contract, including stale-event protection. These corrections are not
evidence of the unknown Mac failure's cause.

## Fresh source feedback

- Browser-tool contracts: 7 passing checks, run
  `033910c3-658d-4740-8951-e214b0b83bff`, preserved under
  `output/qa/87-macos/033910c3-658d-4740-8951-e214b0b83bff/`.
- Model lifetime, worker recovery and widget registration: 14 passing checks,
  run `4c54ce4c-703b-4c65-8b0b-768037e92090`, report SHA-256
  `2b3018c5eb987db86ae498c8b1baea69dd00e6c63933e37ef67a002ba3994651`,
  preserved under `output/qa/local-engine-87/4c54ce4c-703b-4c65-8b0b-768037e92090/`.

These focused reports import current source and reference the preceding build;
they do not certify new extension bytes. A fresh complete cohort must cover the
final source, including subsequent harness/provenance corrections.

The combined final Mac-preparation source cohort passed **26/26** checks across
five owners on Node 24.19.0, run `e24ff861-eb43-4b9f-acb1-bf363b9641aa`.
Its preserved unit report SHA-256 is
`9e1169bbc391df832380d6828b6f90bf1887bbb89bc48bbc125fcec8714c6b02`.
The production build passed with Chromium digest
`e0529bee5b2916ab2330ec59ad0eb9a97e20cab10f85873947b46d2445f45f03`
and Firefox digest
`c128cbf68405c6ee9e3eef7c7daf3ad3b8c9009a12fc1a54fc527716c479ba85`.

The Windows native platform group passed **7/7** on Chrome 156.0.8078.80 and
Firefox 159.0, run `2cbb726e-79be-47f1-b8d5-75c834c9a378`, including observed 2x
backing scale at 80%, 125% and 200% zoom. Report SHA-256 is
`6a512e699531e887fdd3c8999598a766902437118f07ffc540b3e68c0d4979fa`.
Both reports are preserved under `output/qa/87-macos/<run>/`. This Windows result
does not establish Mac compatibility. An earlier six-case probe omitted Chrome
smoke because of a title filter and exposed an undersized headless Chrome fixture
viewport. The corrected filter and shared content-viewport helper are covered by
the fresh seven-case run; the failed probe remains separate.

## Native hosted feedback

PR run [42160691132](https://github.com/Sammieblz/tholi/actions/runs/42160691132)
at `0c9a084fee68848543cf89370e5c5efcb8907168` passed all seven native cases on
each of `macos-15`, `macos-15-intel`, `macos-26` and `macos-26-intel`.
Both native browser architectures and measured 2x capture scale matched their
runner targets. This is feedback for that earlier build, not the final feature.

Earlier failures established two harness causes: Darwin truncated an executable
in a middle `ps` column, and a runner supplied ChromeDriver 151 beside Chrome
156/157. The shared resolver now selects an actual matching driver; process
inspection queries the executable in its own final column. Disposable-profile
ownership checks remain strict. The subsequent aggregate correctly rejected a
Firefox runtime attachment missing its driver version. That attachment is
corrected without weakening the validator. Windows feedback also corrected
the fixture's native-path expectation for 8.3 aliases and its expectation for
the newly visible registration failure on an unauthorized widget tab.

## Provider and private learning feedback

Provider lifecycle, isolated loopback HTTP protocols, canonical usage, quota
admission, versioned private storage and UI contracts have focused source checks.
Reports remain separate from the earlier model and release records:

- `output/qa/provider-http-focused.json`: 91 provider/domain/Vertex checks.
- `output/qa/provider-website-focused.json`: 13 account website checks.
- `output/qa/customer-accounting-87/4cefb9bf-ec52-4cd8-8986-7aef44fdf8c8/`:
  147 accounting, authorization, usage-version and service checks.
- `output/qa/87-private-memory-reuse-unit.json`: 31 graph/client/reuse checks.
- `output/qa/87-private-learning/e1ac6849-04f8-4a14-a2d6-94e953deeb7a/`:
  73 extension safety and learning presentation checks.

Subsequent integration changes require fresh complete PR validation. Automated
unit fetch denies external customer and managed model endpoints before dispatch;
protocol fixtures intercept requests and use owned loopback HTTP servers only.
These results do not establish vendor availability, real-key acceptance,
retention promises, live navigation quality or customer prices.

The optional egress tunnel is covered by injected DNS/dial and real loopback
socket tests. Static authored-YAML checks cover its declared network/key mounts.
Automatic approval review rejected the separate synthetic Compose interpolation
check with the reason "blocked by policy" before execution. No temporary fixture,
container or provider request was created by that rejected check. Compose
interpolation and runtime validation of the BYOK overlay remain pending.

## Integrated source feedback

The complete local `test:ci` cohort passed **1,241 unit checks and 148 browser
cases** on 2026-11-06, run `0f3ade28-640f-400d-8e88-96b9cec87bc7`.
Its immutable build, reports and log are preserved under
`output/qa/87-final-pr-gate/0f3ade28-640f-400d-8e88-96b9cec87bc7/`.
This comprises 56 core, 20 integration, five Firefox and 67 interface cases.
An earlier complete attempt passed through Firefox, then stopped because an
existing server occupied port 5174. Its reports remain separate; the passing
cohort used a dedicated test port without stopping that server.

A subsequent cross-owner review identified a pause/read race. Delayed settings
acknowledgements could restore an older local learning choice after a reduction.
The existing owner now fences mutation acknowledgements, lets reads only preserve
or reduce local permission, and retains the original cancellation span through
learning, retrieval, saving and reconciliation. The final focused cohort passed
**91/91**, including six distinct race regressions, run
`d5227365-7645-4cd7-a8da-ec0c6c80e975`. Its report is
`output/qa/87-private-learning-pause-race.json`, SHA-256
`a066d9396bd22313edad5bd126dab2c2325b1f83d6133697bcde41c6e71a1dd7`.
The preceding complete cohort does not substitute for final committed-source CI.

TypeScript, version checks and the production build passed again after that
correction. Both rebuilt native Windows provider/learning cases passed, run
`6ccfba0e-90eb-40cb-8e73-64b64af528d7`, preserved under
`output/qa/87-private-native-final/6ccfba0e-90eb-40cb-8e73-64b64af528d7/`.
Report SHA-256 is
`665124de985ea31b990caa889cea310cc19e9d6536dad96ef40c71158fead952`.
The Chromium digest is
`c4181d23dc63459da8270d14480343fd085f56849a29e5de6666c3a809757c59`
and Firefox digest is
`4698fc69367723fc628d093a43344d571940d368b26f709f6c2bf88085bbba95`.
The cases verify a known route without a model request, an independently
completed live task, rejection of changed structure, pause, confirmed forgetting
and Local transmission fencing. Both themes, keyboard focus, reduced motion
and four viewport widths are measured. Chrome uses CSS viewport emulation at
375/640/960/1280; native headless Firefox uses its actual 500/640/960/1280 widths.
No Firefox 375-pixel viewport or Mac result is inferred from this report.

## Subsequent native and configured feedback

The first integrated hosted cohort at `523c045654a59e75675e2b26adbbd1c68fd46042`
exposed an OS-dependent fixture assumption: both new flows waited for provider
selection after the same arrow-key sequence. Mac 15 on both architectures and
Mac 26 on ARM each passed the seven earlier cases and failed the two new cases
at that wait. The next cohort uses Selenium's native option selection, verifies
the selected value and retains keyboard activation and the same time budget.
Run [42171572877](https://github.com/Sammieblz/tholi/actions/runs/42171572877)
at `be18e68f702adb182edab9bce18556e53d4a616f` passed all nine cases on Mac 15
ARM. Other feedback in that cohort exposed a restart fixture seeding a draft
outside its mounted UI owner, plus a private-learning readiness timeout whose
phase was not retained. The restart setup now types through the actual textarea
and waits for the existing draft acknowledgement. Fixed, content-free readiness
labels distinguish initial, layout and later settings phases without logging
account values or page data. These changes require a fresh final native cohort.

That hosted integration run also exposed a real discovery defect. After a
pointer-triggered scan drained, changing native `<details open>` could leave
indexed descendants stale because the existing attribute invalidation branch
omitted `open`. One deterministic regression reproduced zero notifications
before the correction. The existing discovery owner now invalidates descendants;
all **55** focused checks passed, run `a4e3d267-0a6f-4227-85df-69dcfe23237b`.
Report `output/qa/87-native-details.json` has SHA-256
`f089e31a7c19a2ef8d6cf8b75f88206c2d6379ae0e87d8a34067a156f0b2913a`.
No navigation expectation, observation budget or timeout was weakened.

The first actual-OIDC configured website cohort passed four of eight cases:
provider settings and account export/deletion passed in both browsers; saved-data
editing/filtering and private-learning interactions failed. Its retained report
is `output/qa/87-configured-web/tholi-smoke-mw4jypw8-babf47c5/validation.json`.
A separate two-case diagnostic cohort is preserved under
`output/qa/87-configured-web/tholi-smoke-mw4kkahk-0332655c/`.
Saved-data editing, search, export and deletion passed with HTTP 200; the earlier
data failure did not reproduce, so no service-limit or production change was
justified. Private learning again failed the fixture's immediate `.check()`
assumption, before its mutation dispatched. The acknowledged-only controls now
use native clicks, exact HTTP 200 responses and checked/unchecked assertions.
Edit/search assertions also wait for their actual typed responses. Temporary
response probes were removed; zero-model-request guards remain. Both disposable
projects, containers, networks, volumes and private environments were cleaned,
with default artifacts unchanged. Final eight-case evidence must follow these
fixture corrections and the rebuilt final source.

Firefox's synthetic sidebar tab was unsuitable for native draft typing: making
it active correctly triggered the product's other-tab guard. The restart fixture
now reuses the existing real-widget surface owner, performs actual typing and
platform-specific clearing, and uses Firefox's genuine toolbar toggle to close
the native sidebar. Its exact retained-draft, native identity, memory, frame and
outcome assertions remain. A fresh Windows Firefox run passed **1/1**, including
the strict graceful shutdown gate, run `2952377a-d8f8-4480-91ff-374ef5b956ff`.
Evidence is under `output/qa/87-widget-native/2952377a-d8f8-4480-91ff-374ef5b956ff/`;
report SHA-256 is
`5bca337226fb02478b39e671fc9358eea2ab33472ea8ab7d70570bdd43332b67`.
Earlier typing, gesture, visibility and shutdown failures remain separate.

The subsequent configured cohort passed **6/8** and isolated two Firefox
failures. A bounded Firefox diagnostic confirmed successful PATCH and readback
records, followed by a compatibility GET returning 429. It also observed a
site-settings OPTIONS request returning 429 before the mutation dispatched,
alongside 65 successful preflights. Its report is
`output/qa/87-configured-web/tholi-smoke-mw4m7xwg-735e0aca/validation.json`.
The temporary gateway logger recorded only fixed route categories, method and
status. Its override, private environment and browser probes were removed after
owned teardown. The default artifact manifest remained unchanged. This evidence
justifies eliminating redundant read compatibility discovery; it does not
justify raising gateway or inference limits.

The existing saved-data client now retains only successful public schema-2
compatibility for its exact service, account, workspace, view and generation.
Read-only GET operations reuse that proof. Suspend, reset and scope/view changes
invalidate it; a late old-account reply cannot replace a newer proof. Mutation,
export and private-query feature checks remain fresh. Every actual request still
uses its current authentication, host, account binding, signal and final send
guard. Unsupported or malformed namespace responses clear the matching proof
without retry or fallback; an ordinary missing item does not.

The permanent regression first reproduced **four discovery calls for four
reads**, where one is required, in
`output/qa/87-v2-read-discovery-before.json`. After the correction, all **50/50**
focused client, website, privacy and API checks passed on Node 24.19.0. Report
`output/qa/87-v2-read-discovery-focused.json` has SHA-256
`6464103f5b85e38f3dda065c2e9bd45af82398b536e03e61859fc63ab1976a26`.
These checks include epoch changes, fresh write/export admission, delayed
discovery, malformed replies and cancellation/native-grant fencing after a
cached read. Fresh configured-browser evidence must follow this production
correction; the earlier six-case result is not relabeled as passing.

## Database feedback

The default cloud-free stack passed **27 top-level checks and 112 PostgreSQL
subchecks** in `tholi-smoke-mw4ha357-43318b0a`. The actual report is
`output/qa/local-stack/tholi-smoke-mw4ha357-43318b0a/smoke.json`; it covers migration
upgrade/replay, provider key isolation, customer quotas and reconciliation,
versioned graphs, retention/export cleanup, backup/restore and owned teardown.
Four earlier failed SQL/fixture feedback runs remain separate. No BYOK egress
profile or external model call was enabled. The later PR container job must
validate the final committed source independently.

## Final evidence requirements

[PR #88](https://github.com/Sammieblz/tholi/pull/88) owns the final committed-source
PR and container gates. Its native workflow requires nine cases on each of the
four declared Mac targets, including both provider/learning flows. The aggregate
requires one fresh cohort, actual browser/driver architectures, both build
digests and observed 2x capture scale. Earlier seven-case feedback cannot satisfy
that final contract. Inspect the checks and attached artifacts for the reviewed
commit; source-only and independently collected reports do not replace them.

Store installation, physical Retina displays,
native permission prompts, real signed-in provider use and screen-reader checks
remain pending until performed. Automated provider tests must use local fixtures
with external provider traffic denied. Managed Gemini and the deferred live
quality gate remain disabled.

## UI guidance

Widget recovery, account provider forms and private learning controls apply
`.codex/skills/fixing-accessibility/SKILL.md` and the local `ui-ux-pro-max`
quick-reference guidance: named native controls, associated labels/errors,
keyboard access, visible focus, semantic tokens, minimum 4.5:1 text contrast,
reduced motion and confirmation dialogs. Base UI owns modal focus and
cancellation. Password fields clear before awaited mutations; busy, error and
status feedback are announced. Provider, image, collection and retrieval choices
remain separate. Native checks measure 44-pixel targets and keyboard focus in
both themes. No button arrows or new visual system are added. Automated DOM
checks do not establish actual screen-reader speech.
