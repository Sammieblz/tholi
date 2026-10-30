# Page perception validation: October 30, 2026

Owner: [roadmap #23, issue #37](https://github.com/Sammieblz/tholi/issues/37).
This record covers page-region discovery and bounded projection. It does not
certify masked capture, Gemini quality, a release, packaging or deployment.
Extension/API version remains 0.11.0 and website version remains 0.1.1.

## Acceptance ownership

| Requirement                            | Existing owners and resulting boundary                                                                                                                                                                                                                   |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Region hierarchy and scroll containers | `StructureIndex`, `IncrementalControlIndex` and `PageDiscovery` retain generic dialog, menu, landmark and actual scroller evidence. Existing walks and per-snapshot geometry caches are reused.                                                          |
| Measured projection loss               | The existing composition and model-context owners share ambiguity and recursive opener handling. Ephemeral coverage distinguishes observed candidates, precomposition controls, composed controls and model input. Unknown candidate counts remain null. |
| Grounded additional observations       | A current native frame, scan UUID, local page revision and retained region identify a read-only refinement. Unknown, detached, private, closed-root or stale regions cannot acquire action authority.                                                    |
| Privacy and budgets                    | Legacy stored models and public identifiers remain unchanged. The whole model context fits 24,000 UTF-8 bytes; reference bundles are admitted together. Existing discovery, planning and cancellation performance budgets remain the gates.              |

Raw ephemeral composition admits at most 16 frames including the root, 100
regions and 600 control references. Model projection retains at most 16 frames,
32 regions and 96 controls. Region ancestry is closed and bounded to 16 regions;
discovery may traverse at most 64 neutral DOM ancestors to locate it. Truncation
is reported as unknown evidence. No app-specific product selector, fixed route,
frozen corpus or held-out request is used to tune this change.

The background binds actual native identity and browser zoom around a fresh
observation span. Authorized child-frame agents refresh through their existing
owner. Their explicit replies defer parent scanning until the final composed
read; ordinary mutation observations retain their normal updates. Zoom and
native navigation invalidate an in-flight span. Geometry remains frame-local,
not a fabricated transform into the root viewport. The sidecar travels beside
`GET_PAGE` and never enters `PageSnapshot`, `SessionView` or persisted sessions.

## Frozen comparison and provenance

The [existing protocol](navigation-baseline.md), task declaration, oracle,
12-calibration/6-held-out split, task timeouts, interactions and independent
outcomes remain unchanged. Every cohort retains all 18 declared cases in its
denominator. No paid provider, authenticated website, saved screenshot or remote
edit is involved.

- Accepted unchanged product source:
  `50b28ea2b14f1a587260fa72c68c31381b03d688`.
- Corpus SHA-256:
  `1095f37ba0127937ee9ad327a49ee9170f9402cd2e13ea54d75a546e74cd8656`.
- Protocol SHA-256:
  `c4c7a71c62b8ab9af53c1d1643bff4727e240d1fb239e8d4c1012339c578b634`.
- Original collector SHA-256:
  `bb27ea04a30b6bbe631107412cb4278e646f6c994a27f2b4220ca6740bd6ac72`.
- Measurement-only collector commit:
  `c2bdb8e0ee871690aea639e67967d8c8c70c6107`.
- Frozen instrumented collector SHA-256:
  `3eaa27c7e2f0724a6702818b3839a5ec01b03f689e9c0f9b657c9e2af035c099`.
- Unchanged Chromium build digest:
  `5367c9c82c638a1cae8465cb210b5665251c97159586d51ef24f5ebacd6c30bd`.
- Unchanged Firefox artifact digest:
  `d16176308d3f3ba9aa95c351f069c6af20f661eb02858f801f3e769ee87fc040`.
  This digest is provenance, not a claim that the public baseline ran on Firefox.

The baseline used Windows x64, Node 24.19.0, headless Chromium 156.0.8078.4 and
the same 1280 by 900 disposable-profile configuration. Build manifests were
verified before and after each run. Implementation lives in a separate checkout,
so it did not modify the source or artifacts used by either before cohort.

| Cohort              | Run and source                                                                               | Observed result                                                                                                                                                                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Untouched before    | `ba6fb3a9-4f39-4f39-a812-7dd0b6081a7e`, accepted unchanged source                            | 17 tasks collected; 6/18 navigation completions. `wiki-text` hit its unchanged 90-second test timeout without a measurement attachment. Collection failed overall.                                                                                                                            |
| Instrumented before | `b36c0c55-8e6e-4ef8-b1f3-cd58bb20997e`, measurement-only commit, unchanged product artifacts | 17 tasks collected; 6/18 navigation completions. The same first task timed out without an attachment. No instrumentation failure in the 17 collected tasks. All 20 collected observation samples exceeded 24,000 bytes, ranging from 24,036 to 24,282 UTF-8 bytes. Collection failed overall. |
| Instrumented after  | Pending final implementation and immutable build                                             | Not yet measured.                                                                                                                                                                                                                                                                             |

Neither before cohort recorded a false-success claim in its collected data. The
timed-out case remains unmeasured, so this is not a complete safety result. Its
precise timeout cause has not been established. Both failures, reports, timings,
manifests and error contexts remain separately preserved under
`output/qa/perception-37/{untouched-before,instrumented-before}/RUN_ID` in the
baseline checkout. A failed or blocked case must not disappear from comparisons.

The instrumented protocol, `get-page-pair-v1`, adds one real `GET_PAGE` at each
existing observation sample. It projects that matched page/perception/journey
pair once and leaves the original oracle reply and initial-planning timing
boundary intact. `GET_PAGE` refresh can replan, so it is not a passive observer.
The instrumented before and after cohorts must use the identical collector hash
and cadence. The unchanged original cohort remains separate.

## Focused evidence and remaining gates

- Discovery: 54 tests passed. A later active-scanner refinement guard and its
  assertion were added afterward and still require the combined fresh run.
- Projection/contracts/journey/authentication: 51 tests passed.
- Composition/native binding: 16 tests passed, including final-read races,
  pre-content zoom changes, zoom ABA invalidation and authorized frame refresh.
- Whole-project types passed before the final span/scan-cleanup changes.
- Fresh whole-project types passed on the completed span, parser and scan-cleanup
  source. The combined focused cohort passed 139 tests in seven files, run
  `e459c984-2366-422e-a8b9-8f34b548f18e`; evidence is preserved under
  `output/qa/perception-37-focused/e459c984-2366-422e-a8b9-8f34b548f18e`.
- Production build, actual browser checks, existing performance budgets, after
  comparison and `test:ci`: pending.
- GitHub exact-head checks, review and merge: pending. Issue #37 remains open.

Focused evidence is preserved in the implementation checkout under
`output/qa/perception-37-discovery/`, `output/qa/perception37-composition-01/`,
`output/qa/perception37-composition-02/` and
`output/qa/perception37-composition-03/`. Earlier passes are not relabeled as
evidence for later source edits. Sandbox startup failures that ran no tests are
distinct from the subsequently completed focused runs.

Native human permission prompts, screen-reader and signed-in workflows remain
pending until performed. Chromium evidence does not certify Firefox. The current
local planner does not consume the experimental model projection, so improved
retention alone cannot establish improved local or cloud navigation quality.
