# Tholi

Tholi guides you through live website controls while retaining your destination across menus, dialogs, page changes and authentication. You perform website clicks, typing and submissions. Tholi can scroll a freshly bound target into view and highlight it.

## Install and run

Use Node **24.19.x**.

```sh
npm ci
npm run build:extension
```

The build fetches and verifies the pinned MiniLM and English Tesseract assets automatically. Models are packaged locally; the installed extension requires no runtime model downloads or backend.

1. Open `chrome://extensions`, enable Developer mode, select **Load unpacked**, and choose `dist/extension`.
2. Open an HTTP/HTTPS website and click the Tholi toolbar icon.
3. Enter a destination, such as **Help me cancel my Amazon Prime membership**, and select **Guide me**. Approve access to that website if Chrome requests it.
4. Follow the current instruction and highlight. Login and two-factor verification retain the request. Pause retains it; Stop cancels it.

After rebuilding, select **Reload** in `chrome://extensions` and refresh the website tab. For permission recovery and native checks, see [Chrome setup and verification](docs/chrome-handoff.md).

Guide and Conversation share the same journey. Use settings to choose a movable/resizable widget or reveal Advanced controls. Route details and saved journeys are expandable; backend credentials remain in the sidebar. The controlled Northstar demo remains available with `npm run dev:demo` at `http://127.0.0.1:5173`.

Run `npm run dev:web` for the local Tholi website at **http://127.0.0.1:5174**. It includes real extension screenshots, a packaged-preview download, setup instructions, and mock accounts/onboarding. No hosting, real authentication, or account requirement is added. See [UI setup, motion, and verification](docs/tholi-ui.md) and [screenshot sources and regeneration](docs/product-screenshots.md).

## What currently works

The default English NLP pipeline combines Compromise, BM25 and packaged CPU-only MiniLM. It supports requests up to 1,000 characters, up to three ordered tasks, exclusions, contextual references and grounded clarification. A similarity score never proves completion. Finding a search box does not complete a search for an article.

Incremental discovery handles rendered semantic/custom controls, open shadow roots and authorized frames. It retains up to 5,000 session controls and projects at most 600 per planning operation. Mounted targets outside the viewport can be scrolled into view; missing or unmounted content does not prove a route is absent.

Journeys retain their objective through supported handoffs, preserve unfinished tasks for resumption, and rebind predictions against each fresh screen. Guides describe semantic milestones for Cloudflare, GitHub, Jira Cloud, YouTube, Netflix and Amazon. General live discovery also works on other ordinary HTTP/HTTPS sites. These guides are not trained website models or proof that every signed-in workflow works.

Tesseract OCR runs locally when refreshed discovery lacks an eligible next step or confidence is below 0.60. It masks editable fields and all iframe pixels. OCR-only targets are unverified visual suggestions; they cannot prove an action's effect or completion. Closed shadow roots, icon-only/canvas controls without recognizable text, unseen screens and native file pickers remain limitations.

**PaddleOCR is an unfinished experiment and is excluded from normal builds.** To evaluate its pinned assets and CSP adaptation, use `npm run build:extension:experimental:paddle`, then `npm run test:reliability:browser`. This overwrites `dist/extension` with the experimental variant. Run the normal build again to restore Tesseract-only assets. The prior Paddle startup test failed; it has not passed promotion gates.

Native Chrome permission/accessibility checks and signed-in Amazon, Cloudflare and GitHub checks remain pending. Fixture passes establish fixture behavior, not reliable completion on every website. See [the cleanup record](docs/maintenance.md) and [archived v0.9.1 validation](docs/v0.9.1-validation.md).

The current **0.10.1** source build adds an anchored composer, distinct Guide/Conversation layouts, a stateful Wayfinder, and a widget launcher that retains the task. The local website uses the same guidance components for its practice tasks. See the [UI audit and project-local skills](docs/ui-audit-redesign.md), [frontend architecture](docs/frontend-architecture.md), and [the dashboard fix](docs/dashboard-navigation.md). The website download remains the gated 0.10.0 archive until a newer release is packaged.

## Architecture and privacy

| Component                                | Responsibility                                                                                   |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `packages/navigation-core`               | Shared contracts, task queues, workflow context, recovery and planning orchestration             |
| `packages/nlp`                           | Compromise interpretation, lexical/semantic retrieval and bounded embedding caches               |
| `packages/page-discovery` / `page-model` | Incremental discovery, accessible structure, fresh bindings and observation contracts            |
| `packages/goal-planner`                  | Grounded targets, observed routes, return routing and journey checkpoints                        |
| `packages/site-memory`                   | Browser IndexedDB knowledge, parameterized saved routes and derived indexes                      |
| `packages/vision`                        | Recognition, bounded queues, visual evidence and backend fallback                                |
| `packages/ui`                            | Shared presentation states, guidance components, tokens, and motion                              |
| `apps/extension`                         | Permissions, session lifecycle, worker inference, scrolling, highlights and outcome verification |
| `apps/api`                               | Optional authenticated Fastify/SQLite adapter with inference outside the event loop              |
| `apps/web`                               | Local product website, verified downloads, and mock onboarding                                   |

The browser remains authoritative. Reusable interface semantics are persisted locally; private entity names, supplied values and authenticated status remain session-only. Field values, raw HTML and screenshots are not stored. Forget/Clear delete learned knowledge. See [privacy](docs/privacy.md) and [security](docs/security.md).

The optional backend is not needed to use NLP or OCR. See [API setup](docs/api-setup.md). Experimental Chrome LLM support is also optional and separate from MiniLM; enabling it may download Chrome's own model.

## Development and validation

Run `npm run check` for strict TypeScript checks, unit tests and builds. Install test Chromium once with `npx playwright install chromium`. [CONTRIBUTING.md](CONTRIBUTING.md) lists focused and release suites, frozen corpora and packaging requirements.

`npm run package:extension` and `npm run package:api` require passing reports for the exact build bytes. Existing archives are immutable. Rebuilding invalidates earlier build-specific reports; historical validation does not certify a cleaned build.

Start with the [documentation index](docs/README.md) for current architecture, lifecycle, troubleshooting and historical release evidence.
