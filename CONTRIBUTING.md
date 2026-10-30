# Contributing to Tholi

Use Node **24.19.x** and its npm. Run `npm ci`, then `npm run check`. Builds fetch and verify the pinned default model assets automatically. Load `dist/extension` in Chromium or temporarily install `dist/extension-firefox/manifest.json` through Firefox about:debugging. Refresh website tabs after rebuilding. See [browser setup](docs/guides/getting-started.md).

## Names and metadata

Use **Tholi** in product copy, documentation, demo labels and generated report filenames. The root package owns the canonical repository URL. Existing scoped packages, storage keys, environment variables and protocol identifiers retain their legacy names for compatibility. See [the naming reference](docs/development/naming.md) before renaming an identifier or an artifact.

## Component boundaries

Frontend features, styles, routing, and controller ownership are described in [frontend architecture](docs/architecture/frontend/README.md). Keep feature CSS colocated and shared presentation free of browser APIs. Follow the [motion contract](docs/releases/v0.10.1/ui-audit.md) for stable steps, reduced motion, and keyboard interactions.

The shared navigation core owns validated requests, retrieval/planning orchestration, queues and workflows. NLP owns interpretation and CPU embeddings. The extension owns discovery, binding, permissions, lifecycle and outcome verification. The optional API uses the same core with inference outside its event loop. See [architecture](docs/architecture/navigation.md).

Keep website-specific selectors in independent test oracles. Workflow packs may describe sourced semantic milestones, prerequisites and outcome predicates; they must not encode fixed selectors, account URLs or coordinates. Never read editable values or credentials into discovery, knowledge or embeddings. Similarity, OCR confidence and clicks cannot establish completion or bypass review boundaries.

TypeScript rejects unused locals and parameters. Build hashing is shared by test reporters and packaging in `scripts/artifact-files.mjs`; keep its recursive ordering consistent. Keep signed-in fixture evidence separate from real-site verification.

## Focused checks

| Change                                           | Command                            |
| ------------------------------------------------ | ---------------------------------- |
| Types, core/discovery/lifecycle                  | `npm run typecheck`, `npm test`    |
| NLP and v1 API                                   | `npm run test:nlp`                 |
| Workflow/privacy/migration and v2 API            | `npm run test:multi-app`           |
| OCR service, cancellation and bounds             | `npm run test:vision`              |
| Shared UI, widget and website                    | `npm run test:ui`                  |
| Queue, clarification and search browser behavior | `npm run test:nlp:browser`         |
| Dynamic controls, frames and performance         | `npm run test:multi-app:browser`   |
| Return routing, restart and browser OCR          | `npm run test:continuity:browser`  |
| Prime continuity and offline UI-image OCR        | `npm run test:reliability:browser` |

Install browser binaries once with `npx playwright install chromium firefox`. Run browser/model suites sequentially on memory-constrained machines. `npm run build:extension:experimental:paddle` includes Paddle/OpenCV for evaluation; the normal build removes their inactive assets. A failed experiment must never be counted as a passing default-engine gate.

For backend container changes, run `npm run test:local-stack -- --optional` with
the Linux Docker engine running. The [local stack guide](docs/development/local-stack.md)
describes startup, synthetic credentials, retained volumes and explicit resets.
This smoke is also a required Linux PR job; ordinary unit checks need no daemon.

## CI and releases

Follow [versioning and releases](docs/development/releasing.md). Create version-specific notes under `docs/releases/vVERSION`, then run `npm run release:version -- VERSION`. `npm run check:version` rejects drift between product, API, workspace and extension metadata or a mismatched CI tag. Keep historical evidence and capture versions unchanged.

Use `npm run test:ci` for deterministic PR checks and `npm run test:full` before certification. The full command runs all retained coverage against one build, then verifies evidence. PR/main workflows preserve the required `validate` aggregate; nightly/manual/tag runs perform full validation. See [testing and CI](docs/development/testing/README.md) and [coverage ownership](docs/releases/v0.10.1/coverage-ledger.md).

Package with `npm run package:extension` and `npm run package:api` only after complete full-tier evidence from the same run and final bytes. Do not rebuild afterward or overwrite existing archives. Focused runs do not collectively certify a release. Native Chrome and signed-in checks remain separately recorded in [the handoff checklist](docs/guides/getting-started.md).

Frozen inputs live under `tests/fixtures`, with the acceptance declaration in `tests/browser/acceptance/matrix.json`. Preserve original bytes, splits, hashes and thresholds. Calibration changes require explicit versioning and independent review. Never regenerate expectations from predictions. `.gitattributes` pins LF for recording text and frozen JSON; checkout integrity is tested independently of the worktree.

Store no authenticated screenshots/traces by default. Private values remain session-only. Original knowledge and reusable routes survive migrations; derived indexes can rebuild. See [privacy](docs/architecture/privacy.md) and [security](docs/architecture/security.md).

New archives use `tholi-VERSION.zip`, `tholi-firefox-VERSION.zip` and `tholi-api-VERSION.tgz`. Legacy archives remain immutable with truthful checksums; both packagers reject already released versions under either naming convention.

## Avoiding duplication

Search implementation and tests first. Extend the existing owner. Keep permanent tests only for distinct ongoing contracts/regressions. Remove temporary probes after verification. Extract shared code for demonstrated reuse, not hypothetical future use.
