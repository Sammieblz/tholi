# Internet Navigator

A local-first Chrome navigation coach. It discovers the live page, builds routes from semantic controls and observed transitions, and remembers site structure in the user's browser. You make every click.

## Run it

1. Install Node **24.19.x**, run `npm ci`, `npm run fetch:model`, then `npm run build:extension`.
2. Open `chrome://extensions`, enable Developer mode, and load unpacked `dist/extension`. After an update, Reload the extension and refresh the website tab.
3. Open a website and click the Navigator toolbar icon. Choose **Navigate this website**, then **Allow website access and start** for a new site, or **Start navigation** for a granted site. Chrome requests access to this specific website.
4. Describe a goal, such as **change language to Spanish**, **make text larger**, **find references**, **How to log in**, **create account**, or **Edit**, choose fastest/fewest clicks, then **Find a route**. Alternatively, filter the discovered controls and choose one to highlight.
5. Follow the highlight yourself. Navigator rescans after changes and verifies each expected result. Pause suspends observation; Stop ends it.

Wikipedia remains the live case study, with no article allowlist, Wikipedia DOM selectors, or fixed References task. Site access already covers English Wikipedia and local development hosts. Other HTTP/HTTPS websites use an optional per-site grant. An expected task destination on another origin/tab retains context and offers **Continue task here** with site-specific access. Unrelated navigation pauses a contextual journey until you reconnect it.

**v0.8.0** understands full English requests with Compromise, BM25 and bundled CPU-only MiniLM. Requests support up to 1,000 characters and three ordered tasks, grounded clarification choices, exclusions and compatible references. “Search for Saturn” retains Saturn until a result destination is verified; finding Search alone does not finish it. The extension works offline with no hosted inference bill. Scans preserve heading/footer coverage on dense pages, respect nested clipping and refuse broken section destinations. See [the References/Privacy fixes and validation](docs/v0.7.1-navigation-fixes.md).

**v0.8.0** adds milestone journeys and official-documentation guides for Cloudflare Pages, GitHub, Jira Cloud, YouTube, Netflix and Amazon. It retains named destinations through menus, dialogs, document changes and supported authorization handoffs. Final actions have a manual review stage followed by fresh outcome verification. See [the per-platform capability matrix](docs/v0.8.0-capabilities.md) and [workflow architecture](docs/v0.8.0-architecture.md). Signed-in workflow checks remain pending user-assisted validation.

Navigation is offered on every ordinary HTTP/HTTPS website, including sites without a guide. The `tabs` permission identifies the current website before access is granted; **Allow website access and start** then requests that site's scanning permission. Navigator does not collect browser history or scan every open tab. Reload the unpacked extension and refresh website tabs after upgrading.

**Local site memory and AI** shows knowledge and embedding activity, provides Forget/Clear, and offers an optional private backend plus experimental opt-in Chrome LLM support. MiniLM works without the LLM. See [NLP architecture](docs/nlp-architecture.md), [backend setup](docs/api-setup.md) and [contributing](CONTRIBUTING.md).

Controls now carry nested heading and region context. Optional AI interprets paraphrases into a structured intent grounded in fresh controls, uses goal-ranked context instead of a flat prefix, and replans after menu rerenders. See [page context and intent](docs/page-context.md) for behavior, limits and evaluation scope. OCR remains deferred.

Tasks now retain their destination through menus and screens. The panel shows route estimates, verified progress, predicted upcoming steps and reusable **Saved routes**. Weighted observed-state routing compares fastest and fewest-interaction paths; every saved route revalidates against the current website. See [persistent task routing](docs/task-routing.md). Estimates cover known/predicted steps and are not a guaranteed whole-site shortest path.

Login and account tasks retain context through their entry menus, linked pages and server redirects. Continue task here requests access to the actual redirected host. Navigator guides safe form fields, then stops at credential/submission review; it does not claim that login or account creation succeeded. Unknown routes show an unavailable estimate.

For the controlled Northstar demo, run `npm run dev:demo` and open `http://127.0.0.1:5173`. Its two authored regression tasks remain available: cancellation confirmation (final hard stop) and read-only billing details.

## Architecture

- `packages/navigation-core`: shared validated contracts, interpretation/retrieval/planning orchestration, ordered task queues and storage ports.
- `packages/nlp`: lightweight NLP, lexical ranking, incremental embedding cache and pinned pretrained CPU inference.
- `apps/api`: optional authenticated Fastify/SQLite adapter with inference in a worker thread.

- `packages/page-discovery`: generic rendered DOM/open-shadow-root discovery, semantic labels and relationships, ephemeral control IDs, fresh element bindings.
- `packages/page-model`: validated observations, goal plans and evidence contracts.
- `packages/goal-planner`: goal matching, menu reveal steps, ambiguity rejection and routes through observed site transitions.
- `packages/site-memory`: extension-owned IndexedDB persistence, versioned observations, invalidation, retention and a replaceable storage interface.
- `apps/extension/src/page-coach.ts`: passive guidance and verification; no clicking, filling or automatic scrolling.
- `apps/extension/src/local-model.ts`: optional Chrome on-device model, structured control-ID output, cancellation and validation.
- Existing route engine/registry, browser adapter and demo routes support controlled authored regression cases.

Private applications persist only reusable interface semantics and parameterized routes; unknown item names, supplied values, statuses and their embeddings stay in trusted session memory. IndexedDB v4 preserves Wikipedia knowledge and sanitizes older indexes for the six platform families.

Memory stores sanitized control metadata, page/layout fingerprints and inferred/observed transitions. It excludes form values, raw HTML, coordinates and document control IDs. URL queries are excluded from stored paths. Limits: 50 sites, 100 pages and 30 layout templates per site, 5,000 control records and 400 transitions per site, 90-day retention checked during reads/writes. Closed menus are distinct from removed controls. Partial scans never prove removal.

## Verification and current limits

Run `npm run check` for TypeScript, unit tests and builds; `npm run test:e2e` for production-extension browser fixtures and demo regressions; and `npm run test:live:wikipedia` for live Wikipedia goals at wide/compact widths. Install Chromium once with `npx playwright install chromium`. Tests use the production manifest unchanged. Exact article URLs belong to the test fixtures only. QA artifacts are written under `output/qa`.

The incremental scanner retains up to 5,000 session controls and projects at most 600 controls per planning observation and reports partial scans on larger pages. It prioritizes interface controls, navigation and sections over dense body links. Discovery covers the top document, open shadow roots and authorized frames, with frame-local overlays and selective permission recovery. Closed shadow roots, canvas-only controls and native file pickers remain explicit limitations. Unlabeled controls and uncertain goals need manual selection or a model interpretation. Semantic fallback currently targets English goal phrasing. Unknown workflows are learned progressively through user navigation; a scan does not establish every route on the entire site. Risk classification is heuristic and is not a security audit.

Run `npm run test:acceptance` for the predeclared accuracy matrix and denominator report. After a complete passing evaluation, `npm run package:extension` packages and verifies those exact build bytes, with a SHA256 and provenance file in `output/releases`. Native Chrome handoff remains a separate checklist.

Run `npm run test:multi-app` and `npm run test:multi-app:browser` for the frozen 360-case platform corpus, v2 API/privacy/migration, workflow, frame and dynamic-page performance gates. See [v0.8.0 validation and installation](docs/v0.8.0-validation.md) for measured results and pending native/signed-in checks.

See [v0.7.0 validation and installation](docs/v0.7.0-validation.md), [architecture](docs/live-navigation.md), [diagnostics](docs/live-diagnostics.md), [lifecycle](docs/session-lifecycle.md), [guidance/accessibility](docs/passive-guidance.md), [accuracy benchmark](docs/accuracy-benchmark.md), [Chrome handoff](docs/chrome-handoff.md), [privacy](docs/privacy.md), [security](docs/security.md), and [earlier build evidence](docs/build-evidence.md). Current Wikipedia POC tracker: https://github.com/Sammieblz/web-navigator/issues/1.

### v0.9 continuous journeys and visual assistance

Journeys retain the requested outcome through documents and menus, checkpoint every 25 verified interactions, and keep unfinished tasks under **Resume previous task**. A return route can ask you to close an observed menu, use browser Back, or switch to an associated tab. Navigator checks the new surface before continuing.

English OCR runs offline when refreshed discovery cannot identify an eligible next step or confidence is below 0.60. A dashed visual highlight is an unverified suggestion: review it and make the interaction yourself. Chrome may require clicking the extension icon again to grant screenshot access after navigation. The backend is optional; sending temporary masked images there requires the OCR backend setting.

Setup: `npm ci`, `npm run fetch:model`, `npm run fetch:ocr`, `npm run build:extension`. Reload the unpacked extension from `dist/extension` in `chrome://extensions`, refresh the website, then start navigation. Optional API: `npm run build:api`, `npm run start:api` (see `docs/api-setup.md`).

Verification: `npm run test:vision` and `npm run test:continuity:browser`, alongside the existing NLP, multi-app, Wikipedia and regression gates. See [v0.9 validation](docs/v0.9.0-validation.md). Signed-in Cloudflare/GitHub workflows and native toolbar screenshot permission checks require user-assisted verification; fixture passes do not establish those checks.
