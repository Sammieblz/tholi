# Build verification — October 10, 2026

Production extension: **0.6.1**. Generic live navigation protocol: **navigator.live 1.0.0**. Both demo and unpacked extension builds completed.

| Check                                                               | Result       |
| ------------------------------------------------------------------- | ------------ |
| TypeScript                                                          | Passed       |
| Core, discovery, planning, memory, privacy and model-contract tests | 56/56 passed |
| Production-extension browser integration at 1280×900 and 720×900    | 38/38 passed |
| Live Wikipedia goals on three articles at both widths               | 6/6 passed   |
| Whitespace/diff validation                                          | Passed       |

Reproduce with `npm run check`, `npm run test:e2e`, and `npm run test:live:wikipedia`. Browser harnesses use the production manifest unchanged. Local and live test artifacts are separate; `.last-run.json` reports passed for both suites.

Generic fixtures have no Wikipedia IDs/classes. They exercise menu reveal plus preference changes, section arrival versus visible Contents links, semantic goal entry, unsafe/ambiguous/model-invented controls, stale revisions, changed labels and invalidation, focus without field-value capture, full-page and same-document navigation, pause/stop across loads, open-shadow-root updates and interactions, and memory persistence after closing and relaunching Chromium with the same profile. Forget/Clear stop observation before deleting stored knowledge.

Live checks use Ada Lovelace, the James Bond novels/short-stories list and Casino Royale (novel) solely as reproducible test URLs. The first two articles exercise the text-size goal (opening Appearance when necessary), verify Large selection and verify actual References section viewport arrival. The reported Casino Royale regression now highlights the live languages button, verifies its detached picker and generates a single Français step despite duplicate suggested/all entries. No article allowlist, site-specific DOM selectors or fixed Wikipedia route supplies these plans.

Accuracy regressions cover regular plurals and decorative counts, explicit qualifiers, contextual ambiguity, hidden responsive duplicates, local versus shared-toolbar reveal relationships, accessibility description precedence and changes, shadow-root ownership, popup button roles, unrelated dialogs, equivalent navigation destinations versus distinct queries, opposite preference values, ordinary Help controls, and misleading or unnecessarily indirect model proposals. Descriptions participate in consequential-action checks and preserve field-value exclusions. Verified menu opening enters awaiting-choice; it does not claim a language preference changed. Match strength is displayed qualitatively rather than as a measured accuracy percentage.

The retained Northstar regression cases cover normal cancellation guidance and final hard stop, billing completion, retention/wrong-turn branches, alternate labels, login/checkpoint privacy, ambiguity/unknown screens, delayed renders, full-document interruption, pinned versions/tokens, localhost access and local diagnostic exports. Same-document Chrome loading events are checked against document identity rather than terminating SPA guidance.

The prior Wikipedia-specific coach, route packs, sample allowlist, URL policy, scope/continueOnNavigation schema fields, inspection helpers and superseded tests were removed. Shared authored-route functionality remains for controlled demo regression cases. Documentation reflects the new architecture and bounded extension-owned IndexedDB store.

QA screenshots are under `output/qa/generic-panel-*.png`, `output/qa/live-generic-*.png` and `output/qa/language-*.png`; panel layouts and the actual languages highlight were inspected at both widths. Load `dist/extension`, Reload at `chrome://extensions`, and refresh the website to replace an older injected script.

Limits: the on-device API adapter is tested with mocked structured responses, not evaluated for real Gemini Nano accuracy on this device. Live checks run semantic planning. Arbitrary-site permission prompts and native Chrome side-panel presentation still need manual smoke testing. Top-document/open-shadow-root semantics are supported; cross-origin frames, closed roots, canvas-only controls and universal website workflow coverage remain outside this adapter. Large scans are capped and disclosed; risk classification is heuristic.

This implements the dynamic Wikipedia proof of concept and site-memory architecture. It does not establish the original MVP's multi-site beta acceptance metrics, remote route distribution or desktop adapters. Remaining acceptance work is tracked in the repository's existing issue plan.
