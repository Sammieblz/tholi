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

### October 19 performance follow-up

The October 18 artifact digests above have been superseded. The subsequent
[performance record](performance.md) identifies the full PR cohort, the final
cache adjustment, its targeted checks and the current target digests. They remain
separate evidence cohorts; this is not a complete final-byte release certificate.
Earlier measurements remain historical rather than relabeled passes.

### Remaining release gates

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

## October 19 store preparation

The merge audit passed strict TypeScript and 299 unit tests. Store preparation
then added Firefox's optional backend data declaration and native consent checks
before every backend request. Local guidance requires no data-transmission grant.
The focused consent/navigation checks pass (14 tests); types and version checks
pass. Firefox conformance now also checks that a saved disabled connection cannot
be enabled without native data consent.

An initial full run built both targets and passed the unit and model/OCR groups,
but was deliberately stopped before completion to correct the Firefox manifest.
It is not certification for these changed bytes. A new complete coordinated full
run remains required before packaging. Mozilla's preliminary validator reported
no errors and 13 warnings on the earlier build, including the missing declaration
and bundled-code warnings. Retain fresh validator output for the final build.

### Foreground planning follow-up

The subsequent full attempt passed unit, model, core, integration, Firefox,
UI, branded-browser and paired performance groups, then failed both reported-page
live cases. Older automatic recovery could pause the session and dispose the
inference channel while a new foreground destination was planning. That attempt
does not certify a release.

The background now fences superseded planning and temporarily holds content
recovery during a trusted foreground request. Matching release messages resume
recovery; older releases, Pause and Stop cannot revive canceled work. Five new
regression cases cover these contracts within the existing lifecycle owners.
The focused lifecycle suites pass all 37 cases, and both reported-page viewport
reproductions pass with the isolated fix. Full certification must run again on
the final source and frozen build; those focused results cannot authorize packaging.

A later complete attempt passed all earlier groups and both reported-page cases,
then failed one narrow Casino Royale search sample because the acceptance adapter
asserted guidance immediately after a retained-request acknowledgement. The shared
positive-contract runner now waits up to ten seconds for that same request to
produce guidance before applying the unchanged target and independent outcome
oracles. Both focused repetitions pass; their incomplete matrix report still
rejects certification. Frozen cases, thresholds and negative-contract checks are
unchanged. A fresh coordinated full cohort remains required.
