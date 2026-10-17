# Working on Tholi

## Before editing

1. Search existing implementation and tests before adding either.
2. Extend the existing owner instead of layering a parallel implementation.
3. Retain permanent tests only for distinct ongoing behavior, contracts or regressions.
4. Remove temporary diagnostic probes after verification.
5. Extract shared code for demonstrated reuse, not hypothetical future use.

## Boundaries

The background runtime owns the single pinned session and journey. Content runtime observes, binds and verifies. `packages/ui` is presentation without browser privileges. The website practice uses an isolated adapter and mock accounts; it cannot own extension state. Preserve generated entrypoint filenames, public contracts, stored identifiers, host grants, consequential-action review, OCR masking and frozen corpora. A click or animation never establishes arrival.

Keep React, Base UI, Iconoir and the existing tokens. For visual UI work, read applicable project-local skills from `.codex/skills` and record specific guidance and validation; provenance is in `.codex/skills-manifest.json`. This does not require unrelated suites for a nonvisual change. Keep upstream skill files outside production assets and unchanged.

## Validation

Run focused existing checks during implementation. `npm run test:ci` is the deterministic PR gate. `npm run test:full` is full certification, required before packaging. Both build once; use the documented prepared-build option only with immutable, verified build artifacts. PR or independently collected evidence cannot authorize a release. Native Chrome, screen-reader and signed-in checks stay pending until performed.

See [testing and CI](docs/development/testing/README.md), [coverage ownership](docs/releases/v0.10.1/coverage-ledger.md) and [architecture](docs/architecture/README.md). Keep documentation links and website article aliases updated when moving an owner. Do not publish, deploy or overwrite an existing archive without explicit authorization.
