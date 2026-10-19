# Natural language in Tholi

Tholi supports English requests on English interfaces. Compromise
parses the entire validated request before retrieval, preserving ordered tasks,
negation, corrections and desired values. The maximum is 1,000 characters and
three explicit tasks. Unresolved references require an explicit target.

Interpretation and lexical retrieval share authentication aliases (sign in/log in,
sign up/create account) and ordinary phrase normalization, including hyphens and
Unicode dashes. Quoted names and URLs are protected from phrase rewriting; the
original validated request remains available. Context-dependent app/website wording
in the Cloudflare guide is resolved only with live Workers & Pages evidence, not
as an unconditional synonym across all software.

The shared core combines BM25, normalized mean-pooled MiniLM vectors and the
existing semantic/observed-route planner. Index text contains sanitized labels,
descriptions, roles, headings, regions, form purpose and reveal relationships.
Visibility, enabled state, risk and checked state are freshly validated and
never encoded as semantic cache identity. SHA-256 plus the pinned model revision
keys the global 10,000-entry derived cache. Browser IndexedDB v5 preserves
original knowledge and reusable routes. Private platform entities stay
session-only; versioned incompatible derived indexes are rebuilt.

The extension runs packaged q8 ONNX weights in a shared worker host: a Chromium
offscreen document or the Firefox MV3 event page. ONNX uses one CPU thread, a packaged WASM backend and no
remote models. Foreground planning preempts suggestions between model calls.
The extension and optional API share one bounded priority queue: one active CPU
call, at most eight waiting requests, newest work per native document context.
Foreground planning cancels stale suggestions; cancellation rejects stale delivery
even when a model call must finish before resources can be reused. This is bounded
scheduling, not concurrent copies of the model or simulated streaming.
Stop aborts pending work and disposes the inference host. Idle resources are released on lifecycle suspension or by the two-minute
idle cleanup. Cold indexing depends on the number of discovered
controls; no loading state or embedding similarity represents task success.

Plans carry request, document and scan revision identifiers. Changed scans
trigger fresh planning with the original sentence retained. Task outcomes are
verified by the extension: checked/select state, visible section, declared
menu changes, or the clicked link's actual arrival. A search textbox focus is
intermediate; the query survives input and results, and a matching result must
arrive before the queue advances. Review boundaries block the queue; Skip
records skipped. Pause retains the queue and Stop cancels it.

Brief observation churn enters retained indexing/recovery instead of returning a
page-changed error to the composer. Native document/session rejection remains a
separate safety boundary. Technical control ambiguity is reduced using foreground
surface context and duplicate destinations; genuine intent ambiguity still asks
the user instead of guessing a consequential objective.

Suggestions are debounced and grounded in current controls, declared reveals
or observed routes. Predictions are route steps awaiting fresh binding, not
invented links or additional browsing-history collection. Historical routes
are rechecked against the current website. The optional browser-provided LLM remains
experimental and opt-in; embedding activity and LLM calls are reported separately.

The optional API mirrors only explicitly connected current-site knowledge.
SQLite is behind a storage port; inference runs outside Fastify's event loop.
The browser remains authoritative and backend failure falls back to local
processing. A bearer token and an explicit extension-origin allowlist protect
the single-owner API. Non-loopback connections require HTTPS. Default Tesseract
OCR provides low-evidence visual assistance in a separate worker; OCR evidence
cannot complete a task. Custom training, hosted inference, multilingual requests
and multi-user sync remain deferred.

See [contextual workflow architecture](../releases/v0.8.0/architecture.md) and the
[per-platform capability matrix](../releases/v0.8.0/capabilities.md) for v2 contracts,
private persistence rules, incremental frames and verification boundaries.
