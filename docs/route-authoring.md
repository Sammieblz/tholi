# Authored regression routes

See routes/demo/cancellation.ts and packages/route-schema/index.ts. Declare exact origins, task/version metadata, start states, role/name/context landmarks, user transitions, expected next states and success/boundary instructions. Target synonyms support known variants. Tied candidates stop instead of choosing by DOM order. Coordinates only position passive guidance.

Final irreversible-action states are terminal boundaries with no outgoing transitions. Login states are checkpoints. Success requires visible declared evidence; a click does not advance the route by itself. Use synthetic fixtures and record verification only after checks pass.

State landmarks support authored selector constraints, absence predicates and full-viewport checks. Target stableSelector is an additional constraint that never replaces semantic evidence. Invalid selectors produce no match. allowQuery:false excludes query variants. Exact URL paths and explicit urlPrefixes constrain applicable screens. anyName is accepted only for heading predicates with a selector; transition targets require semantic names.

Live navigation does not require an authored route per website. Extend the generic discovery/planning contracts and verification when a new semantic control type is needed. See [live-navigation.md](live-navigation.md). The superseded Wikipedia route packs, fixed article sample list, site-specific coach, URL policy and scope/continueOnNavigation fields have been removed.
