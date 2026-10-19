# Browser platform ownership

The navigation core, discovery, verification, privacy rules, models and acceptance goals are shared. Browser differences belong in `apps/extension/src/platform`, with one background session owner and one UI snapshot subscription.

`api.ts` is the typed Mozilla `webextension-polyfill` boundary. Chromium-specific calls are feature-detected in adapters. Native document IDs remain mandatory; no synthetic document identity or URL-only fallback is allowed. Minimum engines are Chromium 140 and Firefox 153.

## Background and inference

Chromium runs the service worker and offscreen inference document. Firefox MV3 uses an event page with synchronous listener registration. Both call the same request/cancel/dispose host, which lazily owns NLP/OCR workers. Outstanding inference remains attached to its initiating message. Idle workers are released; there is no hidden tab or polling keepalive. Existing session hydration restores state.

Bundled MiniLM Q8, single-thread WASM, foreground prioritization, OCR inputs, caches and cancellation share code and budgets. Optional browser-provided AI is capability-gated rather than required. No remotely executed code or required backend is introduced.

## Settings and surfaces

Chromium preserves existing keys and protects `storage.local` with `TRUSTED_CONTEXTS`. Firefox has no access-level API: backend/vision settings use extension-origin IndexedDB (`tholi-private-settings`). Content scripts cannot read that database or request sidebar-only credentials. Requests, drafts and conversations remain in privileged session storage. Browser installations do not synchronize knowledge.

`sidebar.ts` maps `sidePanel` and `sidebarAction`. APIs requiring activation begin before asynchronous work. Firefox embeds have the content-script API subset: their snapshot listener uses the existing runtime port rather than tab events. Failed Dock retains the usable widget; Firefox asks for a toolbar action, validates the current session/document after native opening, then removes the widget. A disconnected UI port never proves dismissal.

Host permission requests use visible origin intent in a genuine user action, then revalidate the active tab/origin after approval. Selective grants, frame ownership, nonce-bound widget registration, masked capture and independent outcomes keep their existing owners.

## Builds and evidence

`config/extension-targets.mjs` derives manifests from the common definition. Chromium output stays `dist/extension`; Firefox output is `dist/extension-firefox`, with event-page scripts, `sidebar_action` and ID `tholi@ilunonsen.com`. Entrypoint filenames remain stable.

Evidence identifies target, browser/version, validation run and exact artifact digest. Full validation requires both unchanged acceptance matrices, Firefox boundary checks, branded surfaces and paired performance measurements. Chromium evidence cannot certify Firefox bytes. Packaging creates separate candidates only after the gates; existing archives remain immutable. See [testing](../development/testing/README.md) and [browser validation](../releases/v0.10.1/browser-support.md).
