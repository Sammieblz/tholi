# Reliability cleanup

This pass cleans the uncommitted reliability work after the packaged v0.9.1 candidate. Existing release archives and frozen corpora are preserved. Current source/build bytes differ from that archive; archived accuracy and performance measurements do not certify this build.

## Removed or consolidated

- Removed 21 compiler-reported unused imports, fields, locals and parameters, including an unused BrowserAdapter instance in the live coach.
- Removed the unused allowed-frame capture argument and the frame enumeration/permission loop that produced it. All iframe pixels remain masked; authorized frame DOM discovery is preserved.
- Replaced five duplicate build-hashing implementations with `scripts/artifact-files.mjs`. Reporters and both packagers now use the same recursively sorted file hashes. The shared and old algorithms were compared against the full current build and agreed.
- Removed disabled Paddle/OpenCV chunks and models from normal builds. The experimental source, pinned assets and comparison tests remain explicitly opt-in. The normal build removes leftover experimental assets when switching variants, with output-path checks.
- Removed duplicate live route cards, single-option task choosers, repeated headings, a repeated region name and the redundant primary Start action. Guide me is the primary destination action; page exploration remains expandable and authored demo tasks retain Start.
- Matched the Guide me button's accessible name to its visible text. The footer reads the actual manifest version. API health responses read package metadata rather than duplicated version strings.
- Removed unnecessary model/API build steps from CI; their build hooks already perform those steps.
- Scoped the visual-invalidation observer/listeners to active live sessions. Pause, Stop and page teardown disconnect them and clear pending notifications; Resume reattaches with a fresh viewport revision.
- Removed an automatic Resume command from authored-route navigation-status handling. Same-document states already publish their observations; the duplicate command could release a login checkpoint or explicit Pause. The narrow checkpoint regression exposed this path and passed after its removal.
- Consolidated repeated generated-test-directory ignore patterns.

TypeScript now rejects unused locals and parameters. Working offline NLP, default Tesseract, authentication continuity, review boundaries, storage migrations, public v1/v2 compatibility and the controlled demo route engine remain in place. The demo adapter and live discovery adapter serve different contracts; merging them would erase regression coverage and is outside cleanup scope.

## Documentation

The README provides one current installation path. The documentation index separates current references from historical validation. Chrome handoff, workflow coverage, NLP, discovery architecture, journeys, lifecycle, privacy, security and contribution instructions now reflect automatic scrolling, authentication waits, authorized frame discovery, OCR masking and session-only private context. Older measured reports remain historical evidence.

## Verification

- Strict TypeScript checks passed with unused-code checks enabled.
- All 159 core tests passed, including field/frame masking, authentication, outcome guards and visual observer teardown.
- Demo, default extension and optional API builds succeeded.
- The cleaned default extension contains 151 assets and occupies 59,052,883 bytes (56.3 MiB), down from the archived candidate's 76,271,843 bytes (72.7 MiB). No Paddle model directory or OpenCV runtime chunk remains in the default output.
- All 26 documentation files were checked for broken local links; none were found. Frozen NLP, multi-app, UI-image and Wikipedia accuracy-matrix hashes are unchanged. Existing extension/backend archives retain their original SHA256 values.
- All 86 desktop/narrow browser regressions passed on the final cleaned build, including the corrected authored authentication checkpoint.
- All 11 NLP/v1 API tests, 17 multi-app/v2 tests and four vision/API tests passed. Their reports use the shared hashing implementation and match the final extension bytes. The frozen multi-app corpus retains its existing GitHub default-branch miss (96.4% held-out precision/coverage); cleanup did not tune or erase it.
- Both reliability browser checks passed: the one-request simulated Prime journey through delayed 2FA/review, and real offline Tesseract on the frozen UI-image corpus. Tesseract achieved 100% accepted-region precision/coverage on its 24 held-out images (15 positive targets), with warm p95 108 ms for those 960×600 fixtures. Paddle is explicitly reported as not bundled, with no accepted score or passing claim.
- All three continuity browser checks passed, covering masked offline OCR, a verified browser return and task switching/resumption.
- `git diff --check` passed. The full live Wikipedia, acceptance and remaining release suites were not rerun for this cleanup; archived reports cannot certify the new bytes.

The helper initially assumed the old chooser existed before the panel finished refreshing. Browser failures exposed this synchronization assumption. It now waits for the available destination/task UI and enabled exploration action; product assertions and frozen expectations remain unchanged.

No replacement ZIP/backend archive is produced by this cleanup. Packaging still requires all release gates against matching bytes. Native Chrome and signed-in Amazon/Cloudflare/GitHub checks remain pending in [the current checklist](../../guides/getting-started.md).

## Embedded access CI regression, October 16, 2026

The ungranted-frame browser check failed consistently because the task-notice guard suppressed all notices during the idle presentation of an active page-exploration session. The worker still identified the denied origin and correctly excluded its controls. Increasing a timeout or changing the locator would not repair the missing UI.

Current frame access now has a separate observation-scoped projection. Its actions remain available before a destination and while planning; stopped, paused, checkpoint, completed and canceled sessions still suppress obsolete prompts. Existing task-owned return, review and visual instructions retain their phase guards. No host-permission, discovery or outcome rule changes.

Applied the project-local [Fixing Accessibility](../../../.codex/skills/fixing-accessibility/SKILL.md) guidance on minimal targeted fixes and reachable actions, and [Baseline UI](../../../.codex/skills/baseline-ui/SKILL.md)'s existing-primitives rule. No new controls or animations were added. The existing browser case now also checks Conversation mode, the exact requested origin, and denial without private-frame discovery. Unit coverage checks pre-goal recovery and terminal-session suppression.

Verification passed: `npm run check` (strict TypeScript, **253 unit tests**, demo/extension/website builds), the full `npm run test:multi-app:browser` suite (**7/7**), and the complete UI regression (**29/29**, 5.7 minutes). Both browser reports bind to the same final extension assets. Frozen corpora, host permissions and release archives are unchanged. Native permission dialogs and signed-in checks remain separate pending work.

## UI startup and interaction CI regressions, October 16, 2026

The two UI logs exposed three races. Late initial `UI_GET` responses could replace a newly typed destination with the stored empty draft; the test then dispatched a native click without checking whether submission was enabled. The widget test clicked cached coordinates with a hardcoded iframe offset. The cookie test sampled a Base UI focus guard before its queued animation-frame transfer back into the dialog.

The controller now protects unsaved edits using local revisions and matching save acknowledgements, ignores older applied snapshots, and discards replies after unmount. It retains session-only storage and the worker's journey ownership. The first Guide/Conversation case explicitly holds initial hydration until after typing, so the old build reliably fails the regression. Submission checks readiness and retained text; widget Pause uses Playwright's real iframe locator click. Cookie keyboard checks wait for initial focus and each expected control through a complete wrap, rather than sampling a temporary focus guard.

Applied the project-local [Fixing Accessibility](../../../.codex/skills/fixing-accessibility/SKILL.md) guidance on focus containment/return and targeted fixes, plus [Baseline UI](../../../.codex/skills/baseline-ui/SKILL.md)'s existing-primitives rule. Existing Base UI focus management is preserved. Navigation outcomes, private storage checks, frame-command validation and the 29-case UI gate remain intact; no retry or timeout threshold was increased.

Verification passed: the four affected cases each passed three consecutive runs (**12/12**), followed by `npm run check` (strict TypeScript, **253 unit tests**, demo/extension/website builds), the complete `npm run test:ui` regression (**29/29**, 4.3 minutes), and `npm run test:multi-app:browser` (**7/7**). Both browser reports match the same 272 final extension assets; the UI gate also records matching website bytes. Frozen inputs and release archives are unchanged. GitHub CI has not been rerun from this workspace. Native Chrome and screen-reader checks remain separate pending work.

## Pre-commit full-suite audit, October 16, 2026

Running the broader CI test sequence exposed a distinct notice-filter regression: the worker intentionally pauses an unfinished task at an expected cross-origin popup or authentication redirect, but the UI hid its explicit continuation action along with ordinary paused-task notices. The filter now preserves that action only when an expected origin is retained and the request remains active. Explicitly paused, stopped, completed and canceled requests still hide obsolete notices; paused frame-access prompts remain suppressed. The worker's origin, URL and user-approval checks are unchanged.

Diagnostics-export failures were isolated to the headless browser download path. Pregranting automatic downloads in the disposable profile resolved a minimal reproduction but did not make both real export sequences reliable. The test adapter now explicitly sets native download behavior for the foreground extension tab's actual CDP browser context and disposable download directory, with download events enabled. Both report paths then passed after the preceding navigation scenarios at desktop and narrow widths (22/22). The original Blob exporter, installed-browser settings and extension permissions are unchanged; experimental exporter changes and probes were removed. Browser coverage focuses the actual export button and uses Enter or pointer input. A test-only adapter retains the actual website-context snapshot while the headless extension tab is foregrounded, including in-flight context reads. Journey commands, native download events and exported-content privacy assertions remain real. Native Chrome sidebar and automatic-download prompts are not validated by this adapter. A focused unit regression also covers the paused handoff and terminal-state exclusions.

The live acceptance runner also assumed every final outcome must increment the interaction counter. On real pages, fresh semantic evidence can establish the requested preference or section before that receipt arrives. The runner now recognizes that existing path only for the same request and journey, both completed, with the independent DOM oracle returning true. Focus and menu opening retain the exact one-step receipt requirement. Six focused tests cover false outcomes, wrong identities, inactive states and unsupported completion sources.

Earth and Mathematics exposed another edge case: a large active language dialog can fill the bounded 600-control projection and omit its original opener. Automatic replanning then targeted the dialog's search field after a verified reveal. The core now retains the choice handoff only for a partial projection with a missing opener and a visible, ordinary, expanded combobox inside a matching named dialog, bound to the same task and origin. A present closed opener prevents the fallback. A regression fails on the old implementation and covers closed, hidden, occluded, unrelated, foreign-origin and wrong-task observations. Frozen NLP and Wikipedia inputs are unchanged.

The narrow live run then exposed automatic-plan installation losing a stale-scan rejection: its internal refresh could advance the scan after the caller's revision check, without a structural change to trigger another plan. The planner now reschedules only that explicitly rejected result for the same running task, without replacing newer plans or resuming an ended task. A real `PageCoach` regression advances the scan during installation; it fails on the old implementation and passes with the fix. Acceptance state checks also use the harness's existing snapshot-only mode instead of reopening panel disclosures on each poll. The complete UI suite retains its own interaction and layout checks.

A repeated narrow run exposed the product-side part of that picker race: the incremental index can temporarily omit a popup's opener before the popup field is indexed. The coach discarded a real pending click as stale, then guided the popup's search field. It now retains that pending interaction only for an incomplete projection with a connected, obscured or omitted opener. A uniquely fresh, visible, ordinary expanded combobox in a matching named dialog can verify only the same-task, same-origin, same-frame menu reveal. A requested option remains unresolved. Nine real-coach regressions reproduce the indexing gap; the positive case fails on the old code, and unrelated, collapsed, occluded, consequential, stale-task, desired-value and foreign-frame observations cannot establish verification.

The live-language checks and acceptance picker runner also clicked while Tholi was still instructing a scroll past Wikipedia's fundraising banner. Playwright's implicit scrolling let the click race the refreshed target binding. They now follow the scroll instruction and require the same signature, fresh in-viewport evidence and guiding state before interacting. Earth's trace separately showed a correct verified choice handoff, while copying its full 600-control snapshot across Playwright's boundary exhausted a status poll. Acceptance polling now projects only worker-owned progress fields; full observations are still read for target assertions. Picker handoffs retain exact verified-step checks; independent outcome, timeout and foreign-origin checks remain unchanged.

The final live Ada Lovelace run exposed another full-snapshot polling failure (`Unexpected end of JSON input` at the automation boundary). The browser trace already contained a running session, one verified step and a completed text-size goal. The generic live test now polls only the worker-owned phase instead of reopening disclosures and serializing the entire discovered page on every sample. Its full target, retained-memory and outcome assertions remain intact.

Applied project-local [Fixing Accessibility](../../../.codex/skills/fixing-accessibility/SKILL.md) guidance on reachable actions and targeted fixes, and [Baseline UI](../../../.codex/skills/baseline-ui/SKILL.md)'s existing-primitives rule. No test retry, timeout, frozen input or acceptance threshold was relaxed. Final full-suite verification completed October 17, 2026.

All **12 CI commands** pass locally: `check` (strict TypeScript, **271 core tests**, demo/extension/website builds), `test:nlp` (**11**), `test:multi-app` (**17**), `test:vision` (**4**), `test:e2e` (**90**), `test:nlp:browser` (**12**), `test:multi-app:browser` (**7**), `test:continuity:browser` (**3**), `test:reliability:browser` (**2**), `test:ui` (**29**), `test:live:wikipedia` (**16**) and `test:acceptance` (**14**). API builds also pass. This is **476 unique automated tests**; focused development runs and reruns are not counted twice. The live suite was rerun in full after the two harness fixes, followed by the complete acceptance matrix.

The acceptance report covers **116 declared scenarios**: 60 live, 30 controlled fixtures and 26 authored cases. It records 70/70 correct live targets, 70/70 correct live verifications and 60/60 supported live completions, with no false success, navigator-driven website actions or secret leaks. Fixture passes remain separate from real-site passes. Frozen input files, thresholds and release archives are unchanged.

All **11 generated gate reports** are fresh for their latest successful command and bind to the same **272 final extension assets**. Website checks also match the 37 built website files, website source and entry HTML; applicable runtime reports match the final API build. The local command history and byte comparison are recorded in `output/qa/precommit-test-run.json` and `output/qa/precommit-verification.json`.

GitHub CI has not been rerun from this workspace. Native Chrome docking, host/automatic-download permission dialogs, screen-reader and signed-in checks remain pending. No commit, tag, replacement extension ZIP or backend archive was created.
