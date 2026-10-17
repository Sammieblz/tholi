# Trust and lifecycle boundaries

Page text, observations, stored knowledge, documented predictions and model output are untrusted evidence. Every highlighted control requires a fresh document/element binding, eligible visibility, enabled state and matching signature. Model output cannot provide selectors, JavaScript, clicks or authoritative outcome claims. Exclusions and scope survive reinterpretation.

The extension uses `activeTab`, `tabs`, `scripting`, `sidePanel`, `storage`, `webNavigation` and `offscreen`. Default host grants cover English Wikipedia and local development. Other ordinary HTTP/HTTPS origins require specific site access. Installation does not grant every site. DOM permissions and viewport-capture permissions are tracked separately; Chrome may require renewed toolbar activation for capture.

Live sessions pin origin, tab, session and document identity. Expected document/authentication/popup handoffs retain the objective but require the actual permitted destination before repinning. Unrelated navigation pauses the retained task. Navigation metadata is scoped to active journeys, not general browsing history. Association with a redirect does not prove that login succeeded or that a destination is trustworthy.

Commands require the extension identity and appropriate extension-owned sender. Content updates require assigned tab/frame/document identity and validated contracts. Loading invalidates visible bindings; stale asynchronous results cannot restore an older document or complete a newer task. Pause remains paused through loads; Stop prevents reattachment. Resume requires fresh observation.

Users perform website clicks, field input, credential entry and submissions. Tholi may scroll a freshly bound target and display guidance. Automatic scrolling is canceled when the user intervenes. Review targets explain the consequential or unknown effect; a click only starts verification. Risk classification is heuristic and cannot establish arbitrary JavaScript/server behavior.

Completion requires fresh task-specific state: the requested selected preference, destination, item or status. Finding an entry point, opening a menu, OCR text, a changed image, unrelated success toast or user confirmation cannot independently prove completion. Skip is recorded as skipped. Predictions and saved routes never authorize stale controls.

OCR masks editable fields and all iframe rectangles. It accepts bounded images in temporary memory; visual-only targets retain unknown effects and manual review. Viewport changes invalidate guidance. Screenshot access does not confer authority to interact with the website. Closed roots, icon-only controls and opaque/unseen interfaces remain limitations.

The optional API binds loopback by default, requires a bearer token and explicit extension-origin CORS, and executes inference outside the API event loop. Self-hosted remote connections require HTTPS. Credentials stay in trusted extension contexts; private entities, input values and OCR payloads are not persisted or included in payload logs. See [privacy](privacy.md) and [API setup](api-setup.md).

Synthetic tests and Wikipedia checks do not constitute a security audit of arbitrary websites. Native Chrome access recovery and signed-in workflow verification remain separate pending checks.
