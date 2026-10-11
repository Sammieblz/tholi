# Internet Navigator

A local-first Chrome navigation coach. It discovers the live page, builds routes from semantic controls and observed transitions, and remembers site structure in the user's browser. You make every click.

## Run it

1. Run `npm install`, then `npm run build:extension`.
2. Open `chrome://extensions`, enable Developer mode, and load unpacked `dist/extension`. After an update, Reload the extension and refresh the website tab.
3. Open a website and click the Navigator toolbar icon. Choose **Navigate this website**, then **Start navigation**. Chrome may request access to this specific website.
4. Describe a goal, such as **make text larger**, **switch to dark mode**, or **find references**, and choose **Find a route**. Alternatively, filter the discovered controls and choose one to highlight.
5. Follow the highlight yourself. Navigator rescans after changes and verifies each expected result. Pause suspends observation; Stop ends it.

Wikipedia is the live case study, with no article allowlist, Wikipedia DOM selectors, or fixed References task. Site access already covers English Wikipedia and local development hosts. Other HTTP/HTTPS websites use an optional per-site grant. Moving to a different origin ends the session; start there explicitly.

**Local site memory and AI** shows stored page/layout/transition counts, provides Forget this website and Clear all site memory, and offers optional on-device AI. Chrome's Prompt API requires a compatible Chrome installation, hardware and model download. The navigator works with semantic matching when AI is unavailable. No remote model endpoint or API key is required.

For the controlled Northstar demo, run `npm run dev:demo` and open `http://127.0.0.1:5173`. Its two authored regression tasks remain available: cancellation confirmation (final hard stop) and read-only billing details.

## Architecture

- `packages/page-discovery`: generic rendered DOM/open-shadow-root discovery, semantic labels and relationships, ephemeral control IDs, fresh element bindings.
- `packages/page-model`: validated observations, goal plans and evidence contracts.
- `packages/goal-planner`: goal matching, menu reveal steps, ambiguity rejection and routes through observed site transitions.
- `packages/site-memory`: extension-owned IndexedDB persistence, versioned observations, invalidation, retention and a replaceable storage interface.
- `apps/extension/src/page-coach.ts`: passive guidance and verification; no clicking, filling or automatic scrolling.
- `apps/extension/src/local-model.ts`: optional Chrome on-device model, structured control-ID output, cancellation and validation.
- Existing route engine/registry, browser adapter and demo routes support controlled authored regression cases.

Memory stores sanitized control metadata, page/layout fingerprints and inferred/observed transitions. It excludes form values, raw HTML, coordinates and document control IDs. URL queries are excluded from stored paths. Limits: 50 sites, 100 pages and 30 layout templates per site, 5,000 control records and 400 transitions per site, 90-day retention checked during reads/writes. Closed menus are distinct from removed controls. Partial scans never prove removal.

## Verification and current limits

Run `npm run check` for TypeScript, unit tests and builds; `npm run test:e2e` for production-extension browser fixtures and demo regressions; and `npm run test:live:wikipedia` for live Wikipedia goals at wide/compact widths. Install Chromium once with `npx playwright install chromium`. Tests use the production manifest unchanged. Exact article URLs belong to the test fixtures only. QA artifacts are written under `output/qa`.

The scanner retains up to 600 controls per observation and reports partial scans on larger pages. It prioritizes interface controls, navigation and sections over dense body links. Discovery covers the top document and open shadow roots; cross-origin frames, closed shadow roots and canvas-only controls require further adapters. Unlabeled controls and uncertain goals need manual selection or a model interpretation. Semantic fallback currently targets English goal phrasing. Unknown workflows are learned progressively through user navigation; a scan does not establish every route on the entire site. Risk classification is heuristic and is not a security audit.

See [architecture](docs/live-navigation.md), [privacy](docs/privacy.md), [security](docs/security.md), and [build evidence](docs/build-evidence.md). Remaining MVP acceptance work: https://github.com/Sammieblz/web-navigator/issues/1.
