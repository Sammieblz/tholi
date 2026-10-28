# Initial navigation baseline: October 27, 2026

Issue: [#24](https://github.com/Sammieblz/tholi/issues/24), first in
[roadmap #23](https://github.com/Sammieblz/tholi/issues/23).
Read the [protocol](navigation-baseline.md) and
[frozen task declaration](../../../tests/fixtures/navigation-baseline/corpus.json)
before interpreting these results.

The final experiment collected all 18 tasks. Tholi completed **7/18**, including
**7/9 Wikipedia** and **0/9 GitHub** tasks. Collection success does not mean
navigation success. These results establish a small public-site baseline, not
release certification or general website accuracy.

## Identity and reproduction

- Source HEAD: `9d2ea11bc2a81094b2662e4a8ab5ef06b57ff2f6`, with the issue #24
  collector and documentation changes in the working tree. This is not a clean
  tagged-source claim.
- Branch: `24-01-reproduce-navigation-failures-and-freeze-the-evaluation-protocol`.
- Final measurement run: `4cdf4abf-7475-41e2-9d0a-c3641f730518`, completed
  `2026-10-27T20:28:30.149Z`.
- Runtime: Windows x64, Node `24.19.0`, headless Chromium `156.0.8078.4`, AMD Ryzen
  7 2700X. Declared and applied viewport: `1280 x 900`.
- Extension/API `0.11.0`; website `0.1.1`.
- Chromium build digest:
  `9586078659f733eb46e73b4ad3813eb0f42c28fcd34bb092d11955a35d0f763b`.
- Corpus SHA-256:
  `1095f37ba0127937ee9ad327a49ee9170f9402cd2e13ea54d75a546e74cd8656`.
- Collector SHA-256:
  `8454fb5bf45c0001a9923b1e54b05500057c16d12c7fb8b7c754c4476a56638a`.
- Protocol SHA-256 at measurement:
  `24c3c2b9fe80ff4e42f5f04738bf3adf5c459bbc3326f8a4aae17ad99283dbf8`.

The [dated raw report](../../../output/acceptance/navigation-baseline-2026-10-27.json)
contains the per-case independent outcomes, selected controls, coverage and
projection counts, request states, runtime manifest hashes and original build
artifact hashes. GitHub uses the existing disposable permission variant with
`https://github.com/*` pregranted. The production manifest is unchanged; this
does not verify native toolbar grants. Firefox's build digest in the report is
provenance only, not evidence that this experiment ran on Firefox.

```powershell
npm run build
npm run test:navigation:baseline
```

The final run reused the verified immutable build from `test:ci`; it did not
rebuild or package it. Each task used a fresh profile. No private session,
credentials, remote edits, paid inference or saved screenshot was involved.

## Results by task

Counts below use the final captured snapshot for each task. Multiple controls
can legitimately point to the same destination. Retaining one eligible duplicate
is sufficient; dropping every matching control prevents an ID-only proposal.

| Case                  | Verified task outcome                | Expected controls in snapshot / model context | Reviewed finding                                                                                             |
| --------------------- | ------------------------------------ | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------ |
| `wiki-text`           | Completed                            | 1 / 1                                         | Appearance opened, requested Large radio checked and verified                                                |
| `wiki-theme`          | Completed                            | 1 / 1                                         | Requested Dark radio checked and verified                                                                    |
| `wiki-width`          | Completed                            | 1 / 1                                         | Requested Wide radio checked and verified                                                                    |
| `wiki-references`     | Completed                            | 2 / 2                                         | Actual References heading reached and verified                                                               |
| `wiki-search`         | Completed                            | 2 / 2                                         | Actual search field focused and verified; no query submitted                                                 |
| `wiki-languages`      | Completed                            | 2 / 2                                         | Actual language choices visible; journey awaits a choice                                                     |
| `wiki-history`        | Not completed                        | 2 / 2                                         | Interpretation/planning returned `no-match` despite available View history controls                          |
| `wiki-plot`           | Not completed                        | 2 / 2                                         | Interpretation/planning returned `no-match` despite available Plot destinations                              |
| `wiki-information`    | Completed                            | 1 / 1                                         | Tools opened, actual Page information destination reached and verified                                       |
| `github-issues`       | Not completed                        | 6 / 1                                         | Interpretation/planning returned `no-match` despite available issue links                                    |
| `github-pulls`        | Not completed                        | 2 / 2                                         | Interpretation/planning returned `no-match` despite available pull-request links                             |
| `github-actions`      | Not completed                        | 1 / 1                                         | Interpretation/planning returned `no-match` despite available Actions link                                   |
| `github-projects`     | Destination reached, task unverified | 1 / 1                                         | Correct Projects target selected; actual destination visible, retained request canceled, zero verified steps |
| `github-security`     | Not completed                        | 1 / 1                                         | Interpretation/planning returned `no-match` despite available Security destination                           |
| `github-insights`     | Not completed                        | 1 / 1                                         | Interpretation/planning returned `no-match` despite available Insights destination                           |
| `github-license`      | Not completed                        | 4 / 1                                         | Interpretation/planning returned `no-match` despite available license links                                  |
| `github-contributing` | Not completed                        | 3 / 0                                         | Local planning refusal; additionally every expected control omitted from future model input                  |
| `github-releases`     | Not completed                        | 2 / 0                                         | Local planning refusal; additionally every expected control omitted from future model input                  |

The existing `packages/acceptance-metrics` summarizer reports 12/12 declared
target selections correct, 11/11 verification claims backed by the declared
outcome, supported completion 7/18 (38.9%), and ten unresolved tasks. There were
zero recorded false final successes, Navigator clicks or LLM calls. These counts
are conditional on this small read-only sample. No private-data sentinel or
consequential-action attack was introduced by this experiment, so it cannot
establish those safety guarantees.

Calibration completion was 6/12; the unchanged local arm completed 1/6 held-out
tasks. Held-out outputs were inspected for this baseline only. Product ranking,
prompts, models, vocabulary, frozen corpora and release gates were not tuned.

## What the evidence establishes

**Interpretation and planning:** ten requests returned `no-match` while their
expected controls remained in the snapshot. Eight also retained an expected
control in the model projection. This supports investigating intent grounding and
planning, rather than assuming the website never exposed the destination.
The report's automatic `needs-review` labels are triage; the table above records
the manual interpretation of their captured statuses and candidate counts.

**Projection:** Wikipedia indexed 1,080 controls and projected 600 into the page
snapshot. The model input retained 67 or 68. GitHub indexed 472, projected 470,
and retained 62 to 65 in the model input. In the contribution and releases cases,
all expected controls disappeared from that last projection. The current local
planner does not consume that model projection, so this is evidence of a future
Gemini input problem, not proof of the cause of the local refusal.

**Verification and lifecycle:** the GitHub Projects oracle observed the declared
destination and visible main content. Tholi's final request was canceled, the
journey remained active, and `verifiedSteps` stayed zero. The existing acceptance
runner's failure-diagnostic path then tried to read a missing `page.controls`,
which obscured its original wait error. The independently recorded outcome and
final request state remain available. Investigate both the lifecycle and that
diagnostic guard in their existing owners; do not count the click as completion.

**Discovery and binding:** no exact missing-control discovery failure was
established by these 18 tasks. Complete pixel alignment and stale-element binding
were not independently measured for every live target. Existing deterministic
geometry checks passed, but they cannot establish those properties for all public
pages. Browser-window perception, virtualized enterprise screens and signed-in
apps remain unmeasured.

Acknowledgement times in the raw report include cold/recovery work. They do not
prove the proposed warm latency gate, isolated model inference time or a provider
cost estimate. No Gemini arm has run.

## Validation and retained attempts

- Focused discovery, outcome-metric, retained-request and checkout-integrity
  checks: **20 tests passed**. The existing checkout test now covers the new
  corpus's canonical bytes.
- `npm run test:ci`: **325 unit tests and 134 browser tests passed**, including
  installed Firefox and both website engines. Run
  `124ab0a2-8cda-4866-9462-e02a6497d665`.
- Final baseline: **18/18 measurements collected once**, all independent outcomes
  recorded, unchanged build verified. This is a focused experiment even though
  public-network configuration uses the runner's `full` tier.
- Final collector typecheck and formatting checked separately after its
  instrumentation corrections. Historical release reports restored after fresh
  CI evidence was copied to `output/qa/navigation-baseline-2026-10-27/ci/`.

Earlier attempts remain separate in `output/qa/navigation-baseline-2026-10-27/`:

| Attempt                | Identity                               | Reason it is not the final baseline                                                                                                         |
| ---------------------- | -------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `pilot-1.json`         | `bc16f25f-78fe-4f3e-9195-b6a4f55c45c3` | Radio matcher omitted group prefixes; hidden Page information link excluded; GitHub access missing; collector error obscured setup failures |
| `pilot-2.json`         | `2485d618-64e0-49f8-a1ed-ce57bbca39c7` | Radio check passed; hidden menu and GitHub setup still blocked                                                                              |
| `baseline-run-1.json`  | `ccaf79d0-2b7d-41f6-9354-6e4110a0f14c` | One 90-second timeout without a measurement; obsolete language-popup CSS selector produced an invalid outcome claim                         |
| `oracle-followup.json` | `8d931fad-bde2-49ed-99bd-b1344db23bf2` | Two-case follow-up: text and visible-language oracle both passed; not a complete cohort                                                     |

Corrections changed only collection: use the existing radio-label convention,
include hidden menu targets, declare a disposable GitHub grant, guarantee cleanup
and reuse the existing visible French-language-link oracle. Every task request,
destination, split and proposed gate stayed unchanged. The incorrect earlier
language result is not evidence of a product false-success defect. All final
counts above come exclusively from the final single run, not a merge of attempts.

No `test:full`, archive publication or deployment was performed. Native permission
prompts, native Chrome, screen-reader and authenticated workflows remain pending
outside this experiment's scope.

## Next issue

Use this baseline when reviewing [#25, architecture and service contracts](https://github.com/Sammieblz/tholi/issues/25).
Preserve the existing local path and single browser journey. Carry the projection
evidence into #37 and the lifecycle evidence into #41. Later #43 must rerun the
local arm alongside the two Gemini arms on matching builds, with separately
approved spend and an expanded sample before commercial accuracy claims.
