# Historical build evidence, October 2026

Historical observations only. They do not certify current bytes.

## Archived checkpoint — v0.6.5

The predeclared `tests/browser/acceptance/matrix.json` contains five structurally different articles × six goal families × two layouts = **60 supported live attempts**. Final evaluation (2026-10-11T06:27:52.090Z) passed all 14 benchmark tests and all 112 declared attached cases, with no missing or unexpected cases. Windows, Node v24.19.0, Chromium 156.0.8078.4; optional AI disabled. Matrix SHA256: `a9519448312c3d465e2bd4d5cb1282cc6471964a68c67d0f1174f11c147dce29`.

| Suite                             | Cases                           | Correct targets / highlights | Correct verification / claims | Supported case outcomes            |
| --------------------------------- | ------------------------------- | ---------------------------- | ----------------------------- | ---------------------------------- |
| Live Wikipedia                    | 60                              | 71/71 (100%)                 | 71/71 (100%)                  | 60/60 (100%)                       |
| Generic fixtures                  | 26, including 14 negative cases | 24/24                        | 18/18                         | 12/12 supported positives          |
| Authored Northstar state fixtures | 26                              | 12/12                        | 18/18                         | 26/26 expected state-case outcomes |

Live unresolved/stopped: 0/60. Generic fixtures include eight intentional unresolved decisions; authored fixtures include eight expected stops. All suites recorded zero false-success claims, Navigator automation, known synthetic secret leakage and model calls in these tested cases. These are sample measurements with actual denominators, not universal website percentages or model accuracy. Language-picker completion means awaiting a choice; focus means the field is focused, not that a search was submitted. Authored state-case conformance is separate from live supported-goal completion.

Reports: `output/acceptance/results.json`, `e2e-regressions.json` (58 cases) and `live-regressions.json` (8 cases). They record every case and bind the evaluation to identical extension-file SHA256s. Missing/duplicate cases, failed tests, incomplete suites or artifact changes fail the gate. Earlier iterations remain in the same directory, including actual bugs corrected in distinct-control ambiguity and overly broad unrelated-effect verification, responsive search reveal, old status-label assertions and a verification assertion shorter than the runtime deadline. See [accuracy-benchmark.md](../../development/testing/acceptance.md) and `iteration-notes.json`.

`npm run package:extension` passed after all three complete reports matched the production build. The ZIP was read back and all ten members matched the evaluated bytes. Candidate: `output/releases/internet-navigator-0.6.5.zip`; SHA256 **f54b3c99d146b18f7d98d7dfd67ea5329e60c8bcd81742344ef0ba8f5067fbd3**. Adjacent SHA256/provenance files identify the baseline commit, dirty tree, metrics and pending checks. Packaging refuses overwriting the archive.

Completed this work session: #13 diagnostics, #9 lifecycle, #11 passive geometry and #14 measured/regression gates. Board totals: **10 completed, 4 retired, 3 work tickets open (#10/#17/#18), plus #1 tracker**. The candidate is not published. Native Chrome keyboard/screen-reader/permission/reload and fresh destination-origin handoff remain pending in [chrome-handoff.md](../../guides/getting-started.md). That limitation keeps the handoff/milestone tickets open; automated results do not substitute for those checks.
