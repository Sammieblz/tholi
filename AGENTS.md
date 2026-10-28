# Working on Tholi

These instructions apply recursively throughout the repository. For roadmap #23, work in issue sequence and use each issue's acceptance criteria to bound the change. Keep repository guidance here as a single source instead of copying it into nested memory files.

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

Use [the release procedure](docs/development/releasing.md) for version changes. Keep the root, bundled workspaces, API, extension and lockfile synchronized with `release:version`; add `docs/releases/vVERSION` notes and validation status. Do not relabel historical reports, media or downloads as evidence for a new version.

Run focused existing checks during implementation. `npm run test:ci` is the deterministic PR gate. `npm run test:full` is full certification, required before packaging. Both build once; use the documented prepared-build option only with immutable, verified build artifacts. PR or independently collected evidence cannot authorize a release. Native browser permission, screen-reader and signed-in checks stay pending until performed.

See [testing and CI](docs/development/testing/README.md), [coverage ownership](docs/releases/v0.10.1/coverage-ledger.md) and [architecture](docs/architecture/README.md). Keep documentation links and website article aliases updated when moving an owner. Do not publish, deploy or overwrite an existing archive without explicit authorization.

Browser APIs belong behind the typed WebExtensions boundary and platform adapters. Keep one shared engine, worker settings and safety budgets across targets. Never replace native document identity with a URL or synthetic identity, or use Chromium evidence to certify Firefox artifacts.
