# Local observation and memory

## Observation

Discovery begins when you submit a destination with Guide me or explicitly start page exploration. Opening the panel alone does not start discovery. Active sessions follow recognized task transitions; unrelated navigation pauses the objective. Pause/Stop remove live discovery and visual-invalidation observers, pending work and guidance. Resume obtains a fresh observation.

Discovery reads bounded labels, authored accessibility descriptions, roles, headings, form metadata, relationships and interaction state. It never reads input/textarea values, passwords, OTPs, editable contents or full page HTML. Geometry is transient. Sanitization redacts recognizable sensitive strings, but these heuristics cannot identify every private label on an arbitrary website.

Authentication is detected using field metadata and bounded form/screen context. Credentials and two-factor waiting retain the objective without an expiry deadline. Tholi does not type, authenticate or submit for the user.

## Persistence

Trusted extension `storage.session` holds active requests, supplied values, entity bindings, unfinished journeys and a task-scoped navigation ledger. It is not a general browser-history collection service. Browser-session private context is separate from extension IndexedDB knowledge.

IndexedDB v5 stores reusable interface semantics, sanitized paths without queries, layout fingerprints, observed transitions and parameterized saved routes. Original knowledge survives migrations; incompatible derived indexes rebuild. Private entity names, supplied values, authenticated statuses and their vectors remain session-only. Public sanitized reusable labels may persist. Saved private routes ask for parameters again.

Persistent records exclude raw HTML, screenshots, private OCR text, image coordinates and ephemeral document/control IDs. Destination comparison uses an ephemeral URL hash including its query; query values are not stored as text. Hashes are correlation aids, not cryptographic anonymization.

Knowledge is bounded to 50 sites, 100 latest pages, 120 state snapshots, 30 templates and 400 transitions per site. There are up to 100 reusable saved routes and a global 10,000-entry derived embedding cache. Records expire after 90 days when accessed. Forget removes the website and routes traversing it; Clear removes knowledge/routes/indexes. Observation stops before deletion. Uninstall removes extension-owned data.

## Vision, models and optional backend

Viewport capture requires the pinned authorized HTTP/HTTPS tab, its focused window, native document identity and separate browser screenshot access. The background capture owner checks that scope before and after capture and before consuming or transmitting its result. Tab/window changes, navigation, zoom, permission revocation and session changes invalidate pending work. Screenshot access grants no website-action authority.

Pixel privacy uses a separate complete, bounded traversal rather than discovery's selected controls. It masks all form fields, editable surfaces, declared sensitive elements and iframe rectangles. Native open/closed-shadow access is used only for privacy geometry, never semantic discovery. Authorized frames can still support DOM guidance while their pixels remain masked. The traversal yields after eight milliseconds, permits two seconds per walk, and refuses incomplete evidence beyond 256 document/shadow roots or 5,000 masks. Private pixels with active page animations, private filtered/shadowed overflow or backdrop paint are unsupported. Arbitrary generated paint and private canvas contents cannot be inferred reliably from DOM rectangles; this is not an arbitrary-pixel privacy guarantee or an atomic DOM/screenshot operation.

Tholi's presentation is suppressed only around capture, with a one-second restoration watchdog. The separate capture proof expires after 15 seconds and is rechecked without replacing its original page/scan identity. Raw PNGs are admitted locally before bitmap allocation, bounded to 16,000,000 pixels and 16 MiB. Opaque masks are painted on the original native-size bitmap before any resizing, cropping, grayscale conversion or inversion. OCR, optional color output and both region-comparison sources share that stage. Raw images never enter backend fallback, persistence or payload logs. OCR retains its four-megapixel/four-MiB limit; optional navigation color output permits one viewport image or one crop within four megapixels/two MiB. Images and recognized private text remain temporary processing data, not saved evidence. See the [masked-capture validation record](../development/testing/masked-capture-validation.md) for measured browser scope and unsupported geometry.

MiniLM and default Tesseract assets are packaged locally. Experimental Paddle assets are included only by the explicit experimental build. The optional Chrome Prompt API is separate; enabling it may download Chrome's model. It receives bounded sanitized observations and task context. Predictions remain untrusted and cannot declare success.

The optional single-owner API receives knowledge/context only when explicitly connected. Temporary masked OCR images go there only when backend OCR is enabled. Its final send guard runs after backend capability, permission and protected-setting waits, rechecking the capture proof and current native scope. SQLite follows the same reusable/private persistence policy. It does not persist OCR payloads or private session context. Backend failure reuses the same prepared, masked OCR input for local recognition instead of preparing or forwarding the raw capture again. The optional navigation color producer enables no provider endpoint or automatic upload. A failed mirror deletion is reported for retry after reconnecting.

Firefox declares no required data transmission. Connecting the optional backend requests its host access and optional authentication, browsing-activity, website-activity and website-content consent. These cover the API bearer token, website origins/routes, navigation context, bounded observations and optional masked OCR images sent to that chosen server. Every backend request checks the current grant; declining or revoking it blocks transmission and leaves local processing available. Mirror deletion failures still require reconnecting and retrying; revocation does not erase an existing server copy.

Diagnostics are local, bounded and redacted. Do not capture authenticated screenshots or traces by default. Diagnostic exports omit labels, goals, paths, raw DOM and field values. See [security](security.md), [API setup](../guides/backend.md) and [native verification](../guides/getting-started.md).

## Account provider credentials and inference

The optional authenticated service keeps customer-provider credentials separate
from the legacy private API and from managed Vertex experiments. The default
Compose deployment has no provider keys or provider egress. The
[explicit BYOK deployment profile](../development/local-stack.md#customer-providers-and-private-learning)
requires a dedicated operator keyring and an independently enabled customer-inference
control; neither setting enables managed Gemini or bypasses authorization.

One connection per account/provider stores an AES-256-GCM envelope in PostgreSQL.
Authenticated associated data binds its account, connection, provider, connection
revision and operator key version. The dedicated versioned keyring is outside the
database, client assets and worker credentials; identity-flow and private-file-link
secrets cannot be reused. This protects a database-only copy, not a compromised API
process or an operator with both database and keyring access. Provider keys are
decrypted transiently for an authorized outbound request. They never appear in
metadata/list/account-export responses, the extension, audit details or payload logs.

Saving or replacing a credential makes no provider request. Verification metadata
is set only after a successful validated guidance request and is bound to the
current connection revision. Rotation and removal invalidate retained selections.
Removal clears the ciphertext but does not revoke the credential at its provider.
Suspension disables connections; account deletion clears their keys before deferred
cleanup. Account export includes only safe connection metadata. Removing a key does
not erase information already sent to a provider or independently retained backups.

Explicit connected guidance sends bounded sanitized observation/task context to the
configured Tholi service and selected provider. A separately authorized masked image
may accompany it. OpenAI and Anthropic are direct recipients. OpenRouter is an
additional recipient and routes the curated model only to Anthropic; fallback is
disabled, parameter support is required and its routing request denies data
collection. These are request restrictions, not independently verified retention,
residency or zero-data-retention guarantees. OpenAI Responses uses `store:false`,
which does not itself remove provider abuse-monitoring retention. Review the
provider/account policy before sending data:
[OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data),
[Anthropic data privacy](https://privacy.claude.com/), and
[OpenRouter routing/data controls](https://openrouter.ai/docs/guides/routing/provider-selection).

The API resolves the exact current account, workspace, consent, connection revision,
provider/model policy and retrieval snapshot before outbound requests and before
releasing a proposal. Images retain their separate permission and masking guards.
Provider responses remain untrusted proposals; the browser alone owns journey state,
control rebinding, consequential-action review and independent outcome verification.

Customer-funded requests share existing admission and usage records, with zero
managed-model credit reservation. They still consume bounded request, concurrency,
token, image, byte and deadline budgets. Usage version 2 counts total input and total
output, including reasoning once; missing breakdowns remain unknown. Historical
usage and pricing records keep their original semantics. A missing or unusable usage
report fences further automatic dispatch rather than fabricating zero cost. No
automatic provider fallback or generation retry occurs. A provider may already have
processed a request when cancellation or a transport error reaches Tholi.

## Private cloud knowledge

Collection and reuse both default off for each account, workspace and exact website
origin. Signing in, adding a provider key or granting image access does not enable
learning and does not upload existing local memory. Enabling collection records the
reviewed saved-data purpose and a revision-checked site choice. Collection captures
only future approved structure and independently verified transitions. Reuse is a
separate site choice and grants no current website-action authority.

The existing saved-data owner stores a versioned graph in the same PostgreSQL/RLS
boundary: at most eight states, 48 sanitized controls, 16 verified edges and 16 KiB.
Its identifiers derive from approved structure. Raw page paths/query strings,
destinations, field values, selectors, native document/control IDs, geometry, images,
OCR text and credentials are excluded. Interface labels can still contain sensitive
information that sanitization misses. This is private account/workspace learning;
there is no community publication, cross-account retrieval, shared-model training or
automatic provider embedding request.

Retrieval checks current account/membership, saved-data consent and site reuse,
selects no more than five bounded route facts within 6 KiB, and remains inside the
model's total input budget. Provider-visible facts include approved interface text
and outcome counts, not artifact IDs, revisions or database credentials. Server-only
source revisions and a snapshot digest bind the request. Deletion, changed site
choices, revoked consent or changed source revisions invalidate that snapshot before
dispatch and response release. Historical hints must rebind to current eligible
controls; prior successful edges cannot establish present arrival.

Graphs expire 90 days after their oldest retained observation, bounded by service
receipt time. Metadata edits cannot renew the evidence. Expired graphs are excluded
from live reads, sync and retrieval, and the existing maintenance tick tombstones
them with new sync revisions. Related export expiry cannot outlive its graph;
existing private-file cleanup removes expired copies. Physical pruning may lag when
maintenance is stopped, and operator backups have independent retention.

Disabling collection stops future writes; disabling reuse stops cloud hints. The
**Forget cloud knowledge** operation first disables both choices and deletes the
site's graph records in bounded batches. Further batches require explicit
continuation; an unknown response is not deletion confirmation. Local memory, saved
routes and conversation excerpts have their own controls. Inactive site settings
are eligible for removal after 90 days without live graphs; monotonic workspace
revisions prevent old approvals from silently re-enabling learning.

## Tholi presentation data

Presentation preferences and widget bounds are stored locally. Composer drafts and at most 80 conversation messages use trusted extension-session storage and are not synchronized to the website or cloud. The widget uses a session/document-bound command allowlist and does not receive backend credentials. Guidance surfaces are excluded from discovery and hidden for OCR capture.

Closing the widget minimizes it to a launcher and keeps authorized observation and verification active. Expanded highlights and automatic guidance scrolling are suppressed until restoration. The launcher does not show the private destination. Stop cancels the task; Reset current session clears unfinished tasks, draft and conversation. These controls do not delete saved website knowledge unless its separate deletion controls are used. Private continuity ends with the browser session.

Store installation, public navigation and isolated practice require no Tholi account. A configured identity service enables real account access through the existing account boundary. Password entry stays with the identity provider; session credentials use protected delivery and are excluded from public practice. Local routes are not uploaded by signing in. The unconfigured contact form prepares an email draft in memory; configured authenticated support can submit through its separately disclosed service. Mock account components remain unrouted drafts outside production imports.

Website cookie choices use the first-party `tholi_consent` cookie for 180 days. The optional `tholi_theme` cookie remembers Light or Dark only after appearance-preference storage is allowed. Essential only or withdrawing preference storage deletes that cookie; appearance remains in memory on the current page. Cookies use host-only scope, `Path=/`, `SameSite=Lax`, and `Secure` on HTTPS. They are not credentials. With blocked cookies, choices and appearance remain usable in memory. Silence grants no optional storage.

The app's optional analytics boundary is inactive without a disclosed provider and fresh browser consent. Only the configured signed-in account boundary registers the Tholi account service provider. Collection additionally requires current workspace `product_analytics` consent, membership and an active account, checked in the database transaction. The bounded event schema excludes goals, conversation, search text, private URLs, field values, images and credentials. Accepted records are attributed by the server, available for scoped review/deletion for up to 30 days, then removed by bounded expiry maintenance; physical pruning and separately retained operator backups may lag. Purpose withdrawal purges attributed product events atomically; browser withdrawal aborts pending work. Public Local/practice use does not mount an account provider for analytics. Operational logs/traces and 90-day security audit metadata are separate, redacted schemas. They do not replace account or credit ledgers. See [service observability](../development/service-observability.md) for budgets, export/deletion and deployment responsibilities.

Website 0.1.0 is public at [tholi.io](https://tholi.io) on Cloudflare Pages. The live host injects a Cloudflare page/performance measurement script independently of the app's consent boundary and cookie controls. The `/privacy`, `/terms` and `/cookies` notices disclose that behavior and identify ILUNỌNSEN LLC in Ohio, United States. Professional legal review and confirmation of the hosting dashboard's logging/retention settings remain pending. See the [deployment evidence](../releases/website/v0.1.0/validation.md).

Backend/vision credentials use protected Chromium local storage or Firefox extension-origin IndexedDB, outside content-script storage. See [browser platforms](browser-platforms.md).
