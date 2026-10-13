Version 0.8.0 supports English requests on English interfaces. Compromise
parses the entire validated request before retrieval, preserving ordered tasks,
negation, corrections and desired values. The maximum is 1,000 characters and
three explicit tasks. Unresolved references require an explicit target.

The shared core combines BM25, normalized mean-pooled MiniLM vectors and the
existing semantic/observed-route planner. Index text contains sanitized labels,
descriptions, roles, headings, regions, form purpose and reveal relationships.
Visibility, enabled state, risk and checked state are freshly validated and
never encoded as semantic cache identity. SHA-256 plus the pinned model revision
keys the global 10,000-entry derived cache. Browser IndexedDB v4 preserves public sites and reusable routes while removing
private entity data from older platform indexes; derived indexes are rebuilt.

The extension runs packaged q8 ONNX weights in a worker owned by a Chrome
offscreen document. ONNX uses one CPU thread, a packaged WASM backend and no
remote models. Foreground planning preempts suggestions between model calls.
Stop aborts pending work and closes the offscreen document. Idle resources are
unloaded after two minutes. Cold indexing depends on the number of discovered
controls; no loading state or embedding similarity represents task success.

Plans carry request, document and scan revision identifiers. Changed scans
trigger fresh planning with the original sentence retained. Task outcomes are
verified by the extension: checked/select state, visible section, declared
menu changes, or the clicked link's actual arrival. A search textbox focus is
intermediate; the query survives input and results, and a matching result must
arrive before the queue advances. Review boundaries block the queue; Skip
records skipped. Pause retains the queue and Stop cancels it.

Suggestions are debounced and grounded in current controls, declared reveals
or observed routes. Predictions are route steps awaiting fresh binding, not
invented links or additional browsing-history collection. Historical routes
are rechecked against the current website. The optional Chrome LLM remains
experimental and opt-in; embedding activity and LLM calls are reported separately.

The optional API mirrors only explicitly connected current-site knowledge.
SQLite is behind a storage port; inference runs outside Fastify's event loop.
The browser remains authoritative and backend failure falls back to local
processing. A bearer token and an explicit extension-origin allowlist protect
the single-owner API. Non-loopback connections require HTTPS. OCR, custom
training, hosted inference, multilingual requests and multi-user sync remain
outside this release.

See [contextual workflow architecture](v0.8.0-architecture.md) and the
[per-platform capability matrix](v0.8.0-capabilities.md) for v2 contracts,
private persistence rules, incremental frames and verification boundaries.
