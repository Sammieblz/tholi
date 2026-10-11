# Authored routes and live sessions

The bundled registry contains the two controlled Northstar regression routes. Add authored packs under routes and register them in packages/route-registry/index.ts. Packs require unique IDs, pinned versions, exact allowed origins, states, transitions and explicit safety boundaries. Validated copies prevent accidental mutation. Missing versions never fall back silently.

The worker also exposes navigator.live version 1.0.0 dynamically for HTTP/HTTPS pages. This is a live navigation mode, not a fabricated authored route graph. Its observations and goal plans use packages/page-model contracts. Generic discovery, user-observed transitions and persistent memory supply its route knowledge.

START pins the origin, tab, session UUID and document ID. Active/paused sessions must be stopped before changing mode. Generic views must contain valid, unique control IDs; selected IDs must belong to the visible enabled control list, which must match the current observation. Authored views reject generic page/control/goal payloads. Both modes reject route/version substitution and malformed restoration.

Live sessions reattach across same-origin documents with fresh control IDs. Loading clears controls, Pause survives navigation, and Stop prevents reattachment. Authored demo tasks stop on full-document navigation. Site permission is independent of the task registry; adding a route does not grant access.
