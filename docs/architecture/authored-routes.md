# Authored regression routes

See routes/demo/cancellation.ts and packages/route-schema/index.ts. Declare exact origins, task/version metadata, start states, role/name/context landmarks, user transitions, expected next states and success/boundary instructions. Target synonyms support known variants. Tied candidates stop instead of choosing by DOM order. Coordinates only position passive guidance.

Final irreversible-action states are terminal boundaries with no outgoing transitions. Login states are checkpoints. Success requires visible declared evidence; a click does not advance the route by itself. Use synthetic fixtures and record verification only after checks pass.

State landmarks support authored selector constraints, absence predicates and full-viewport checks. Target stableSelector is an additional constraint that never replaces semantic evidence. Invalid selectors produce no match. allowQuery:false excludes query variants. Exact URL paths and explicit urlPrefixes constrain applicable screens. anyName is accepted only for heading predicates with a selector; transition targets require semantic names.

Live navigation does not require an authored route per website. Extend the generic discovery/planning contracts and verification when a new semantic control type is needed. See [live-navigation.md](navigation.md). The superseded Wikipedia route packs, fixed article sample list, site-specific coach, URL policy and scope/continueOnNavigation fields have been removed.

## Registry and live-session contracts

The bundled registry contains the two controlled Northstar regression routes. Add authored packs under routes and register them in packages/route-registry/index.ts. Packs require unique IDs, pinned versions, exact allowed origins, states, transitions and explicit safety boundaries. Validated copies prevent accidental mutation. Missing versions never fall back silently.

The worker also exposes navigator.live version 1.0.0 dynamically for HTTP/HTTPS pages. This is a live navigation mode, not a fabricated authored route graph. Its observations and goal plans use packages/page-model contracts. Generic discovery, user-observed transitions and persistent memory supply its route knowledge.

START pins the origin, tab, session UUID and document ID. Active/paused sessions must be stopped before changing mode. Generic views must contain valid, unique control IDs; selected IDs must belong to the visible enabled control list, which must match the current observation. Authored views reject generic page/control/goal payloads. Both modes reject route/version substitution and malformed restoration.

Live sessions reattach across same-origin documents with fresh control IDs. Loading clears controls, Pause survives navigation, and Stop prevents reattachment. Authored demo tasks stop on full-document navigation. Site permission is independent of the task registry; adding a route does not grant access.
