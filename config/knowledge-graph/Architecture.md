---
title: Tholi architecture and evidence tour
tags: [tholi, architecture, ownership, privacy, knowledge-graph]
source_version: 0.10.1
study_date: 2026-10-19
---

# Tholi architecture and evidence tour

Tholi is a local website guide. A person supplies a destination, Tholi interprets it against a current website observation, and the person performs the website actions. The extension checks the resulting state before recording progress. Its defining contract is that a click, an attractive animation, a model proposal, or a plausible route does not establish arrival.

This tour covers all 13 files under `docs/architecture`, plus `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md`, and `docs/README.md`. Important ownership and privacy claims were cross-checked against the actual runtime, schema, discovery, inference, practice, and storage implementations. It is a repository study, not a newly performed browser acceptance or security audit.

## The ownership map

| Owner | Owns | Main evidence |
| --- | --- | --- |
| Background worker | One pinned session, journey coordination, trusted session restoration, permissions/lifecycle routing, persistent memory, frame coordination, vision orchestration | `apps/extension/src/background/worker-runtime.ts`, `session-service.ts`, `journey-service.ts`, `message-router.ts` |
| Content runtime | Live observation, element binding, PageCoach orchestration, frame-local guidance, plan lifecycle, outcome checking | `apps/extension/src/content/runtime.ts`, `page-coach.ts`, `outcome-verification.ts`, `plan-lifecycle.ts` |
| Navigation core | Validated requests, interpretation/retrieval/planning orchestration, task queue, workflows, bounded recovery/return routing | `packages/navigation-core/index.ts`, `contracts.ts`, `queue.ts`, `workflows.ts`, `continuity.ts` |
| NLP | English interpretation, lexical retrieval, embeddings, derived semantic caches | `packages/nlp/interpret.ts`, `retrieval.ts`, `model.ts`, `canonical.ts` |
| Discovery and page model | Current controls and signatures, structural context, availability/risk, frame/document references, observation contracts | `packages/page-discovery`, `packages/page-model/index.ts` |
| Shared UI | Guide/Conversation, composer, route presentation, attention, Wayfinder, responsive priority, tokens and easing | `packages/ui/guidance.tsx`, `presentation.ts`, `guidance/GuidanceApp.tsx` |
| Website practice | Controlled sample state and actions, isolated shared product presentation, sample verification | `apps/web/src/features/demo/practice.ts`, `usePracticeAdapter.ts`, `PracticeWorkspace.tsx` |
| Optional API | Explicitly connected reusable-knowledge mirror, storage port, off-event-loop inference, versioned transport | `apps/api/src/server.ts`, `storage.ts`, `inference.ts` |

These are authority boundaries. Shared UI receives typed presentation and callbacks; it cannot acquire browser permissions or announce a real outcome independently. The website practice never acquires the production worker's journey. Changing from sidebar to widget never creates a second task owner.

The worker implementation makes the single-owner rule concrete: `worker-runtime.ts` declares one `session`, restores it from `navigatorSession`, passes live getters/setters into services, and serializes operations through `enqueue`. Its service composition is deliberately different from separate caches that might drift apart. The content coach can keep observing an authorized session while the MV3 worker sleeps.

## From a sentence to verified progress

1. **Activate explicitly.** Opening the panel does not start discovery. Submitting Guide me or explicitly exploring the page does. The current HTTP/HTTPS origin must have access; adding a fixture route does not grant it. `site-access.ts` reads the active tab inside the actual user gesture rather than trusting a previously polled panel tab.
2. **Observe bounded structure.** Incremental discovery scans semantic controls, named custom candidates, open shadow roots, and authorized frames. It prioritizes active menus/dialogs and structural navigation. The scheduler may keep 5,000 controls in the session, while planning uses projections of at most 600. Saturation and omissions remain evidence limitations, not proof that a route is absent.
3. **Interpret the complete request.** Compromise handles the entire validated English sentence, preserving task order, negation, corrections, exclusions, desired values, and compatible references. Limits are 1,000 characters and three explicit tasks. An unresolved pronoun requires an explicit target.
4. **Retrieve and plan.** BM25 and normalized mean-pooled MiniLM vectors rank sanitized semantic metadata. The shared core combines that retrieval with current observations, observed routes, reusable site memory, semantic workflow milestones, and the retained objective. Similarity cannot override scope, risk, current eligibility, or outcome predicates.
5. **Bind again before guidance.** Plans identify current control IDs, but guidance still needs the actual current eligible element with a matching signature. Recycled elements, changed meaning, stale documents, hidden controls, or changed revisions invalidate old proposals. A future route step remains a prediction until freshly bound.
6. **Let the person act.** Tholi may highlight and scroll a fresh target into view. The person clicks, types, authenticates, reviews consequential actions, and submits. User input cancels pending automatic scrolling.
7. **Wait for the expected result.** Interaction enters a waiting or verifying state. Checked/selected values, declared expansion, actual destination, created item, or relevant workflow status must match the requested outcome. An unrelated toast or unchanged result leaves the task incomplete.
8. **Record evidence and continue.** Verified transitions feed the journey and reusable structural memory. Queue progression follows task outcomes; Pause retains the queue, Skip records a skip, and Stop cancels it. Search-box focus is intermediate: the query survives until the matching result actually arrives.

`outcome-verification.ts` demonstrates a useful nuance: a verified menu expansion may complete an explicitly requested menu-opening task. It cannot establish a broader destination whose remaining selection or outcome has not happened. Workflow focus similarly hands input back to the person and replans without claiming that entered values were verified.

The graph's live evidence-cycle hyperedge ties discovery, observation, planning, fresh binding, verification, and reusable memory together. These are parts of one feedback loop, not interchangeable forms of proof.

## Structural context and the optional browser model

Heading ancestry and named navigation/main/toolbar/form/dialog regions disambiguate repeated controls such as Edit. The implementation uses generic HTML/ARIA and each control's owning document or open shadow root; it does not need an article-name or site-selector exception. A footer must not inherit an unrelated article heading. Extra nearest-section qualifiers reduce rank, so a request for Plot can distinguish Plot from Plot inspirations.

Structural changes affect signatures and scan revisions, invalidate pending guidance, and update sanitized browser-local knowledge. Raw geometry and editable values never become model input. Viewport placement is only a transient categorical hint and is omitted from saved site knowledge.

The optional Chrome Prompt API receives retrieved evidence rather than the first controls in DOM order. Its view keeps discovered openers and is capped at 96 controls and roughly 24,000 characters. A control never discovered by the collector remains unavailable. Current page language, scan completeness, omissions, scope, popup type, states, reveal relationships, and sanitized paths provide context without granting authority.

Every request clones a pristine model session, supports cancellation, has a 30-second timeout, and destroys the clone. Follow-ups carry the original objective, routing preference, and up to eight verified interactions as structured context. Old model responses and raw pages do not become trusted through accumulated conversational history.

The output is structured intent plus current IDs. The independent planner validates a unique eligible route, proposed operation against control kind, preserved exclusions and scope, and user-sourced section qualifiers. Clear original matches take precedence over conflicting proposals. After a menu replaces its children, the goal's accepted purpose is replanned against fresh IDs. A new goal cannot inherit the old interpretation.

Evidence: `docs/architecture/page-context.md`, `packages/page-discovery/structure.ts`, `packages/goal-planner/model-context.ts`, `apps/extension/src/inference/browser-language-model.ts`, `packages/goal-planner/index.ts`.

## Session continuity is separate from presentation

The pinned identity includes session UUID, tab, document, route/version or live protocol, and origin. Live reattachment can survive same-origin document changes with fresh controls; loading clears actionable bindings. Expected authentication or associated popup/tab handoffs retain the objective but must reach the actual permitted destination before repinning. An unrelated navigation pauses a retained objective. Association with a redirect never proves that authentication succeeded.

`packages/route-registry/session.ts` validates restoration, pins route/version, rejects duplicate live IDs or selected IDs outside eligible visible controls, and rejects generic live payloads on authored sessions. A session remains locked until stopped, terminal, or completed. Guide/Get Page/Resume from a different active tab cannot silently move guidance there. Closing the pinned tab removes the active session.

Pause removes discovery and pending guidance; Resume requires a new observation. Stop prevents reattachment. Ordinary waiting or authentication does not fabricate success or expire the destination simply because the website is slow.

Expanded, minimized, and hidden visibility are a separate trusted record. Minimizing leaves a launcher; hiding removes the launcher. Both suppress visual overlays and automatic scrolling while authorized verification can continue. Hidden state survives worker restarts and document changes until explicit restoration. A launcher conceals the private destination. Restoration requests fresh evidence, and docking must succeed before an expanded widget is removed.

The `ui-transport.ts` implementation checks exact extension panel URLs or widget grants tied to the session's top document, iframe document, frame ID, and nonce. Storage hydration and async transport do not weaken these checks. Draft restoration separately protects edit revisions until the matching `UI_SAVE` acknowledgement, so a slow snapshot cannot overwrite current typing.

Lifecycle documentation describes tests that stop the real service worker in running, waiting, and paused states. A changed test-only epoch establishes restart because Playwright may retain the Worker wrapper. These are reported repository test contracts, not tests rerun for this knowledge graph.

## Private context and reusable knowledge are different stores

| Data | Lifetime and destination |
| --- | --- |
| Active goals, supplied values, entity bindings, unfinished journeys, task navigation ledger | Trusted `chrome.storage.session`; browser-session private context |
| Composer draft and up to 80 conversation messages | Trusted extension-session presentation storage; not website/cloud synchronization |
| Presentation preferences and widget bounds | Local extension preferences |
| Sanitized labels/roles/structure, sanitized paths without query text, observed transitions, parameterized saved routes | IndexedDB v5 reusable knowledge |
| Derived embeddings | Rebuildable cache keyed by SHA-256 and pinned model revision; private entity vectors stay session-only |
| Screenshots, raw HTML, private OCR text, image coordinates, ephemeral control/document IDs | Excluded from reusable persistent knowledge |
| Website mock account | Browser-session name/email/onboarding only; no persisted or transmitted password |

Discovery excludes input/textarea values, passwords, OTPs, editable contents, and full page HTML. Sanitization is heuristic: it cannot promise to recognize every private label on every website. The privacy implementation additionally reduces recognized private-platform observations to known interface vocabulary and parameterizes saved tasks. `site-memory/index.ts` strips transient IDs, reveal IDs, viewport placement, and navigation keys while merging reusable observations.

Memory limits are explicit: 50 sites; per site 100 latest pages, 120 state snapshots, 30 templates, and 400 transitions; 100 reusable saved routes; global 10,000-entry derived cache. Records expire after 90 days when accessed. Original knowledge survives migrations while incompatible derived indexes rebuild.

Forget removes a site and routes crossing it; Clear removes knowledge, routes, and indexes. Observation stops before deletion. A disconnected or failed backend deletion is reported for retry rather than silently treated as complete. Resetting the current conversation/task is a different operation from deleting reusable website knowledge. An ephemeral URL hash can include query information for destination comparison without storing query text; the docs correctly warn that hashing is not cryptographic anonymization.

## Local inference and the restricted vision fallback

The default path uses packaged q8 MiniLM ONNX weights, packaged WASM, and one CPU thread in a worker owned by a Chrome offscreen document. `MiniLM.embed` explicitly disables remote model fetching, uses local-only files, mean pooling and normalization, checks vector dimensions/finite values, and checks cancellation between per-text calls. Foreground plans can preempt suggestion work between calls; Stop aborts pending work and closes resources; idle resources unload after two minutes.

Tesseract OCR is a separate local worker used when DOM evidence is insufficient. Viewport capture requires the active authorized HTTP/HTTPS tab and separate Chrome screenshot access. Before capture, Tholi hides its surfaces and masks editable controls including open shadow roots and every iframe rectangle. Frame DOM permission never implies safe frame pixels: the source comment explains that permission alone does not provide trustworthy field-mask geometry inside a frame.

Visual suggestions are temporary, unknown-effect guidance. Current DOM bindings win. Scrolling, resizing, mutation, input, and other viewport changes invalidate suggestions, and `showVisual` rejects changed revisions or captures older than 15 seconds. OCR text, a changed image, or capture access cannot complete a task or authorize interactions.

PaddleOCR/OpenCV remains explicit experimental-build material. The normal build excludes inactive experimental assets; failed startup or promotion gates must not be described as default-engine validation. Third-party notices retain model revisions, upstream licenses, adapted Playwright hashes, and Paddle/OpenCV adaptation provenance.

## Optional API and website boundaries

The optional Fastify service uses the same navigation core with inference outside its event loop and SQLite behind a storage port. It is a single-owner reusable-knowledge mirror reached only by explicit connection. The browser stays authoritative and older/unavailable services fall back locally. v1 compatibility is retained; v2 adds workflow/visual contracts and capability negotiation.

Loopback binding, a bearer token, explicit Chrome-extension-origin CORS, and HTTPS for remote connections form the API access boundary. Credentials remain in trusted extension contexts. Private session context and OCR payloads are not persisted or included in payload logs. Backend OCR is separately enabled and can receive only temporary masked images under that option.

The website's practice adapter owns sample menu, settings, language selection, saved language, and completion state. Its effect checks actual controlled sample outcomes: opening settings or saving Español. It mounts the real shared guidance presentation within shadow isolation. This demonstrates product interaction without establishing production website reliability.

Website routing, marketing, docs, legal, account, onboarding, downloads, and preferences each retain feature-local ownership. The docs registry explicitly imports selected current Markdown, keeps stable public slugs and legacy reference aliases, performs bounded local search, and renders safe GFM without raw HTML or remote image execution. Historical records remain repository links. Legal drafts have their own owner configuration and are not replaced by developer privacy contracts.

The first-party `tholi_consent` choice lasts 180 days. Optional `tholi_theme` storage requires appearance consent; essential-only or withdrawal deletes that cookie, while in-memory appearance still works. Cookies are host-only, `Path=/`, `SameSite=Lax`, and Secure on HTTPS. Silence grants no optional storage.

Production analytics has no configured provider. A future provider would require specific disclosure and fresh matching consent. The prepared allowlist permits only public page categories, download clicks, and two fixed sample task identifiers, excluding requests, transcripts, mock-account data, docs searches, and extension observations.

## Controlled routes, build contracts, and evidence limits

The two Northstar regression routes are authored fixtures with unique IDs, pinned versions, exact origins, semantic landmarks and transitions, login checkpoints, terminal irreversible-action boundaries, and visible success predicates. Tied candidates stop. Selectors constrain authored semantic evidence rather than replace it; coordinates only position passive guidance. Their existence does not turn generic discovery into a site-by-site route catalog.

Dynamic `navigator.live` version 1.0.0 is a different mode for HTTP/HTTPS observations and goal plans. Tests may know fixed selectors as independent oracles; product workflows may describe sourced milestones and outcome predicates but must not encode account URLs, fixed selectors, or coordinates.

Stable generated filenames include `worker.js`, `content.js`, `frame-agent.js`, `offscreen.js`, `inference.js`, `ocr-worker.js`, `sidepanel.js`, and `theme-page.js`. Product copy uses Tholi while legacy package names, storage keys, environment variables, and protocol identifiers remain for compatibility. Keep those identities distinct when navigating or refactoring the graph.

`npm run test:ci` is the deterministic PR gate. `npm run test:full` is the complete certification tier required before packaging, against one build and matching final bytes. Historical reports, PR evidence, or independent focused runs do not collectively authorize a release. Packaging must not rebuild afterward or overwrite existing archives. Frozen fixture bytes, splits, hashes, and thresholds remain immutable unless explicitly versioned and independently reviewed; expectations cannot be regenerated from predictions.

Automated evidence covers real-production-manifest Chromium lifecycle, keyboard/focus/live-region checks, independent CDP overlay geometry, multiple zoom levels, and public Wikipedia observations. Native Chrome permission recovery, actual screen-reader speech, signed-in Amazon/Cloudflare/GitHub workflows, and real Gemini Nano quality/availability remain separate pending acceptance. Closed roots, inaccessible icon/canvas controls, native dialogs, unmounted controls, and opaque/unseen screens remain limitations. The graph records these boundaries; it does not clear them.

## Evidence map for further reading

- Product and contribution contracts: `README.md`, `AGENTS.md`, `CONTRIBUTING.md`, `THIRD_PARTY_NOTICES.md`.
- End-to-end behavior: `docs/architecture/navigation.md`, `natural-language.md`, `page-context.md`.
- Trust, continuity and private data: `docs/architecture/security.md`, `privacy.md`, `sessions.md`.
- Controlled fixtures: `docs/architecture/authored-routes.md`, `packages/route-schema/index.ts`, `packages/route-registry/session.ts`.
- Frontend authority and state: `docs/architecture/frontend/README.md`, `extension.md`, `shared-ui.md`, `guidance.md`, `website.md`.
- Existing browser contracts: `tests/browser/extension/core/lifecycle.spec.ts`, `geometry.spec.ts`, `accessibility.spec.ts`, and `tests/browser/live/geometry.spec.ts`.

The accompanying `architecture.json` contains one node per studied document and named semantic concepts. Each explicit relationship records its source sentence and line location with EXTRACTED confidence 1.0. A small number of cross-file conceptual couplings are explicitly INFERRED with lower confidence. Code ownership is attached through verified `evidence_files` rather than invented AST symbol identifiers, allowing the aggregate build to connect concepts to the actual code graph.
