# Tholi naming and repository maintenance

**Tholi** is the product name. The canonical repository is [`Sammieblz/tholi`](https://github.com/Sammieblz/tholi). A checkout may use any local folder name; it is not a public product identifier. The operator is **ILUNỌNSEN LLC**, Ohio, United States. No public Tholi domain has been selected in this repository.

## Names and sources of truth

| Surface                           | Current source                                  | Rule                                                                                                                                |
| --------------------------------- | ----------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------- |
| Root npm project                  | `package.json`                                  | Private project name `tholi`, source version 0.10.1, company attribution and canonical repository URL.                              |
| Chrome extension                  | `apps/extension/manifest.json`                  | Display name **Tholi**, toolbar title **Open Tholi**, source version 0.10.1 and generated Tholi icons.                              |
| Website source links              | `apps/web/src/config/project.ts`                | Derive from the root package repository metadata, including documentation source paths.                                             |
| Company/contact information       | `apps/web/src/features/legal/operator.ts`       | Shared with the footer; public origin remains configurable.                                                                         |
| Optional API                      | `apps/api/package.json`                         | OpenAPI and health metadata read the API's own version, currently 0.10.0. The displayed name is **Tholi single-owner API**.         |
| Future extension/backend archives | Existing gated packagers                        | `tholi-VERSION.zip` and `tholi-api-VERSION.tgz`. Existing archives under either naming convention block reusing a released version. |
| Website download                  | Generated `apps/public/downloads/manifest.json` | Read the version, filename and checksum of the eligible archive. Source and download versions can differ.                           |

Workspace versions are component versions; they do not all advance when presentation changes. The current eligible download is the original 0.10.0 archive. A filename change does not create a new release or make old validation apply to new bytes.

## Compatibility identifiers

Retain these identifiers until an explicit, tested migration is requested:

- `@internet-navigator/*` workspace/package names and dependency references, including the optional distributable API. Their descriptions identify Tholi.
- `NAVIGATOR_*` environment variables, `.navigator-api`, existing SQLite/IndexedDB names, trusted storage keys and route IDs.
- `#internet-navigator-overlay`, `navigator.live`, message types and diagnostic format tags. Discovery, masking and older sessions rely on these identifiers.
- Historical release filenames, media provenance, frozen corpora and dated validation reports. These are evidence, not current product copy.
- Browser APIs such as `navigator.clipboard` and the TypeScript `Navigator` interface.

The download synchronizer accepts both `internet-navigator-VERSION` and `tholi-VERSION` records, verifies archive checksums, and selects the newest eligible version. It removes older files only from the generated website mirror; original release archives remain immutable.

## October 16, 2026 audit

Reviewed root/workspace JSON metadata, the Chrome manifest and HTML titles, build/package/download scripts, current documentation, website source links, demo labels, notices and supplied brand/media assets.

- Rebuilt the entry README around the supplied wordmark, icon and genuine extension captures. Consolidated repeated source/download notes, feature explanations and setup instructions; linked detailed technical material to its owning document.
- Grouped the documentation index by use, development, design records and historical evidence. Moved the versioned capability matrix into historical references.
- Replaced old visible branding in the demo, API, current docs, authentication/review/recovery messages, authored fixture instructions and exported route-report filename. Removed the API's duplicated stale OpenAPI version.
- Consolidated repeated source URLs and documentation path prefixes into root package metadata. Reused existing operator metadata in the footer.
- Kept the already correct Chrome name/icons, package compatibility identifiers, original attribution and evidence intact. Added current Tholi package descriptions and future archive naming without changing release gates.
- Updated API-settings and launcher-removal instructions to match the current interface.

For README presentation, applied project-local Baseline UI hierarchy/restraint and UI UX Pro Max's descriptive-image-text guidance. Existing brand assets and genuine captures are reused without recoloring or simulated UI. No new UI components or animation behavior were introduced by this maintenance pass.

## Validation

- All **98 tracked JSON files** parse; **139 local documentation/image links across 36 Markdown files** resolve. Exact-file comparison of 236 tracked source/documentation files found no duplicate groups.
- Strict TypeScript and **250 unit tests across 33 files** pass on the final source. The added download regression exercises legacy/new names, newest-version selection, immutable originals and checksum rejection.
- Demo, default extension, website and optional API builds pass. The final unpacked extension is **62,761,209 bytes**, below 100 MiB. Its name, version and icon paths are valid.
- The focused real-model/API test passes, including authenticated OpenAPI branding/version, parity, persistence and deletion. This does not claim a new complete NLP release evaluation.
- The complete UI suite passes **29/29 in 4.2 minutes**, with matching extension and website evidence in `output/qa/ui-build.json`. It covers Guide/Conversation, widget continuity, layout, theme adaptation, website routes at four widths in both themes, docs, onboarding, downloads, cookies and motion.
- Workspace links resolve. The dependency lock changed only its two root-name fields, without dependency upgrades. Frozen corpora and release archives are unchanged. The eligible 0.10.0 download still matches SHA-256 `33eefaef6927d533d8c6a7322dbc0b7f3ccb82db7d6a93e52d4a9d18714a829e`.
- Whitespace checks pass. No new ZIP or backend archive was released. Native Chrome, screen-reader and signed-in workflow checks remain separate pending work.
