# Route authoring

See routes/demo/cancellation.ts and packages/route-schema/index.ts. Declare exact allowed origins, task/version/freshness, supported start states, semantic state predicates, transitions and success states. Prefer required role/name landmarks combined with URL and modal state. Target names may include known variants; tied candidates stop rather than choosing by DOM order. Coordinates are visual placement only.

Every transition is actor=user, has an expected target and next state, and times out into relocalization or stop. The first prototype supports exact paths and role/name/synonym/context matching. More general URL patterns, weighted route metadata, tested selector fallbacks and history predicates remain planned extensions of the schema. Do not advertise routes requiring those features yet.

Mark final irreversible-action screens as boundary and never author outgoing transitions from them. Mark login as checkpoint. Success requires visible route-defined landmark evidence. Use fictional/sanitized fixtures and record actual verification date only after tests pass.
