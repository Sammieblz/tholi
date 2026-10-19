---
title: Tholi architecture and evidence tour
tags: [tholi, architecture, ownership, privacy, knowledge-graph]
source_version: 0.11.0
source_revision: 360f710
study_date: 2026-10-19
---

# Tholi architecture and evidence tour

Tholi 0.11.0 is an unreleased local website guide with Chromium and Firefox targets. A person supplies a destination; Tholi interprets current website evidence, proposes a freshly bound next step and independently checks the result. Guide mode leaves actions with the person. A new default-off Assisted navigation setting can open eligible ordinary menus and select an explicitly requested view option. Neither synthetic nor human clicks establish arrival.

This study reads all 14 current architecture documents, the repository overview, contributor instructions, third-party notices and documentation index, and cross-checks changed platform, runtime, inference, assistance and discovery implementations. It compares revision `360f710` with the earlier 0.10.1 map. It is source analysis; browser, accessibility, signed-in acceptance and production certification were not performed for this graph.

## What changed since the earlier map

| Area | Earlier map | Current source |
| --- | --- | --- |
| Browsers | Chromium worker/offscreen ownership | Shared WebExtensions boundary; Chromium service worker/offscreen and Firefox MV3 event-page hosts |
| Browser identity | Chrome-specific examples | Native document identity is mandatory on both targets; missing safety APIs fail closed |
| Credentials | Trusted Chromium local storage | Chromium TRUSTED_CONTEXTS or Firefox extension-origin private IndexedDB |
| Guidance actions | Human performs website actions | Default remains Guide; explicit opt-in permits bounded ordinary disclosures and requested view choices |
| Scan churn | Replan on changed observation | Retained destination, coalesced in-flight work, bounded retries and pause on persistent churn |
| Navigation context | Structural headings and regions | Foreground/menu context, duplicate-destination grouping and live intermediate-stage reconciliation |
| Inference scheduling | Foreground preemption | Shared bounded queue implementation, eight waiting jobs, newest work per context and cancellation fences |
| Resource cleanup | Two-minute host cleanup | Current code: OCR workers 10 seconds, NLP workers and host 30 seconds; bounded hot caches and tensor disposal |
| Stop and Pause | Routine serialized session commands | Validated interrupts bypass routine queued work while using the same owner |
| OCR | Masked viewport fallback | Full-image masks plus an optional foreground menu/dialog pass and viewport fallback |
| Learned route confidence | Verified transition counts | Idempotent timeout penalty on existing ordinary edges, decayed by later verified success |

These are reliability and platform changes, not a cloud/SaaS conversion. The [current NLP architecture](../../docs/architecture/natural-language.md) explicitly leaves hosted inference, multi-user synchronization and multilingual requests deferred. MiniLM and Tesseract weights, single-thread settings, frozen inputs and consequential-action boundaries remain unchanged.

## Ownership stays coherent

| Owner | Responsibility | Source |
| --- | --- | --- |
| Background runtime | One pinned session and journey, permissions, hydration, memory, frame and vision coordination | [worker-runtime.ts](../../apps/extension/src/background/worker-runtime.ts) |
| Content runtime | Observation, fresh binding, plan lifecycle, verification and authorized assistance | [page-coach.ts](../../apps/extension/src/content/page-coach.ts), [plan-lifecycle.ts](../../apps/extension/src/content/plan-lifecycle.ts) |
| Navigation core | Validated requests, retrieval/planning, queues, workflows and continuity | [navigation-core](../../packages/navigation-core/index.ts) |
| Platform adapters | Typed APIs, browser capabilities, inference hosts, native sidebars and private settings | [browser platforms](../../docs/architecture/browser-platforms.md) |
| Shared UI | Presentation and callbacks; no permissions, credentials or completion authority | [shared UI](../../docs/architecture/frontend/shared-ui.md) |
| Website practice | Isolated controlled sample state using the real shared presentation | [website ownership](../../docs/architecture/frontend/website.md) |
| Optional API | Explicitly connected single-owner knowledge mirror, shared core and local fallback | [navigation architecture](../../docs/architecture/navigation.md) |

One queue still coordinates ordinary background work. Pause and Stop now use a validated interruption path to the same owner; this is not another session runtime. Shared UI and website practice do not acquire extension authority. Preserved filenames, storage keys, protocol identifiers, route versions and public document aliases remain compatibility boundaries.

## Two browser targets, one engine

The typed [API boundary](../../apps/extension/src/platform/api.ts) uses Mozilla webextension-polyfill. [Capability checks](../../apps/extension/src/platform/capabilities.ts) require scripting, native frame identity and session storage; Chromium additionally needs offscreen/context APIs, while Firefox needs worker support. Minimum engines are Chromium 140 and Firefox 153.

[Inference hosting](../../apps/extension/src/platform/inference-host.ts) creates a Chromium offscreen document or a Firefox-local instance of the same [worker host](../../apps/extension/src/inference/worker-host.ts). Workers are lazy, cancellable and disposable. Startup/disposal is serialized to prevent late cleanup from killing a resumed host. There is no hidden-tab or polling keepalive.

[Private settings](../../apps/extension/src/platform/private-settings.ts) preserve Chromium keys behind TRUSTED_CONTEXTS. Firefox uses extension-origin IndexedDB `tholi-private-settings` because it lacks that access-level API. Backend and vision settings stay outside content-script storage; private requests/drafts stay in privileged session storage. Separate browser installations do not synchronize knowledge.

[Sidebar adaptation](../../apps/extension/src/platform/sidebar.ts) respects genuine user activation. Failed Dock keeps the usable widget; removal follows native opening and fresh session/document validation. Firefox widget snapshots reuse the runtime port because embeds have a narrower API subset. A disconnected port is not proof of dismissal.

[Target manifests](../../config/extension-targets.mjs) keep Chromium output in `dist/extension` and Firefox in `dist/extension-firefox`, with stable Gecko ID `tholi@ilunonsen.com`. Target-specific run identities and artifact digests are required: Chromium evidence does not certify Firefox bytes.

## Optional assistance has two authorization gates

The pure [assistance policy](../../packages/safety-policy/assistance.ts) accepts an active task and visible, enabled, in-viewport, unoccluded, ordinary top-frame controls. It allows a closed menu/listbox/tree disclosure, or an exact requested choice among eligible radio/option/tab/select controls. Links, forms, credentials, committing or unknown effects and frame targets remain outside its authority.

The existing [UI hook](../../apps/extension/src/ui/hooks/useAssistance.ts) debounces a candidate for 400 milliseconds using the existing snapshot. The [worker transport](../../apps/extension/src/background/ui-transport.ts) validates the sender, opt-in setting, active tab, native document, session/request/revision/control identity and expanded surface. The content coach refreshes discovery, checks actual connected binding, clipping, sensitive ancestors and live policy, then limits attempts by request/state/signature. Its 64-entry attempt set bounds retained identifiers; it is not a guarantee that all page effects are known.

The implementation invokes synthetic interaction only after these checks. Existing observation and outcome verification decide what happened, including ignored clicks. This is a meaningful product capability, and it expands the need for negative regression coverage because risk classification remains heuristic.

## Recovery and resource budgets

[Plan lifecycle](../../apps/extension/src/content/plan-lifecycle.ts) retains intent while indexing and allows one automatic plan in flight. A recovery key follows request, active task, verified progress and page identity; changing fingerprints do not replenish the budget. Three bounded retries use exponential delay, then pause checking while preserving the destination. Native document/session rejection is separate and cannot be bypassed by scan recovery.

[Incremental discovery](../../packages/page-discovery/incremental.ts) excludes Tholi-owned roots and ignores unrelated ticking text while tracking relevant controls, foreground surfaces and referenced accessibility labels. Reference bookkeeping is cleared on stop. This prevents the guide's own rendering from recursively triggering website work. Fresh observations publish before asynchronous replanning.

The [inference queue](../../packages/nlp/work-queue.ts) has one active call and at most eight waiting requests per instance. The extension and API use the same implementation in their own runtimes. Foreground destinations/decisions outrank continuation and suggestions; newest work replaces older work in the same native context. Cancellation rejects stale delivery even when a CPU call must finish before reuse.

[MiniLM](../../packages/nlp/model.ts) disposes each output tensor in `finally`. [Retrieval](../../packages/nlp/retrieval.ts) bounds hot vectors and hashes to 1,024 entries each, enough for the 600-control projection plus query. These are transient hot caches, distinct from the 10,000-entry persistent derived cache. Current worker code releases idle OCR after 10 seconds, planning after 30 seconds, and the client releases the host after 30 seconds.

The [NLP document](../../docs/architecture/natural-language.md) still mentions a two-minute cleanup; that sentence is stale relative to code and the [October 19 performance record](../../docs/releases/v0.11.0/performance.md). This map records the discrepancy rather than treating both budgets as current.

## Evidence and privacy still constrain the planner

Current main-content, selected-route and foreground-menu evidence can reconcile intermediate workflow state and group duplicate links to the same destination. Genuinely different equally grounded destinations still need a user choice. Timed-out actions are bounded and excluded in the same state. Route confidence penalties apply only to already observed ordinary edges, never creating a route or proving one impossible.

The [visual guidance owner](../../apps/extension/src/content/visual-guidance.ts) can identify one foreground menu/dialog region, but full-image editable-field and iframe masking remains in force. Coordinates stay in original capture space and are temporary. DOM bindings take precedence; OCR text, confidence or changed pixels cannot establish task completion. Paddle remains experimental.

Private objectives, supplied values, entities, unfinished journeys, drafts and conversation stay session-only. Reusable knowledge stores sanitized structure, parameterized routes and observed transitions with existing retention/deletion budgets. Raw HTML, screenshots, private OCR text, coordinates and ephemeral control/document IDs stay outside reusable persistence. Sanitization and action-risk heuristics cannot promise perfect recognition on arbitrary websites. See [privacy](../../docs/architecture/privacy.md) and [security](../../docs/architecture/security.md).

## Assessment and outstanding evidence

The changes address real causes of unreliable guidance: repetitive intermediate steps, scan churn, uninterruptible queued work, stale suggestions and avoidable inference retention. The browser adapter boundary preserves the engine's identity across targets, and assistance reuses existing session and verification owners rather than introducing a second automation system. These are strong architectural improvements.

The remaining commercial uncertainty is live task reliability. Recorded targeted passes do not establish universal website correctness or certify a release. The [0.11.0 validation checklist](../../docs/releases/v0.11.0/validation.md) explicitly says not certified for packaging. The performance record keeps separate evidence cohorts, reports one held-out GitHub mismatch and long frames in the extreme 50,000-node scene, and leaves signed-in Amazon/Cloudflare/GitHub, native/manual, hosted-timing and weaker-CPU checks pending. Its metrics are reported repository evidence, not measurements rerun for this study.

Priority should remain representative user journeys, understandable recovery, prompt cancellation and independent outcomes. Firefox increases reach and also the browser acceptance matrix. Optional assistance increases convenience and also reliance on conservative action classification. Cloud models could later improve interpretation and visual understanding, but they would still need these local identity, eligibility, privacy and verification contracts.

## Reading and graph provenance

Start with [navigation](../../docs/architecture/navigation.md), [browser platforms](../../docs/architecture/browser-platforms.md), [sessions](../../docs/architecture/sessions.md), [natural language](../../docs/architecture/natural-language.md) and [page context](../../docs/architecture/page-context.md). Frontend responsibilities are in [the index](../../docs/architecture/frontend/README.md), [extension](../../docs/architecture/frontend/extension.md), [guidance](../../docs/architecture/frontend/guidance.md), [shared UI](../../docs/architecture/frontend/shared-ui.md) and [website](../../docs/architecture/frontend/website.md). [Authored regression routes](../../docs/architecture/authored-routes.md) remain isolated controlled fixtures.

[architecture.json](architecture.json) preserves existing concept IDs, adds verified 0.11.0 concepts and provides current line anchors. EXTRACTED edges use explicit source evidence at confidence 1.0. Interpretive implementation support is INFERRED and labeled `supported_by`; no import/call relationships are invented. Every `evidence_files` path was checked against this revision. Source links are relative to this checked-out snapshot and remain portable with the snapshot.
