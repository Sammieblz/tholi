# Historical build evidence, October 2026

Historical observations only. They do not certify current bytes.

## Archived build verification — v0.6.8

Production extension candidate: **0.6.8**. Protocol: **navigator.live 1.0.0**. The source baseline is the user's commit `1aec0785d13cc03f322e0b7212000b70e264b5a3`; these changes remain local, uncommitted and unpublished.

| Check                                                                        | Result                      |
| ---------------------------------------------------------------------------- | --------------------------- |
| TypeScript and both production builds                                        | Passed                      |
| Core, discovery, context, task planning, memory, privacy and lifecycle units | 105/105 passed              |
| Full extension browser regressions at both website widths                    | 78/78 passed                |
| Full live Wikipedia regressions at both widths                               | 12/12 passed                |
| Unchanged declared accuracy matrix                                           | 14 tests / 116 cases passed |
| Formatting and diff validation                                               | Passed                      |

Persistent task journeys retain the original destination and verified progress through menus, modals, intermediate documents and linked popup tabs. Optional on-device model follow-ups receive the destination and bounded verified history. Weighted observed routing compares fastest/fewest-interaction paths; provisional estimates distinguish observed and predicted upcoming steps. Saved tasks persist in browser-owned IndexedDB and rebind current controls after website changes. Shared navigation schemas replace duplicated contracts; unused full-memory transfer on fresh-page requests is removed. Panel feeds allow one outstanding poll and ignore replies after teardown. See [task-routing.md](../../guides/journeys.md).

The browser fixtures verify one Spanish destination through three interactions, a wrong selected value, completed-state revalidation, changed-site route reuse after a complete browser restart, individual route deletion, stale replacement, a picker that removes its clicked link while loading, redirect rejection, cross-origin continuation, popup tabs and model task-context contracts. The existing accessibility case now delays both panel feeds and verifies that requests cannot overlap. Desktop and narrow task-panel PNGs were inspected; both contain the same valid 380×1720 rendered panel with three verified steps. Their identical bytes reflect the fixed test-panel width; website viewports remain 1280×900 and 720×900. Actual native panel presentation remains separate.

Live Spanish regressions independently open the correct picker, guide Español, reach the actual Spanish article and retain the same task at its permission boundary. Chrome withholds an ungranted host's tab URL. Navigator offers access to the clicked link's expected origin, then checks the actual URL and originating tab after permission, before observing or advancing. Without that grant it cannot claim task completion. Permitted local fixtures verify continuation/completion; actual Spanish-host permission prompts and denial/retry remain in [chrome-handoff.md](../../guides/getting-started.md). No Wikipedia product selector or fixed article route was added.

The final semantic-mode matrix was evaluated at `2026-10-11T19:41:27.403Z`; its SHA256 remains `bb66d75a1671c3f34abfb16430c87c26fe932cf293f36efdbefd2d161e97f7ae`. Live: **60 attempts, 71/71 targets, 71/71 verification claims, 60/60 supported outcomes**. Generic: **30 cases (18 negative), 24/24 targets, 18/18 verification, 12/12 positives**, twelve intentional unresolved decisions. Authored: **26 cases, 12/12 targets, 18/18 verification, 26/26 state conformance**, eight expected stops. All measured suites report zero false success, Navigator automation, known sentinel leakage and model calls. Missing/unexpected cases are zero. These measurements apply to the declared cases, not universal website or real-model accuracy.

Final live report: `2026-10-11T19:35:39.837Z`. Final browser report: `2026-10-11T19:47:24.373Z`. All three complete reports match the same ten production build files. `npm run package:extension` read back every archive member and matched the evaluated bytes. Verified candidate: `output/releases/internet-navigator-0.6.8.zip` (**696,505 bytes**), SHA256 **0eb1e66b6f79d01d3705bedd5d836943d58e1dc15378a398965a2a6e67a33156**, packaged at `2026-10-11T19:47:36.979Z`. Adjacent SHA256/provenance files identify the baseline, dirty tree, metrics and pending native checks. Prior versioned archives remain intact.

`output/acceptance/journey-iteration-notes.json` retains actual failures and corrections: discarded visible ownership, fixture charset and disabled-button timing, an earlier matrix timeout, saved-plan deduplication/cache identity, single-coach navigation evidence, ungranted-host URL handling, disabled continuation, duplicate predicted step counts and zoom/polling investigations. Failed full reports and traces remain archived. Some zoom/message stalls had no established precise root cause; targeted diagnostics varied. Full suites passed after redundant transfer removal and bounded polling, without changing live assertions, cases or timeouts. Earlier passing bytes are preserved separately rather than substituted for the final artifact.

Fastest routing optimizes a bounded known graph, with broad guidance-to-result timing estimates. Unknown screens remain provisional. Actual Gemini Nano quality, native Chrome toolbar/reload/content replacement, screen-reader speech and permission dialogs remain unverified; model contracts use deterministic fakes. OCR, custom model training, remote providers and inaccessible-frame/canvas adapters were not introduced. Native handoff #10/#17/#18 stays open. Reload the extension at `chrome://extensions` and refresh the website before trying **Change language to Spanish** once and following **Continue task here** at the destination.

## Historical acceptance scope

Candidate 0.6.8 adds eleven task-routing units and fourteen browser regressions: retained Spanish context through a modal/intermediate document, wrong native selections, changed-site saved routes after restart, stale control replacement, guarded origin continuation, popup tabs and task-aware model follow-ups. Two added live regressions independently reach Spanish Wikipedia with the original destination retained. Production optional permissions are not expanded by the harness: Navigator must await the native Spanish-origin grant before reporting its own completed task. Permitted local-origin fixtures verify continuation/completion. The matrix remains 116 cases with AI off; journey regressions and actual model quality are separate. Earlier v0.6.7 reports remain version-prefixed.

