# Controlled demo verification — October 8, 2026

This is the first local prototype checkpoint, not the full MVP acceptance gate.

- TypeScript: passed.
- Unit/fixture regression tests: 18/18 passed.
- Chromium extension integration scenarios: 12/12 passed (six scenarios at 1280×900 and 720×900), using the unmodified version 0.1.1 production manifest.
- Production demo and unpacked MV3 extension builds: passed.
- QA screenshots inspected for demo guidance and side panel; no target-blocking overlay in the tested flow.

Browser scenarios cover explicit start, normal route, verified step count, retention modal, terminal hard stop, manual final action without auto-success, wrong-turn recovery, alternate labels, pause/resume/stop cleanup, login checkpoint/manual resume, synthetic secret exclusion from session storage, ambiguous duplicate stop, unknown-screen stop, delayed DOM with no blind progress, and full navigation interruption.

The initial harness used an added localhost permission, which masked the missing-access failure in regular Chrome. Version 0.1.1 declares access to the two local development hosts and tests the production manifest without modifications. Start resolves the active tab in the last focused Chrome window and distinguishes withheld access from an unsupported site. Native side-panel presentation still requires manual smoke testing.

Artifacts: dist/extension (Load unpacked), dist/demo, and output/qa screenshots. This checkpoint was followed by the first user-created commit. Subsequent milestone changes remain in the local workspace.

## Remaining MVP work

Three live websites/5–8 total routes; full target/state precision and completion-rate sample metrics; selector/context/history scoring extensions; full candidate debug inspector; broader malicious-page/security/accessibility tests; route issue operations and beta distribution. Optional AI remains disabled/unimplemented. Desktop adapters remain deferred.

Run npm run check and npm run test:e2e to reproduce. Read README.md for installation and scenario controls.

## Version 0.1.1 reload

The development extension was rebuilt after fixing local host access and last-focused-window tab lookup. Reload Internet Navigator at chrome://extensions, reopen the panel on the demo tab, and Start. Both localhost aliases passed the regression without a toolbar activeTab grant.

## Version 0.2.0 — task selection and pinned sessions

Added a validated bundled route registry and an active-site task chooser. Northstar now offers cancellation guidance and a separate read-only billing-details route. Previews, milestones and terminal instructions come from route metadata. Sessions pin a route ID, exact version, tab and unique session token; switching while active is rejected, and stale content updates cannot overwrite a newer session. Unsupported tabs offer no tasks. Stored sessions with unavailable versions or invalid route state are discarded.

Validation: TypeScript, 27/27 unit tests, production builds and 18/18 Chromium extension checks passed. Browser coverage includes the actual chooser/Start button, both task outcomes, session switching restrictions, stale-update rejection and unsupported tabs at desktop and narrow widths. The production manifest remains restricted to local development hosts. Native Chrome side-panel presentation still needs a manual smoke test.

Reload the extension and refresh the demo tab before trying this version. No live-site coverage or AI was added.
