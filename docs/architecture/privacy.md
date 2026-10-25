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

Viewport capture requires an active authorized HTTP/HTTPS tab and browser screenshot access. Tholi hides its overlays and masks discovered editable fields, including open shadow roots, plus all iframe rectangles. Authorized frames support DOM guidance but their pixels remain masked. Images and recognized private text are temporary processing data, not saved evidence.

MiniLM and default Tesseract assets are packaged locally. Experimental Paddle assets are included only by the explicit experimental build. The optional Chrome Prompt API is separate; enabling it may download Chrome's model. It receives bounded sanitized observations and task context. Predictions remain untrusted and cannot declare success.

The optional single-owner API receives knowledge/context only when explicitly connected. Temporary masked images go there only when backend OCR is enabled. SQLite follows the same reusable/private persistence policy. It does not persist OCR payloads or private session context. Backend failure falls back to browser processing. A failed mirror deletion is reported for retry after reconnecting.

Firefox declares no required data transmission. Connecting the optional backend requests its host access and optional authentication, browsing-activity, website-activity and website-content consent. These cover the API bearer token, website origins/routes, navigation context, bounded observations and optional masked OCR images sent to that chosen server. Every backend request checks the current grant; declining or revoking it blocks transmission and leaves local processing available. Mirror deletion failures still require reconnecting and retrying; revocation does not erase an existing server copy.

Diagnostics are local, bounded and redacted. Do not capture authenticated screenshots or traces by default. Diagnostic exports omit labels, goals, paths, raw DOM and field values. See [security](security.md), [API setup](../guides/backend.md) and [native verification](../guides/getting-started.md).

## Tholi presentation data

Presentation preferences and widget bounds are stored locally. Composer drafts and at most 80 conversation messages use trusted extension-session storage and are not synchronized to the website or cloud. The widget uses a session/document-bound command allowlist and does not receive backend credentials. Guidance surfaces are excluded from discovery and hidden for OCR capture.

Closing the widget minimizes it to a launcher and keeps authorized observation and verification active. Expanded highlights and automatic guidance scrolling are suppressed until restoration. The launcher does not show the private destination. Stop cancels the task; Reset current session clears unfinished tasks, draft and conversation. These controls do not delete saved website knowledge unless its separate deletion controls are used. Private continuity ends with the browser session.

The public Tholi website has no account service. Mock account components are retained as unrouted drafts and are excluded from production imports. Public navigation and optional practice do not read or write account sessions, names, emails, passwords or onboarding state. Earlier demonstrations may have left `tholi-demo-account` in browser-session storage; this version ignores that entry and users can remove it with browser site-data controls. Store installation requires no Tholi account. The contact form prepares a draft in page memory for the user to email; it does not submit or persist it.

Website cookie choices use the first-party `tholi_consent` cookie for 180 days. The optional `tholi_theme` cookie remembers Light or Dark only after appearance-preference storage is allowed. Essential only or withdrawing preference storage deletes that cookie; appearance remains in memory on the current page. Cookies use host-only scope, `Path=/`, `SameSite=Lax`, and `Secure` on HTTPS. They are not credentials. With blocked cookies, choices and appearance remain usable in memory. Silence grants no optional storage.

The app's optional analytics boundary is inactive with no configured provider. It accepts only public page categories, download clicks and the two fixed practice task identifiers. It excludes requests, conversation, account information, documentation searches and extension observations. Any future app provider needs a specific disclosure and fresh matching consent; withdrawal cancels queued/in-flight work.

Website 0.1.0 is public at [tholi.io](https://tholi.io) on Cloudflare Pages. The live host injects a Cloudflare page/performance measurement script independently of the app's consent boundary and cookie controls. The `/privacy`, `/terms` and `/cookies` notices disclose that behavior and identify ILUNỌNSEN LLC in Ohio, United States. Professional legal review and confirmation of the hosting dashboard's logging/retention settings remain pending. See the [deployment evidence](../releases/website/v0.1.0/validation.md).

Backend/vision credentials use protected Chromium local storage or Firefox extension-origin IndexedDB, outside content-script storage. See [browser platforms](browser-platforms.md).
