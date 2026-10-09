# Internet Navigator

A local-first Chrome navigation coach. You click; Navigator observes semantic page state, guides the next step, verifies transitions, and stops before consequential actions.

## Development

Requires Node.js 20+ and Chrome 120+.

1. Run npm install.
2. Run npm run dev:demo. Open http://127.0.0.1:5173.
3. Run npm run build:extension.
4. Open chrome://extensions, enable Developer mode, and Load unpacked: dist/extension.
5. On the demo tab, click the Internet Navigator toolbar icon. Choose a task in the side panel, then Start navigation.
6. Click the highlighted site controls. The cancellation task stops at final confirmation; the billing task completes when billing details are visible.

Run npm run check for type checking, core/browser fixture tests and production builds. Run npx playwright install chromium once, then npm run test:e2e for the headless extension integration suite. The harness uses the production manifest unchanged. This development build has host access only to 127.0.0.1 and localhost; route execution is still restricted to port 5173 and begins only after Start. dist/demo is a static demo build; the bundled route currently allows only localhost/127.0.0.1:5173.

## Prototype scope

Version 0.3.0 supports two tasks on the controlled Northstar demo: reach cancellation confirmation and find billing details. The task chooser shows routes for the active website, previews their steps, and locks the chosen route/version for the session. Stop before switching tasks. Live websites, beta acceptance metrics, optional AI, remote route packs and desktop adapters are not implemented or verified. Do not present this as the complete MVP.

The navigation core contains no DOM/Chrome calls. The browser adapter supplies normalized UI state and semantic targets. Routes are declarative, validated and bundled. No backend, accounts, cookie permission, all-sites permission, model calls or automatic clicks. Development host access is restricted to 127.0.0.1 and localhost.

Full document navigation/reload stops the session; restart explicitly on the new screen. SPA updates are observed within the started session. Login pauses observation; complete demo sign-in manually and Resume.

## Demo scenarios

Use Demo scenarios at the bottom left. Retention modal defaults on. Try:

- Normal path: Account → Billing → Manage subscription → Cancel subscription → Continue cancellation → final hard stop.
- Wrong turn: open Profile during guidance; Navigator routes back to Account.
- Alternate label: enable Alternate label before the billing screen.
- Delayed render: next screen appears after 1.2 seconds; no blind step advancement.
- Login checkpoint: enable before starting from Home. Complete sign-in manually, then Resume.
- Ambiguous duplicate: enable at Billing; guidance stops instead of guessing.
- Unknown screen: navigator stops; reset and Start to begin again.

Local route issue reports export a JSON file with category/route/version/state/status and no page field values. Under Local route tools, enable Show route debug inspector to inspect detected states, candidate scores and rejection reasons, expected/observed transitions and session history. Export diagnostics downloads a local JSON report containing fixed evidence labels and temporary control IDs, without page text, URLs or field values. Candidate output is capped at 50 controls and transition history at 30 entries.

## Structure

- apps/extension: MV3 service worker, isolated content script and React side panel.
- apps/demo-saas: controlled subscription demo.
- packages/route-schema, route-engine, shared-types: platform-neutral route/state contracts.
- packages/browser-adapter, semantic-locator, state-localizer: semantic observations/scoring.
- packages/safety-policy, privacy-redaction, overlay-ui: boundaries and passive guidance.
- packages/route-registry: validated route lookup and pinned-session restoration.
- routes/demo: authored cancellation and billing routes.
- tests: safety and navigation fixtures.

Build plan and remaining work: https://github.com/Sammieblz/web-navigator/issues/1.

## Reload after updating

Reload Internet Navigator at chrome://extensions, then refresh the Northstar demo tab to replace its content script. Reopen the extension panel and choose a task. Route authoring notes: [docs/route-registry.md](docs/route-registry.md).
