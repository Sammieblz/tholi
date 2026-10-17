# Contextual web-app navigation

`packages/navigation-core` owns workflow interpretation and planning.
`workflow-contracts.ts` validates entity slots, milestones, outcome evidence,
surface coverage and control references. The original request and three-task
queue stay separate from internal workflow milestones. Corrections invalidate
dependent guidance; named references use compatible session entities. Ambiguous
live targets return grounded choices. Guides have versioned provenance and contain
no selectors, coordinates, account identifiers or automatically followed URLs.

The extension owns discovery, DOM binding and verification. Its incremental
registry processes added/removed/changed subtrees in approximately 8 ms slices,
coalesces notifications, reserves structural/global controls and admits new active
dialog controls under saturation. A session retains at most 5,000 controls across
the tab and authorized frames; planning receives at most 600. Query, focus, scroll,
resize and Chrome SPA-navigation events reprioritize discovery. Open shadow roots
are discovered on traversal, foreground reconciliation, interaction and periodic
idle reconciliation. Coverage reports omitted and virtualized items. Unknown
content is not evidence that a requested control does not exist.

The `tabs` permission supplies [current-tab metadata before a host grant](https://developer.chrome.com/docs/extensions/reference/api/tabs#permissions). Without
it, an already-open side panel can receive a tab without its URL and incorrectly
offer no navigation. The extension reads the active tab; it does not use the
browsing-history API. An explicit Start requests access to the website selected
at that click, and a tab/origin check rejects changes during the grant. A denied
grant starts no scanning. HTTP/HTTPS availability is independent of the six guide
families; unfamiliar websites use general live discovery.

Geometry, clipping, current availability and modal/occlusion checks use the current
DOM. Recycled nodes get new semantic signatures. Frame references include tab,
frame, Chrome document identity and control identity; a nonce and browser sender
identity validate frame messages. Denied embedded origins expose selective-access
recovery. Overlays stay local to the target frame, and parent visibility hides
covered frames. Frame scanning shares the tab's control budget.

Compromise, BM25 and normalized quantized MiniLM remain the offline default.
Fresh exact lexical matches can guide while embeddings load; other requests use
the hybrid pipeline. Semantic cache identity excludes geometry/checked state.
Only changed semantic content needs a new embedding. Packaged browser inference
runs in an offscreen worker, one CPU thread; foreground planning outranks
suggestions. Stop cancels inference and idle resources unload. LLM support remains
experimental and opt-in; embedding activity and LLM calls are distinct.

A verified picker reveal retains its choice handoff while its fresh expanded
state remains present; replanning cannot substitute its search field. Explicit
following tasks can advance after the requested reveal. A closed picker requires
fresh planning. Durable memory runs in a separate, bounded background queue,
coalescing ordinary observations while retaining distinct verified edges. Live
planning and sidebar polls read cached committed knowledge rather than waiting
for storage. Stalled IndexedDB transactions abort after five seconds, preserving
previous knowledge. Forget/Clear and route deletion discard pending writes and
drain the current writer before deletion, including optional backend mirroring.
Derived embedding/index writes use the same background scheduling policy. A cache
read that exceeds 200 ms falls back to CPU computation and briefly bypasses the
unavailable cache; persistence cannot become an inference prerequisite. Worker
errors and a 30-second request deadline settle outstanding calls and replace the
worker rather than leaving Chrome message ports pending. Such errors never count
as task completion.

Journeys retain objective, desired result, entities, exclusions, verified milestones
and pending action through documents, modals, menus and supported permission
handoffs. Unexpected navigation pauses guidance. Each request, context and
observation revision is checked before applying asynchronous results. Guides and
observed transitions predict upcoming steps; only current evidence grants a
highlight. Configuration and file inputs are manual handoffs; focusing a field or
continuing guidance cannot verify its contents. Build commands/output directories
must come from the user or the platform.

Consequential or unknown effects get a distinct review stage. Navigator highlights
the review target and the user acts on the website. Verification rejects unchanged,
busy, stale, negative or unrelated outcomes. Preferences require requested state;
creation requires the requested new item; deployments and memberships require
specific status evidence. After two minutes, Wait/Retry/replanning keep the task
incomplete. Pause retains context; Stop cancels it; Skip records a skipped task.

IndexedDB v4 preserves Wikipedia knowledge and reusable routes. Migration sanitizes
raw knowledge for the six platform families, clears affected indexes and removes
legacy derived embeddings whose origin provenance is unknown. Original public
knowledge survives. Only allowlisted reusable interface semantics are durable on
private applications; unknown item text, private paths, supplied values, option
names, statuses and their embeddings stay in trusted session storage or inference
memory. Saved journeys contain parameterized purposes and steps, and request
values again. SQLite applies the same policy. The service never logs session
requests or authenticated screenshots.

The optional single-owner API preserves `/v1` and adds `/v2/health`, `/observations`,
`/knowledge`, `/suggestions`, `/plans`, `/routes`, `/forget`, `/clear` and generated
`/openapi.json`. v2 plans require `protocolVersion: 2` and `contextRevision`; results
echo request/document/observation/context revisions and may include workflow and
target reference. Observations accept snapshots, frame envelopes or bounded
deltas; stale delta bases return 409 and require a fresh projection. Delta assembly
is bounded session memory; only structural semantics persist. An older backend,
connection failure or pending inference falls back to local processing. Browser
IndexedDB remains authoritative. Loopback defaults, generated bearer credentials,
explicit extension-origin CORS and HTTPS self-hosting rules remain unchanged.

Validation commands: `npm run check`, `npm run test:nlp`,
`npm run test:multi-app`, `npm run test:nlp:browser`,
`npm run test:multi-app:browser`, `npm run test:e2e`,
`npm run test:live:wikipedia`, `npm run test:acceptance`.
Both package scripts require matching evaluated build hashes, including the new
multi-app model, runtime/API, browser and performance reports. See the
[capability matrix](capabilities.md) for the pending signed-in checks.
