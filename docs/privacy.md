# Local observation and memory

## Observation

Discovery begins when you submit a destination with Guide me or explicitly start page exploration. Opening the panel alone does not start discovery. Active sessions follow recognized task transitions; unrelated navigation pauses the objective. Pause/Stop remove live discovery and visual-invalidation observers, pending work and guidance. Resume obtains a fresh observation.

Discovery reads bounded labels, authored accessibility descriptions, roles, headings, form metadata, relationships and interaction state. It never reads input/textarea values, passwords, OTPs, editable contents or full page HTML. Geometry is transient. Sanitization redacts recognizable sensitive strings, but these heuristics cannot identify every private label on an arbitrary website.

Authentication is detected using field metadata and bounded form/screen context. Credentials and two-factor waiting retain the objective without an expiry deadline. Navigator does not type, authenticate or submit for the user.

## Persistence

Trusted `chrome.storage.session` holds active requests, supplied values, entity bindings, unfinished journeys and a task-scoped navigation ledger. It is not a general browser-history collection service. Browser-session private context is separate from extension IndexedDB knowledge.

IndexedDB v5 stores reusable interface semantics, sanitized paths without queries, layout fingerprints, observed transitions and parameterized saved routes. Original knowledge survives migrations; incompatible derived indexes rebuild. Private entity names, supplied values, authenticated statuses and their vectors remain session-only. Public sanitized reusable labels may persist. Saved private routes ask for parameters again.

Persistent records exclude raw HTML, screenshots, private OCR text, image coordinates and ephemeral document/control IDs. Destination comparison uses an ephemeral URL hash including its query; query values are not stored as text. Hashes are correlation aids, not cryptographic anonymization.

Knowledge is bounded to 50 sites, 100 latest pages, 120 state snapshots, 30 templates and 400 transitions per site. There are up to 100 reusable saved routes and a global 10,000-entry derived embedding cache. Records expire after 90 days when accessed. Forget removes the website and routes traversing it; Clear removes knowledge/routes/indexes. Observation stops before deletion. Uninstall removes extension-owned data.

## Vision, models and optional backend

Viewport capture requires an active authorized HTTP/HTTPS tab and Chrome screenshot access. Navigator hides its overlays and masks discovered editable fields, including open shadow roots, plus all iframe rectangles. Authorized frames support DOM guidance but their pixels remain masked. Images and recognized private text are temporary processing data, not saved evidence.

MiniLM and default Tesseract assets are packaged locally. Experimental Paddle assets are included only by the explicit experimental build. The optional Chrome Prompt API is separate; enabling it may download Chrome's model. It receives bounded sanitized observations and task context. Predictions remain untrusted and cannot declare success.

The optional single-owner API receives knowledge/context only when explicitly connected. Temporary masked images go there only when backend OCR is enabled. SQLite follows the same reusable/private persistence policy. It does not persist OCR payloads or private session context. Backend failure falls back to browser processing. A failed mirror deletion is reported for retry after reconnecting.

Diagnostics are local, bounded and redacted. Do not capture authenticated screenshots or traces by default. Diagnostic exports omit labels, goals, paths, raw DOM and field values. See [security](security.md), [API setup](api-setup.md) and [native verification](chrome-handoff.md).
