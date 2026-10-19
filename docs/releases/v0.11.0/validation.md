# Tholi 0.11.0 validation

Prepared October 18, 2026. **Not certified for packaging.**

## This version

Local checks on October 18, 2026 used `0.11.0` metadata and freshly rebuilt
artifacts. Run identity: `version-0.11.0-2026-10-18`. The unit report is explicitly
PR-tier, focused evidence; it does not authorize packaging.

| Check                                                  | Result                                                                                             |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| Version consistency and strict TypeScript              | Passed                                                                                             |
| Unit suite                                             | 294 passed across 35 files, 62.5 s                                                                 |
| Demo, both extensions, website, API and fixture builds | Passed                                                                                             |
| Versioning regression                                  | Bump/pin/lock synchronization; missing notes, drift, invalid versions and mismatched tags rejected |
| Repository documentation/image links                   | 215 relative targets resolved                                                                      |
| External lockfile resolutions                          | All 421 entries unchanged                                                                          |
| Historical media, frozen inputs and existing archives  | No tracked changes                                                                                 |
| Full gate with historical evidence                     | Correctly rejected; current-version full evidence is still required                                |

Build tree digests (not archive checksums):

- Chromium: `2669f4184a644e234dace1991805d432fc39cb1cffc8dfda97f0044d142740f0`.
- Firefox: `71b66bdca5310ba3bbe66c6e0bc3b684f5963818c258b8669723b026c685ff80`.

The earlier `navigation-2026-10-18-final-v5` reports belong to pre-version `0.10.1`
artifacts and must not be relabeled. Complete browser/model/performance
certification was not repeated for the version bump. The new build manifest
cannot make historical acceptance or PR reports into release evidence.

## Release checklist

- [x] Types, version consistency and application builds pass on final source.
- [ ] Complete `npm run test:full` passes in one coordinated run against a frozen
      build, including unit, model, extension, UI, live-site and both browser acceptance
      groups, branded browser checks and paired performance budgets.
- [ ] `node scripts/verify-full.mjs` accepts all final target-specific evidence.
- [ ] Native installation, permissions and surfaces are recorded for Chrome,
      Edge, Brave and Firefox; accessibility and signed-in checks are reported honestly.
- [ ] Gated packagers create candidates without replacing existing archives.
- [ ] Candidate version, checksums, sizes and installation instructions are reviewed.
- [ ] Release commit/tag and public publication are deliberately performed.

No unchecked item is a pass. See [release notes](README.md) and
[the release procedure](../../development/releasing.md).
