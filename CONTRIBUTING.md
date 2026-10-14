# Contributing

Use Node **24.19.x** and its npm. Run `npm ci`, then `npm run check`. Builds fetch and verify the pinned default model assets automatically. Load `dist/extension` unpacked in Chrome and refresh website tabs after rebuilding.

## Component boundaries

The shared navigation core owns validated requests, retrieval/planning orchestration, queues and workflows. NLP owns interpretation and CPU embeddings. The extension owns discovery, binding, permissions, lifecycle and outcome verification. The optional API uses the same core with inference outside its event loop. See [architecture](docs/live-navigation.md).

Keep website-specific selectors in independent test oracles. Workflow packs may describe sourced semantic milestones, prerequisites and outcome predicates; they must not encode fixed selectors, account URLs or coordinates. Never read editable values or credentials into discovery, knowledge or embeddings. Similarity, OCR confidence and clicks cannot establish completion or bypass review boundaries.

TypeScript rejects unused locals and parameters. Build hashing is shared by test reporters and packaging in `scripts/artifact-files.mjs`; keep its recursive ordering consistent. Keep signed-in fixture evidence separate from real-site verification.

## Focused checks

| Change                                           | Command                            |
| ------------------------------------------------ | ---------------------------------- |
| Types, core/discovery/lifecycle                  | `npm run typecheck`, `npm test`    |
| NLP and v1 API                                   | `npm run test:nlp`                 |
| Workflow/privacy/migration and v2 API            | `npm run test:multi-app`           |
| OCR service, cancellation and bounds             | `npm run test:vision`              |
| Queue, clarification and search browser behavior | `npm run test:nlp:browser`         |
| Dynamic controls, frames and performance         | `npm run test:multi-app:browser`   |
| Return routing, restart and browser OCR          | `npm run test:continuity:browser`  |
| Prime continuity and offline UI-image OCR        | `npm run test:reliability:browser` |

Install browser binaries once with `npx playwright install chromium`. Run browser/model suites sequentially on memory-constrained machines. `npm run build:extension:experimental:paddle` includes Paddle/OpenCV for evaluation; the normal build removes their inactive assets. A failed experiment must never be counted as a passing default-engine gate.

## Release checks

CI runs the focused suites plus `npm run test:e2e -- --workers=1`, `npm run test:live:wikipedia` and `npm run test:acceptance`. Package with `npm run package:extension` and `npm run package:api` only after all required reports match the final build. Do not rebuild after evaluation or overwrite existing archives. Native Chrome and signed-in checks remain separately recorded in [the handoff checklist](docs/chrome-handoff.md).

Frozen corpora live in `tests/nlp`, `tests/multi-app`, `tests/continuity`, `tests/reliability-vision` and `tests/acceptance`. Keep existing inputs, splits, hashes and thresholds intact. Tune only calibration data; corpus changes need explicit versioning and independent annotation review. Do not regenerate expectations from predictions.

Store no authenticated screenshots or traces by default. Private entity text and values stay session-only, including their vectors. Original knowledge and reusable routes survive migrations; derived data can be rebuilt. See [privacy](docs/privacy.md) and [security](docs/security.md).
