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

No replacement ZIP/backend archive is produced by this cleanup. Packaging still requires all release gates against matching bytes. Native Chrome and signed-in Amazon/Cloudflare/GitHub checks remain pending in [the current checklist](chrome-handoff.md).

## Embedded access CI regression, October 16, 2026

The ungranted-frame browser check failed consistently because the task-notice guard suppressed all notices during the idle presentation of an active page-exploration session. The worker still identified the denied origin and correctly excluded its controls. Increasing a timeout or changing the locator would not repair the missing UI.

Current frame access now has a separate observation-scoped projection. Its actions remain available before a destination and while planning; stopped, paused, checkpoint, completed and canceled sessions still suppress obsolete prompts. Existing task-owned return, review and visual instructions retain their phase guards. No host-permission, discovery or outcome rule changes.

Applied the project-local [Fixing Accessibility](../.codex/skills/fixing-accessibility/SKILL.md) guidance on minimal targeted fixes and reachable actions, and [Baseline UI](../.codex/skills/baseline-ui/SKILL.md)'s existing-primitives rule. No new controls or animations were added. The existing browser case now also checks Conversation mode, the exact requested origin, and denial without private-frame discovery. Unit coverage checks pre-goal recovery and terminal-session suppression.

Verification passed: `npm run check` (strict TypeScript, **253 unit tests**, demo/extension/website builds), the full `npm run test:multi-app:browser` suite (**7/7**), and the complete UI regression (**29/29**, 5.7 minutes). Both browser reports bind to the same final extension assets. Frozen corpora, host permissions and release archives are unchanged. Native permission dialogs and signed-in checks remain separate pending work.
