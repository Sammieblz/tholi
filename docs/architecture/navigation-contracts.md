# Ephemeral navigation observations and decisions

Roadmap [#36](https://github.com/Sammieblz/tholi/issues/36) introduced the shared
bounded observation and proposal contract. [#40](https://github.com/Sammieblz/tholi/issues/40)
adds explicitly enabled, authenticated fake transport, and
[#41](https://github.com/Sammieblz/tholi/issues/41) connects it to the browser's
single journey owner. The default service still advertises `decisions: false`.
Neither contract admission nor a saved processing choice enables paid inference.

[`contracts-navigation.ts`](../../packages/navigation-core/contracts-navigation.ts)
owns this independent protocol. The API publishes its schemas as OpenAPI
components for review and client integration: `NavigationObservation` and
`NavigationDecision`. The wire protocol is `tholi-navigation`, version 1; its
browser-native reference extension has a separate version 1. A component is not an executable
route; `paths`, the route inventory and capability negotiation remain the current
availability owners. The ordinary service body limit remains 512 KiB. Only the
explicitly enabled decision POST has the separate 4 MiB encoded envelope budget;
see the [service transport](../development/service-api.md#opt-in-development-navigation-transport).

## Native identity and browser authority

The browser creates the observation from its current pinned session and journey.
Its native document and frame identities remain distinct from website URLs,
structural hashes and server-created HTTP correlation IDs. A page at the same URL
after navigation is a different document.

The observation carries session, journey and request IDs plus session, journey,
document, request, context, scan and viewport generations,
viewport evidence, bounded regions, controls and omission counts. A control
reference identifies its actual browser tab, frame, native document and current
control ID. Root controls use the captured native root identity; authorized frame
controls retain their frame-local references. The composed observation revision
changes when frame documents, scans or visibility change.

Only current ordinary eligible references can be proposed as guide targets;
the join validator rejects consequential targets even if `eligible` is forged.
Observed
structure, omitted controls, inaccessible frames and unloaded content do not
authorize interaction. The browser still binds against a fresh live element,
checks visibility, availability, occlusion, host grants and consequential-action
review, and independently verifies the outcome. Website text, model confidence
and a returned instruction cannot relax these checks.

The contract does not transfer window, browser-chrome or OS-action authority.
A future desktop adapter needs its own native observation and permission
contract. It cannot substitute a URL or synthetic document ID for browser-native
identity.

## Sanitized task context

The shared context projection lives in the existing
[`model-context.ts`](../../packages/goal-planner/model-context.ts) owner. It uses
`sanitizeGoal` to retain the entire validated request, including qualifiers and
negation, within the 1,000-character goal limit. It does not truncate a user goal
to the 160-character interface-label limit.

Verified progress contains at most the last eight sanitized labels and control
kinds. Raw objectives, desired-value objects, progress origins and paths,
checkpoints, workflow entities and historical native references are excluded.
The current goal carries the user's requested destination; a previous model
reply or predicted step does not become verified evidence.

This is a request projection, not a new persisted journey or saved-route model.
It does not change stored identifiers or automatically import Local data. Schema
validation and text redaction also do not establish user consent. The sending
client and service must check current scope and purpose-specific consent
before transmitting structure or images.

## Decision meanings

| Result                | Meaning                                                                                                                            |
| --------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `guide`               | Proposes a next grounded ordinary target from the submitted current eligible references. The browser validates and binds it again. |
| `request-observation` | Requests additional bounded evidence. It cannot grant capture access, upload an image or continue after a changed generation.      |
| `clarify`             | Asks for information needed to continue the destination. It does not record completion or select a consequential action.           |
| `unsupported`         | Reports that the submitted evidence or contract cannot support a decision. It does not stop or complete the browser journey.       |

All result variants retain the request's identity and freshness context. Returned
selectors, executable code, arbitrary URLs, privileged actions and completion
claims are outside the contract. Service errors continue to use the existing
safe HTTP error envelope.

## Freshness and clocks

The browser retains the original observation and request baselines. Before
accepting any result variant, it checks the active session, journey, request
generation, native target, scan/context revisions and viewport generation.
Navigation, Stop, replacement, scope revocation or a changed viewport invalidates
the corresponding pending evidence. A retry or late reply does not reset its age.
The observation deadline is at most 25 seconds after its original observation;
when an image is included, the same deadline is at most 25 seconds after the
original capture. Capture and observation do not receive separate consecutive
25-second allowances.

Optional `serverTiming.generatedAtMs` and `serverTiming.expiresAtMs` use the
service clock. Their positive bounded
interval can constrain a result's lifetime, but the browser must not compare the
service epoch directly with its own wall clock. Browser-owned elapsed time and
the original request deadline remain authoritative. The join validator uses the
smallest observation deadline, original request deadline and server lifetime
measured conservatively from that original request's start. An optional
`serverNowMs` must come from the server clock or a separately calibrated source;
passing a browser wall-clock reading as server time is invalid integration.
Measurements must share a
clock domain; content and background `performance.now()` values cannot be mixed.
Ephemeral in-flight evidence is discarded after losing that local timing state.

The contract's pure validation is separate from provider availability and browser
integration. The current authenticated HTTP profile is fake-only. Live provider
experiments, durable cost admission and quality evidence have separate owners.

## Background proposal integration

The existing journey service first installs the ordinary local request and plan.
An explicit authenticated development-service choice can then enrich the same
retained task. Its network wait runs outside the routine journey and local NLP
queues. Local-only selection sends no service observation. Unknown account
settings preserve local planning while refusing inference egress; selecting the
service also prevents an implicit legacy inference request. Independently
consented legacy route mirroring and explicit private OCR retain their owners.

The panel and journey service reuse one native-bound page observation owner.
Actual session, task, journey, document, page, workflow, progress and viewport
changes invalidate pending proposals. Frame scan UUIDs remain evidence for
targeted region refresh; a newly generated scan UUID alone does not establish a
changed document or layout. Generation counters never replace native IDs.

Each admitted job has one original deadline and at most two decision calls: the
initial proposal and one bounded observation follow-up. A visual request uses the
existing masked-capture owner only with its separate image choice and current
grants. No raw image or screenshot coordinate becomes a content command.
Uncertain failures and status-only replays do not trigger another generation.

Prepared capture currentness follows semantic page/perception and frozen task
evidence, not allocated snapshot object identity or per-read scan UUIDs. Required
fresh scans remain in place. The content runtime retains actual document/session
ownership, visibility, masking/privacy revalidation and the original visual lease;
DOM, viewport, task, review, progress or Stop changes invalidate that lease.
See the [integrated comparison validation](../development/testing/perception-comparison-validation.md).

The background joins a returned decision against the submitted allowlist, then
targets the actual native document for fresh content binding. Both
[Mozilla](https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/API/tabs/sendMessage)
and [Chromium](https://developer.chrome.com/docs/extensions/reference/api/tabs#method-sendMessage)
document this `documentId` delivery option. The content owner checks the retained
request/task/journey, workflow, page, viewport, pending verification and current
ordinary control before selecting it. Generic background RPC cannot apply a
proposal, and the content operation cannot replace the journey with a standalone
highlight.

Service-guided steps are exploratory. Actual checked state, navigation or another
declared control effect can verify a step; only the existing independent
objective/workflow owner can establish destination arrival. Inherited back,
tab-switch or visual actions and stale route/recovery estimates are cleared
when a proposal replaces the current step. Consequential-action review and the
existing limited assisted-navigation policy still apply.

`serviceNavigation` is bounded background-owned presentation metadata. It can
describe pending, guiding, clarification, unsupported or error state, and cannot
represent completion or contain captures or credentials. It is scope-bound and
removed from persisted/restored sessions. The local plan retains its original
provenance; the current service step has its own explicit source label rather
than inheriting an on-device or confidence claim. See the
[integration verification record](../development/testing/journey-proposals-validation.md)
for measured checks and remaining native evidence.

## Images and coordinate provenance

Images are optional and request-bound. The contract distinguishes original
viewport CSS coordinates, capture pixel dimensions and a crop or scaled image.
It retains zoom, device-pixel-ratio, capture identity, viewport revision,
timestamps and versioned masking metadata. Image geometry cannot be reused after
the native target or viewport changes.

Viewport width and height describe the layout viewport in CSS pixels. The
`visualViewport` records its visible offset, size, scale and document position,
with `pageLeft = scrollX + offsetLeft` and the corresponding vertical equation.
Raw measurements remain unchanged. The [CSSOM View editor's draft](https://drafts.csswg.org/cssom-view/#extensions-to-the-window-interface)
exposes integer `innerWidth`/`innerHeight`, while its
[VisualViewport dimensions](https://drafts.csswg.org/cssom-view/#the-visualviewport-interface)
use doubles. Tholi admits a visual edge up to 0.5 CSS pixels beyond an integer
layout dimension as a bounded observed-precision policy, not a specification
guarantee about native capture. Larger overhangs, or overhangs beyond a fractional
layout dimension, are refused. Privacy masks use the union of the actual layout
and visual extents, retaining private geometry in that visible fractional band.

Capture `cssBounds` use layout-viewport CSS coordinates and remain within that
visible rectangle. A full viewport image covers the complete visual viewport;
a crop identifies a subset. `pixelBounds` identify that rectangle within the
original bitmap. Without `captureCssBounds`, `scaleX` and `scaleY` derive from
the original bitmap and visual viewport dimensions, preserving the original
profile. A native layout capture can declare `source.captureCssBounds` exactly
as the observed layout rectangle `{ x: 0, y: 0, width, height }`. Its scales and
pixel coordinates then use that original layout plane. The visual rectangle
remains a subset, so a scrollbar gutter can be excluded from the final image
without relabeling the original bitmap. Zoom multiplied by DPR is never used as
a substitute for measured pixel scale. A bounded crop reports its quantized
native pixels and corresponding actual CSS bounds; its final image preserves
that aspect ratio and cannot upscale its source pixels.

Source aspect admission requires overlapping horizontal/vertical scale intervals
with at most 0.5 CSS pixels of integer-layout uncertainty and 0.5 native pixels
of quantization per axis, consistent with the observed visual edge. This does not
replace the recorded source plane or scales. Final image geometry retains its
one-native-pixel correspondence bound. Viewport pixel bounds stay inside the
original bitmap; an unrepresentable fractional crop is refused. Legacy OCR drops
an optional focus hint outside its original integer-layout coordinate contract,
while keeping all privacy masks and whole-viewport recognition.

The optional native-plane field is an explicit extension of the image source
profile. Existing inputs without it keep their validation behavior. Older
strict receivers reject the new field, so later inference transport must
negotiate support before sending this profile. This milestone enables no new
provider endpoint or automatic image transmission.

| Budget                                  | Limit                                                                                              |
| --------------------------------------- | -------------------------------------------------------------------------------------------------- |
| Observed frames                         | 16                                                                                                 |
| Regions                                 | 32                                                                                                 |
| Controls                                | 96                                                                                                 |
| Verified progress summaries             | 8                                                                                                  |
| Model projection                        | 24,000 UTF-8 bytes, including structural envelope and image provenance but excluding image payload |
| Images                                  | 1                                                                                                  |
| Decoded image data                      | 2 MiB                                                                                              |
| Image area                              | 4,000,000 pixels                                                                                   |
| Image width or height                   | 8,192 pixels                                                                                       |
| Entire encoded request                  | 4 MiB                                                                                              |
| Client observation and request lifetime | At most 25 seconds                                                                                 |

These are independent bounds. Base64 expansion, JSON escaping, the goal,
progress, stamps and all images count toward the complete UTF-8 request size.
A small control array does not establish that the envelope fits.

[`png.ts`](../../packages/vision/png.ts) admits a bounded canonical static PNG
container, checking its signature, dimensions, chunk layout and CRCs while
excluding unrelated metadata, animation and trailing bytes. Admission does not
decode pixels or prove that editors, inaccessible frames or private content were
masked. The actual masked-capture pipeline and pixel-level evidence belong to
[#38](https://github.com/Sammieblz/tholi/issues/38). A caller's masking metadata
cannot grant image-transmission permission.

## Compatibility and evidence

The legacy private `/v1` and `/v2` schemas, OCR limits and local fallback remain
separate. In particular, the legacy result still fixes `activity.llmCalls` to
zero. The new protocol does not silently turn a cloud model response into a
legacy local result or widen durable memory to hold geometry or images.

See the [validation record](../development/testing/navigation-contracts-validation.md)
for actual check status. The [frozen navigation baseline](../development/testing/navigation-baseline.md)
is unchanged. Contract validation does not establish model quality, improved
navigation, image privacy, native capture consent or release certification.
