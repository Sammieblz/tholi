# Bundled route registry

Add declarative route packs under routes and register them in packages/route-registry/index.ts. Each route needs a unique ID, an exact version, allowed origins, states, transitions and safety boundaries. The registry validates every pack at startup and returns copies so callers cannot mutate its stored definitions. Unknown versions fail lookup; they never fall back to another version.

Supply siteName, description, milestones, milestoneStates, safetyNote, completionInstruction and boundaryInstruction for task previews and guidance. Milestone mappings must reference declared states and valid milestone indexes. Terminal instructions belong to the route, so a read-only task can finish without cancellation-specific wording.

The worker filters previews by the active tab’s exact origin. START selects a route ID/version and pins it with a tab ID and unique session token. Active or paused sessions must be stopped before selecting another task. The content script accepts only matching control tokens, and the worker checks updates against the pinned route, version, tab, origin and known state/history IDs. Restoration rejects malformed sessions and missing route versions.

Keep safety boundaries in the route definition. Adding a registry entry does not grant host access or authorize live-site coverage. Add meaningful route fixtures and browser scenarios before presenting a new route as verified.
