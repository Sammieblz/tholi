# Extension ownership

`src/entries` contains browser entrypoints. The build preserves `worker.js`, `content.js`, `frame-agent.js`, `offscreen.js`, `inference.js`, `ocr-worker.js`, `sidepanel.js` and `theme-page.js` names.

`background/worker-runtime.ts` initializes storage, one pinned session and service composition. Memory persistence, vision requests, journey planning, session attachment, runtime message validation, frame coordination and browser navigation events have separate owners in `background`. Services receive live access to the same state. They do not maintain parallel session caches or journey owners. Mutable access stays explicit through typed contexts; cross-service work stays serialized through the existing queue.

`content/runtime.ts` installs the top-frame runtime. `PageCoach` remains the orchestration facade: observation composition, outcome verification and plan lifecycle live alongside it. Frame agents and visual guidance remain content responsibilities. Only freshly observed, authorized controls may be bound; no service extraction relaxes review or completion predicates.

`inference/offscreen-client.ts` transports bundled NLP/OCR requests; `nlp-worker.ts`, `ocr-worker.ts` and `offscreen-runtime.ts` implement the local pipeline. `browser-language-model.ts` is the distinct optional browser model. Platform permissions and optional backend transport live in `platform`.

`ui/hooks/useSessionSnapshot.ts` owns the single snapshot subscription and bounded fallback. `usePresentationSession.ts` owns trusted draft/history hydration and revision protection. `useBackendSettings.ts` reads sidebar-only advanced settings. Conversation and optional model actions are feature-owned; the controller composes them. Appearance remains owned by `ui/theme`. No extraction adds a second polling loop or task owner.
