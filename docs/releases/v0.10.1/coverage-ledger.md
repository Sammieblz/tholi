# Coverage ownership ledger

Cleanup baseline: commit `2b81e80`, October 17, 2026. Counts are diagnostic, never coverage quotas. Corpus/matrix inputs and thresholds are unchanged.

| Former owner or repetition                                                                          | Replacement owner                                                           | Assertions retained                                                                                                                                                                 |
| --------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `acceptance/authored.spec.ts`, 13 state evaluations inside one runner case at each of two viewports | `unit/navigation/core.test.ts`                                              | Each golden engine status/state, semantic target and expected terminal/refusal; 13 cases execute once without a browser                                                             |
| `live/wikipedia.spec.ts`, repeated text-size and References journeys                                | `browser/acceptance/wikipedia.spec.ts`                                      | Existing text-size/References independent oracles plus the unique persisted one-page memory assertion                                                                               |
| `nlp-browser/wikipedia.spec.ts`, separate language journey                                          | `browser/live/language.spec.ts`                                             | Full polite English request, retained active request while picking, explicit full-English Spanish request, active request through the picker and actual language destination origin |
| Public DreamWorks portion of `nlp-browser/reported-page.spec.ts`                                    | `browser/live/reported-page.spec.ts`                                        | Real unlisted page, discovery and retained navigation evidence; full tier only                                                                                                      |
| Deterministic fragment portion of the same mixed file                                               | `browser/extension/multi-app/dynamic.spec.ts`                               | Missing-section refusal and valid unclipped fragment evidence; PR tier retained                                                                                                     |
| `picker-reveal.test.ts`                                                                             | `unit/navigation/lifecycle.test.ts`                                         | All nine indexing/reveal regressions, including detached/missing/ambiguous negative cases and lifecycle cleanup                                                                     |
| Viewport-independent extension behavior repeated at 1280 and 720                                    | `core-desktop`                                                              | Every behavioral assertion runs once; `narrow` retains the live-inspector and collapsed generic-discovery branches                                                                  |
| Full mock account/onboarding journey at three widths                                                | `browser/website/web.spec.ts`, once at 375                                  | Full validation, password nonpersistence, skip/mode and completion flow remain; all-route 320/375/768/1440 and theme/layout checks stay in full reflow coverage                     |
| Nine near-identical reporters                                                                       | `support/evidence.ts`, browser/runtime adapters                             | Exact collected cases, failures/skips, unchanged bytes and build identity; specialized acceptance metrics remain separate                                                           |
| Flat corpus/config layouts                                                                          | `fixtures`, `integration`, `unit`, browser ownership; named runner projects | Original frozen bytes, safety thresholds, protocol/public APIs and source provenance preserved                                                                                      |

Ordinary PRs defer the 50,000-node benchmark, busy-page animation measurement, complete 4-width/2-theme route reflow and scroll-path profiling to full validation. Focused narrow layouts, all website feature flows and deterministic permission/privacy/continuity regressions remain in PR coverage. Deferral is not removal.

No navigation safety, permission, privacy, continuity or independent outcome oracle is intentionally removed. New release-evidence rejection assertions extend the existing tooling test owner rather than adding a parallel test suite.

## Individual merged evaluations

The authored owner retains these exact matrix state IDs, each now evaluated once in `unit/navigation/core.test.ts`:

`home`, `account`, `billing`, `plan`, `profile`, `retention`, `login`, `confirmation`, `success`, `unknown`, `conflicting`, `ambiguous`, `origin-change`. Each keeps its independent golden status/state and semantic target. This replaces 26 browser-based engine evaluations in two runner tests with 13 unit cases.

The picker owner retains every `pending detached picker` parameter in `unit/navigation/lifecycle.test.ts`:

`matching`, `no interaction`, `unrelated dialog`, `collapsed`, `occluded`, `consequential`, `other task`, `desired value`, `other frame`.

The removed generic live owner comprised `Ada_Lovelace` and `List_of_James_Bond_novels_and_short_stories` at both `desktop` and `narrow`. The corresponding article/viewport acceptance cases retain independent text-size and References outcomes, and assert one persisted page immediately after References, before language-picker transitions, matching the former owner. This assertion applies to those two articles at both viewports. Other articles retain their original outcome coverage. Initialization failure handling records only missing sample IDs, so a later assertion cannot duplicate completed samples.

The removed independent NLP/Wikipedia runner case supplied the polite English picker request and explicit English Spanish request. These are now in the two existing live-language cases, with active-request, actual target language and destination checks. French-origin coverage in the existing language regression remains.

The removed 768px and 1440px mock account/onboarding executions retain their feature assertions in the 375px journey. Their layout/theme/zoom assertions remain in the all-route reflow owner. The public DreamWorks and local clipped-fragment portions of the mixed reported-page case retain separate owners as listed above. DreamWorks runs once per live viewport project at its original 1420px and 720px widths and 920px height. Its former inner width loop would duplicate both widths after the project migration; that loop was removed, preserving every reference, footer destination, clipping, privacy and missing-section assertion.

Component layout fixtures and dynamic/authentication probes now build once into `dist/test-fixtures`. The two component cases retain all size, focus, selection, decision visibility and overlap assertions, isolated from marketing CSS; runtime/authentication probes retain their original semantics. No fixture is shipped in the product bundles.

The existing diagnostics-export case retains real browser download and JSON privacy assertions. Its disposable-tab harness now waits for document focus, then uses a trusted button click. Keyboard navigation remains owned by the accessibility case. No export bytes, privacy conditions or native permission claims are mocked.

## Viewport-independent repetitions removed

Each former narrow execution below is retained under `core-desktop`, with the same behavioral assertions. The two compact-control cases are the only additional narrow executions.

- panel exposes distinct status announcements, stable polling and usable keyboard controls
- retains create-account context through a dynamic account menu, a new document and form fields
- retains a plain login goal through an expected cross-origin popup
- an unmatched destination reports an unavailable estimate instead of zero clicks
- an authentication server redirect retains context while unrelated navigation is rejected
- cloudflare: account settings survives an unmounted menu without substituting product settings
- github: account settings survives an unmounted menu without substituting product settings
- explicit activation, verified steps, retention branch and final hard stop
- wrong turn reroutes, alternate label survives, pause and stop remove guidance
- login excludes synthetic secrets and requires resume
- ambiguous duplicates and unknown screens stop instead of guessing
- delayed same-URL render waits, and full page navigation stops
- production localhost access is available without a toolbar grant
- two origin-filtered tasks have independent previews and billing completion
- active sessions reject switching and delayed updates from a previous route
- unsupported tabs offer no tasks and cannot replace a pinned session
- debug inspector renders scoring and exports bounded diagnostics
- passive overlay follows geometry, all four edges, browser zoom and reduced motion
- Back and Forward keep fresh full-document and same-document bindings without duplicate progress
- actual service-worker suspension restores running without duplicate guidance
- tab switching and closure keep running pinned
- actual service-worker suspension restores waiting without duplicate guidance
- tab switching and closure keep waiting pinned
- actual service-worker suspension restores paused without duplicate guidance
- tab switching and closure keep paused pinned
- open shadow roots refresh and verify controls without reading field values
- same-document navigation with replaced DOM verifies once and preserves the session
- edit entry points use page and section context, then stop at publishing or an undeclared edit effect
- language intent selects the primary popup, awaits a choice, then verifies the chosen destination
- detached popups need matching purpose and user interaction, and description changes rescan the target
- page loads verify the actual destination, reject stale IDs, preserve pause and stop
- changed controls invalidate pending plans and memory, and forgetting stops observation
- goal form uses semantic fallback, model proposals are checked, and consequential controls stop guidance
- site knowledge survives a complete browser restart and clear-all removes it
- heading hierarchy resolves repeated section controls and refreshes local site context
- structured model intent survives a rerendered owned menu while invalid AI falls back to live matching
- retains one destination through modal, full document navigation and preference selection
- a wrong native selection cannot complete the destination
- saved routes persist across browser restart and rebind after a website change
- retains the objective while a stale control is replaced and recalculates
- cross-origin destination requires continuation and then verifies the retained task
- a linked popup retains task context through explicit tab continuation
- model follow-ups receive the original destination and verified progress after a dynamic menu

Repeated production-manifest assertions in the extension factory are retained once in the core setup: exact host grants, required `tabs`, and exclusion of `history`. Fixture-only permission variants remain separate from production bytes.
