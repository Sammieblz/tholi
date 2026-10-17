# Session lifecycle verification

Live sessions pin the session token, browser tab, document ID, protocol and origin. Back/Forward and same-document history changes rescan live bindings. Verified progress advances only for an observed expected result; revisiting a page does not repeat a completed step.

## Verification

A user interaction enters `waiting` until the expected focus, selection, expansion, section arrival or destination is observed. Clicks and OCR suggestions cannot establish success. Only the current coach records a destination transition, preventing stale publications or duplicate progress after a document load.

User-facing Pause, Stop, reset, unfinished journeys and return-route behavior are documented once in [continuous journeys](../guides/journeys.md). The interface-specific close, minimize and dock controls are in [Using Tholi](../guides/using-tholi.md).

The MV3 worker restores its pinned state from `chrome.storage.session`. Its content-script coach continues independently through worker suspension. Tests force `ServiceWorker.stopWorker` during running, waiting and paused sessions. A changed test-only global epoch in the worker proves that the execution context restarted; Playwright keeps its Worker wrapper across MV3 restarts, so a wrapper close event is not used as evidence. No production restart hook or mock storage is used.

Presentation visibility is a separate trusted session record. Minimized and hidden states suppress overlays without interrupting authorized verification. Worker restoration validates the current session, tab, document and origin before publishing guidance. See [frontend ownership](frontend/README.md).

The integration suite separately switches away from and closes the pinned tab in all three states. Guide/Get Page/Resume commands from another active tab are rejected, the other page receives no guidance, and closing the pinned tab removes the active session. Stop and Pause can still clear the pinned task from the panel. Persistent site knowledge is independent of active-session storage.

Reproduce with `npm run test:e2e -- lifecycle.spec.ts` and `npm test -- lifecycle.test.ts`. Lifecycle runs once because these state and permission contracts do not depend on viewport width. The full extension suite also covers authored terminal-state teardown, unexpected origin changes, stale documents, and browser restart persistence. These are automated production-manifest Chromium checks; native Chrome permission and accessibility checks remain separate release work.
