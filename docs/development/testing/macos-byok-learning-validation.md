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

## Pending evidence

Native checks on all four Mac targets, final Windows PR checks, provider and
learning integration, real PostgreSQL verification and the final complete
`test:ci` gate remain pending. Store installation, physical Retina displays,
native permission prompts, real signed-in provider use and screen-reader checks
remain pending until performed. Automated provider tests must use local fixtures
with external provider traffic denied. Managed Gemini and the deferred live
quality gate remain disabled.

## UI guidance

Widget recovery follows the existing project UI and accessibility skills: reuse
tokens and native buttons, announce loading and errors, expose a specific recovery
action and retain visible focus. No button arrows or new visual system are added.
Automated DOM checks do not establish actual screen-reader speech.
