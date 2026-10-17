# Repository cleanup, October 17, 2026

Baseline: `2b81e80`. Scope: local refactor and validation infrastructure; no deployment, dependency upgrade, public API/storage migration or replacement download.

The previous hosted workflow ran one long job on both feature pushes and pull requests. The supplied PR showed 35 and 38 minutes for duplicate runs. Twelve independent runner configs, repeated API builds and duplicated viewport-independent journeys increased overhead. These observations are historical, not measurements of the revised workflow.

The new graph builds once, then runs unit, extension behavior, UI and specialized integration jobs independently. Browser jobs serve production previews of the shared website and demo artifacts; coordinated runs refuse to reuse an unrelated development server. The demo and prebuilt component/runtime probes are included in the immutable manifest too. Test fixtures are not shipped in application packages; component tests no longer depend on Vite’s private `/@fs` route or marketing styles, and browser jobs no longer compile their own runtime probes. Public sites, model/OCR budgets, performance and the complete acceptance matrix are full-tier jobs. Preview processes are started only by groups that use them: live-site checks need neither local preview. Original per-suite test deadlines are retained in the named projects. The longest full jobs are scheduled first. Local task timings are written to `output/qa/timing-*`; hosted critical-path and warm-cache measurements remain pending until the revised workflow runs.

Eight Playwright and four Vitest configurations became two thin root entries and two project definitions under `config/testing`. Nine repeated reporters became common collection/provenance helpers with two adapters; specialized acceptance metrics remain. Tests are grouped by behavior and fixture ownership, with Node as the pure-test default.

The [coverage ledger](coverage-ledger.md) records each removed/merged case and retained assertions. The authored static oracle moved from 26 browser-based state evaluations in two runner cases to 13 unit cases. Extension behavior now executes once except two real compact-control branches. Repeated website account/onboarding runs execute once; responsive coverage remains in its own matrix. The moved DreamWorks case uses the two live viewport projects once each, with its original widths and height, instead of nesting another two-width loop. No quota drove removal.

Documentation is grouped into guides, architecture, development and per-version release folders. Authored registry notes merged with route authoring. The early UI refinement record merged into the later dated audit, retaining its original measurements and explicitly labeling the superseded design. Identified 0.6.5 through 0.6.9 build records have version folders; unversioned history remains dated. Website article slugs and legacy Markdown source mappings are preserved.

The reductions below describe ownership and duplicated work, not coverage quotas. Extracted responsibilities remain in their feature/service modules.

| Owner or repeated execution             |                Before |                                  After |
| --------------------------------------- | --------------------: | -------------------------------------: |
| Playwright definitions                  | 8 root configurations | 1 project definition + thin root entry |
| Vitest definitions                      | 4 root configurations | 1 project definition + thin root entry |
| Core browser executions                 |                    90 |       47, retaining 2 compact branches |
| Static golden state evaluations         |        26 in browsers |                    13 in unit coverage |
| Full website account/onboarding journey |              3 widths |       1 width; reflow remains separate |
| Worker composition                      |           2,058 lines |                              497 lines |
| PageCoach facade                        |           1,915 lines |                            1,495 lines |
| Guidance controller                     |             872 lines |                              660 lines |
| Practice composition                    |             518 lines | 6 lines, with adapter/workspace owners |
| Legal renderer                          |             661 lines |       116 lines, with separate content |

Source extraction keeps one worker session owner, one UI snapshot subscription and PageCoach as facade. See [extension ownership](../../architecture/frontend/extension.md), [website ownership](../../architecture/frontend/website.md) and [shared UI](../../architecture/frontend/shared-ui.md). Generated entrypoint names, manifest privileges and frozen corpus/matrix bytes are preserved. Source/media provenance is not regenerated to conceal byte changes.

The reachability audit starts at the manifest/build entrypoints, web/demo mounts and API CLI, then accounts for separately built API inference/OCR workers, Vite configs, prebuilt browser fixtures and the test-only acceptance-metrics package. It found no removable unreachable source owner. An exact function-body comparison above 240 normalized characters found no additional duplicates. Reviewing smaller blocks identified shared landmark matching, browser/API transition normalization and documentation article links; these now use their existing owners. The short widget-frame lookup remains inline in two independent capture tools. This is a limited static check, not a proof against all semantic similarity.

The frozen-byte audit also found that Git had checked out the acceptance declaration with CRLF. It is restored to the original committed LF bytes and explicitly pinned in `.gitattributes`, with the existing checkout-integrity test extended to protect its original SHA-256. Corpus, matrix and image bytes match the baseline. Manifest privileges and recording provenance data are unchanged; recorded media hashes still verify.

Validation also exposed a fixture readiness race and an environment-dependent export failure. Starting a fixture now waits for the panel command to finish as well as the worker's running state. Saved-route replay waits for the new journey from the restarted inference worker before inspecting its target; its rebind, outcome and deletion checks remain. Chromium's blob inspector reported the 10,760-byte JSON as `PENDING_QUOTA`; the machine had about 200 MB of free physical memory. The two export-test profiles use Chromium's [file-backed blob transport switch](https://github.com/chromium/chromium/blob/main/storage/browser/blob/blob_storage_constants.h), retaining actual browser completion, exact JSON and privacy assertions. Production exports are unchanged. Other profiles, including performance tests, retain normal blob settings. Temporary native/blob probes and an unsuccessful data-URL experiment were removed. This does not certify behavior under system-wide memory exhaustion.

## Local validation and timing

Validation used Windows, Node 24.19.0 and an AMD Ryzen 7 5700U (16 logical processors, about 7.4 GiB usable RAM). These are local measurements with other applications running, not hosted CI timings. The full coordinated run was `15251e6a-857f-48b5-bf30-376fac268234`; its passing deterministic/model groups evaluated extension digest `16688e4073b4caa7435c08e10196662c0d56110f166955f0fcd71894363c06ba`.

| Scope                                | Result                                                             |                                     Local elapsed time |
| ------------------------------------ | ------------------------------------------------------------------ | -----------------------------------------------------: |
| Unit contracts                       | 285 passed in 35 files                                             | 46.2 s in the full run; 71.2 s in the final PR attempt |
| Frozen NLP                           | 11 passed                                                          |                                                 12.5 s |
| Multi-app runtime/model              | 17 passed                                                          |                                                 16.2 s |
| Vision runtime/routes                | 4 passed                                                           |                                                 17.4 s |
| Core browser                         | 47 passed in the full run                                          |                                             9 min 44 s |
| Full specialized browser integration | 21 passed, including mutation and OCR checks                       |                                                  5 min |
| Full UI                              | 27 passed, including complete reflow and motion measurements       |                                             5 min 16 s |
| Public-site regressions              | 8 passed, 6 failed                                                 |                         11 min 48 s; not certification |
| Final PR preparation                 | Types, all production/fixture builds and immutable manifest passed |           21.5 s types + 50.5 s build + 1.4 s manifest |

The final `test:ci` attempt (`433a2702-a85b-47b6-9698-22d31209c61d`) passed preparation and all 285 unit contracts. Three browser cases then reached their original 30-second deadlines. It was stopped while Windows reported less than 100 MB free physical memory. The public acceptance attempt was also stopped under memory exhaustion (about 30 MB free); it is incomplete. Neither attempt is a passing gate. Earlier successful group runs do not turn this final attempt into a pass.

Public failures included geometry deadlines, picker readiness, a planning timeout and one unhandled JSON parse error of unresolved origin. Memory pressure was observed, but it does not establish the cause of every failure. The merged persistence assertion was also incorrectly added after language selection to every article: it is now limited to its original Ada/James Bond owners, immediately after References, and checks the reply error explicitly. Failure handling now attaches only missing scenario IDs instead of duplicating completed samples. This final acceptance-harness correction passed types but still needs a clean browser rerun. Frozen goals, thresholds and product routing were not relaxed.

The measured full-run deterministic critical path is core at 9 min 44 s, plus preparation if measured end to end. The revised workflow runs independent groups in parallel; the hosted warm-cache PR critical path and the ten-minute target remain unverified. Full validation must be rerun successfully before packaging. Current mixed, failed or historical evidence is rejected; no release archive was created or replaced.

Motion measurements from the passing full UI run were 16.8 ms frame p95 for both the normal website sample and its synthetic busy sample (90 frames each), and 33.3 ms for the route sample with 4 ms scripted work per frame. The 50,000-node extension stress sample measured 1,150.1 ms frame p95 while preserving the same highlight root. Passing its existing contract does not demonstrate smooth animation under that workload.

All 44 migrated frozen corpus/hash/matrix/image files match the baseline committed bytes. All 174 local Markdown links and fragments resolve. Recording-byte checks and Windows-style checkout integrity passed. Native Chrome permission/docking, screen-reader, real signed-in workflows and hosted runtime remain explicitly unverified.
