# Page perception validation: October 30, 2026

Owner: [issue #37](https://github.com/Sammieblz/tholi/issues/37). This is implementation and diagnostic evidence, not release certification. Extension/API 0.11.0 and website 0.1.1 remain unchanged.

## Acceptance matrix

| Criterion                        | Implementation and evidence                                                                                                                             | Current limit                                                                         |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Region hierarchy and scrollers   | Generic dialogs, menus, regions and actual scrollers extend current discovery owners. Focused regressions passed.                                       | Unmounted, virtualized and closed-shadow controls remain unknown.                     |
| Measured, bounded projection     | Shared ambiguity filtering, recursive opener bundles, closed ancestry and whole-context byte accounting. Both after cohorts had no dangling references. | A valid graph is not evidence that the most useful target was retained.               |
| Grounded additional observations | Native identity, scan UUID, revision and retained region constrain read-only refinement. Native checks span observation and final binding.              | No clicking, scrolling, menu opening, wider host grant or fabricated frame transform. |
| Privacy and existing budgets     | GET_PAGE sidecar geometry stays outside persisted sessions and public models. BFA native and dense-page checks passed.                                  | Current native performance passed; human permission checks remain pending.            |

Raw composition is bounded to 16 frames including root, 100 regions and 600 control references. Model projection permits 16 frames, 32 regions, 96 controls and 24,000 total UTF-8 bytes. IDs, frozen tasks and existing authority boundaries remain intact.

## Comparison cohorts

Runs used Windows x64, Node 24.19.0, Chromium 156.0.8078.4 and disposable 1280 by 900 profiles. Corpus, oracle, timeouts and interactions are unchanged. Instrumented runs use the same physical collector SHA, `3eaa27c7e2f0724a6702818b3839a5ec01b03f689e9c0f9b657c9e2af035c099`. GET_PAGE refresh can replan; it is not a passive observer. The untouched cohort therefore remains distinct.

| Cohort                          | Run                                    | Collected       | Navigation completed | Target retained        | Report SHA-256 prefix |
| ------------------------------- | -------------------------------------- | --------------- | -------------------- | ---------------------- | --------------------- |
| Untouched before                | `ba6fb3a9-4f39-4f39-a812-7dd0b6081a7e` | 17/18           | 6/18                 | 15 known, 1 unmeasured | `53bda1356d4e`        |
| Instrumented before, incomplete | `b36c0c55-8e6e-4ef8-b1f3-cd58bb20997e` | 17/18           | 6/18                 | 15 known, 1 unmeasured | `7d82c8d4f56c`        |
| Filtered diagnostic             | `d9542a2c-3921-4909-97c8-e147f73c0e3f` | 1/1 exploratory | 1/1 exploratory      | 1/1                    | `ae96b537a0c1`        |
| Instrumented before, complete   | `3baf5f50-9970-4b28-aa35-e6b9bdc38224` | 18/18           | 7/18                 | 16/18                  | `5a44cd8a3483`        |
| Initial frozen after (BFA)      | `0fe5600c-2c81-4d99-bb21-e4387486db85` | 18/18           | 7/18                 | 15/18                  | `468234da0b44`        |
| Post-analysis compact (15F)     | `e4ed3e69-f92c-48ae-bbd4-10241942a201` | 18/18           | 7/18                 | 16/18                  | `0e3c0a4705c0`        |

Both incomplete cohorts retain a first-task 90-second timeout of unknown cause. The filtered success had a 19-second GET_PAGE/SET_GOAL probe and does not replace either failure.

Complete before and initial BFA after both completed 7/18 tasks, with zero recorded false success. Target retention **regressed from 16/18 to 15/18**: wiki-plot left the model projection despite remaining in the snapshot. BFA contexts used 23,663 to 23,983 bytes versus 24,036 to 24,279 before. Budget compliance does not establish navigation improvement. Live site counts varied; indexed candidates are not eligible lost controls.

Before product source is `50b28ea2b14f1a587260fa72c68c31381b03d688`; instrumentation-only source is `c2bdb8e0ee871690aea639e67967d8c8c70c6107`. Initial frozen after source is `bfa04506b9da72598b16faf53b483829fdff309f`, with Chromium digest `eb5e38d148715ee4b118f57523bbbcc62e7c3a49868eeb4ee154f0c86942244d`. Manifest verification passed before and after those complete runs.

The [comparison record](evidence/page-perception-2026-10-30.json) preserves full hashes, every case and unknown counters as null. Baseline artifacts are in the baseline checkout under `output/qa/perception-37/`; the filtered diagnostic is under `output/qa/perception37-wiki-diagnostic/`. Initial after artifacts live in the implementation checkout under `output/qa/perception-37/after/0fe5600c-2c81-4d99-bb21-e4387486db85/`.

## Post-analysis format review

Current source `15f869dab56d9c053b0da5ccef5db25acaba19b6` follows a separate code-only audit, without corpus/report reads. It found repeated native references and region labels. Strict lossless frameId inversion and exact ordered regionIds retain a byte-saving fallback. Ranker, labels, headings, eligible pool, limits and Nav1 are unchanged. Two generic round-trip regressions, 53 focused tests and whole-project types passed.

The compact regression cohort collected 18/18 tasks, retained targets in 16/18, and completed the same 7/18 tasks, with zero false success. All contexts fit 23,731 to 23,999 bytes, with zero dangling opener, region or parent references. Artifacts remained immutable and source remained clean.

The review occurred after initial results were inspected. The compact cohort remains separate, without relabeling BFA or claiming held-out quality gains. Issue #43 requires a fresh, independently reviewed holdout before quality comparison. Existing tasks remain unchanged regression evidence.

## Validation status

| Source/evidence                              | Recorded result                                                                                                                                                                                                                                                                                   |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Initial focused work                         | 139 checks passed at the recorded source.                                                                                                                                                                                                                                                         |
| BFA native frames and installed Firefox      | Two frame and two Firefox cases passed in run `1b135c36-f8cf-40f7-85b4-4a584d9efcd1`. The earlier strict message-field failure, report and trace remain under run `6cf7ca78-3115-4ea8-bd74-fb75839fcb1f`.                                                                                         |
| BFA paired native performance                | Chrome 155 / Firefox 159 warm planning p95: 123.2 / 183 ms; OCR p95: 688.7 / 704 ms. Existing budgets passed in run `0fc0127d-d998-4f38-9568-72e4da39c13a`.                                                                                                                                       |
| BFA dense page and actual Chrome interaction | Existing 50,000-node/5,000-control benchmark and actual Chrome interaction passed in run `7994c3de-699e-4fcd-a446-ef03002d49fe`.                                                                                                                                                                  |
| Current compact source                       | Build/types and 53 focused tests passed. Local CI passed all 817 tests in run `e1f09fe2-1769-4d04-8641-6b7b441f6d91`.                                                                                                                                                                             |
| Current paired native performance            | Chrome 155 / Firefox 159 warm planning p95: 114.6 / 157 ms; OCR p95: 723.2 / 758 ms. Pause/Stop remained below 1 second. Run `956841e9-d65f-4dc7-a44a-fefab3752b0d` passed.                                                                                                                       |
| Current actual Chrome interaction            | Run `5d6f1e8a-e752-46d0-8d5f-d1d09f170ea2` passed the website interaction and native surface checks.                                                                                                                                                                                              |
| Initial hosted 15F head                      | [Workflow 41131215447](https://github.com/Sammieblz/tholi/actions/runs/41131215447) passed all eight checks, 58 real PostgreSQL groups and 28 stack checks. Verified artifact `13013407005`, SHA-256 `1ba3e0e8b5e4a7824bfd6f7a140b5b1dd8a1b098de8eddc8b230b3297cded4e8`; owned cleanup completed. |
| Structural review                            | Native authority, current-region refinement, composition and ephemeral ownership were reviewed without blocking findings. Snapshots remain point-in-time; content still verifies effects.                                                                                                         |
| Remaining acceptance gates                   | Checks on the final documentation head, final review, merge and roadmap updates remain pending. Issue #37 is not yet accepted.                                                                                                                                                                    |

Implementation-checkout native/performance artifacts are under `output/qa/perception-37-native/` and `output/qa/perception-37-performance/`, indexed by the run IDs above. Earlier passes do not certify later source. Current native checks verified the same manifest before and after execution. Current manifest and both target digests are recorded in the comparison JSON.

A manifest failure exposed junction-backed model inputs. Physically materializing them preserved verification guards and existing archives. An LF attribute preserves the frozen collector hash.

Human permission, screen-reader and signed-in checks remain pending. This record does not certify capture, Gemini, enterprise accuracy or release. The local planner does not consume experimental model projection.
