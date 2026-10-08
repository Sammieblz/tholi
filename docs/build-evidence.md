# Controlled demo verification — October 8, 2026

This is the first local prototype checkpoint, not the full MVP acceptance gate.

- TypeScript: passed.
- Unit/fixture regression tests: 18/18 passed.
- Chromium extension integration scenarios: 12/12 passed (six scenarios at 1280×900 and 720×900), using the unmodified version 0.1.1 production manifest.
- Production demo and unpacked MV3 extension builds: passed.
- QA screenshots inspected for demo guidance and side panel; no target-blocking overlay in the tested flow.

Browser scenarios cover explicit start, normal route, verified step count, retention modal, terminal hard stop, manual final action without auto-success, wrong-turn recovery, alternate labels, pause/resume/stop cleanup, login checkpoint/manual resume, synthetic secret exclusion from session storage, ambiguous duplicate stop, unknown-screen stop, delayed DOM with no blind progress, and full navigation interruption.

The initial harness used an added localhost permission, which masked the missing-access failure in regular Chrome. Version 0.1.1 declares access to the two local development hosts and tests the production manifest without modifications. Start resolves the active tab in the last focused Chrome window and distinguishes withheld access from an unsupported site. Native side-panel presentation still requires manual smoke testing.

Artifacts: dist/extension (Load unpacked), dist/demo, and output/qa screenshots. Source and changes currently reside in the local workspace; no commit or push has been made.

## Remaining MVP work

Three live websites/5–8 total routes; full target/state precision and completion-rate sample metrics; selector/context/history scoring extensions; full candidate debug inspector; broader malicious-page/security/accessibility tests; route issue operations and beta distribution. Optional AI remains disabled/unimplemented. Desktop adapters remain deferred.

Run npm run check and npm run test:e2e to reproduce. Read README.md for installation and scenario controls.

## Version 0.1.1 reload

The development extension was rebuilt after fixing local host access and last-focused-window tab lookup. Reload Internet Navigator at chrome://extensions, reopen the panel on the demo tab, and Start. Both localhost aliases passed the regression without a toolbar activeTab grant.
