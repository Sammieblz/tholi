# Tholi 0.11.0 validation

Prepared October 18, 2026; final automated certification completed October 19.
**Both extension candidates are certified against one complete automated run.**
Native permission-prompt, screen-reader and signed-in checks remain pending.

## Final automated certificate

The complete cohort `43376f90-e8bc-4e4b-baa2-4b2eb84249a0` passed against the
frozen production build. All eleven documented full groups ran once under that
identity using `npm run test:full -- --group GROUP` and the prepared-build option;
the build manifest was verified before every group. Acceptance ran first for
feedback, followed by every remaining group. `node scripts/verify-full.mjs`
accepted the completed evidence. No earlier or focused reports were combined.

Tested source: `bb78d4ba775e25ed5da717cc0f3bda8b5c399fa9`. The subsequent
certificate documentation changes do not alter build inputs.

| Coverage                                                  | Result                                                 |
| --------------------------------------------------------- | ------------------------------------------------------ |
| Unit contracts, including consent and foreground recovery | 310 passed, 36 files                                   |
| NLP, multi-app and vision/OCR integration                 | 32 passed                                              |
| Core, integration and native Firefox browser checks       | 47 + 22 + 2 passed                                     |
| Extension and website UI                                  | 42 passed                                              |
| Native Chrome, Edge and Brave smoke checks                | 3 passed                                               |
| Paired Chromium/Firefox performance                       | Passed existing planning, OCR and Stop budgets         |
| Live-site regressions at both widths                      | 14 passed                                              |
| Chromium and Firefox acceptance                           | 12 groups and 90 frozen cases per target passed        |
| Firefox reviewer source reproduction                      | All 273 build files match, including maps              |
| Mozilla validator                                         | 0 errors, 12 bundled-code warnings with reviewer notes |

Final build digests (not ZIP checksums):

- Chromium: `c53f9ad28c0f6c8b59c18a0c10cea10c94036095691667558e4dda34ffc01357`.
- Firefox: `7cbe24d141ea71becbd15f8f20b83c747242200e73aa1386d6037828ed8d357f`.

`npm run package:extension` verified every member of both new archives against
the evaluated build, without rebuilding or replacing an existing archive:

| Candidate                  |      Bytes | SHA256                                                             |
| -------------------------- | ---------: | ------------------------------------------------------------------ |
| `tholi-0.11.0.zip`         | 29,016,851 | `8890438fbdade29ed1de81c577279b0729fd46520fa8516c9a6a6b0f731d26ce` |
| `tholi-firefox-0.11.0.zip` | 29,016,970 | `dc4c90e5a99b9c9561b365090937d5935ce47d058100f86f9cd38c38c16e317a` |

The GitHub prerelease carries the final assets and publication state. Store review,
Firefox signing, manual permission-denial/handoff, screen-reader speech and
signed-in workflows are separate pending checks. The documented busy-page limits
and frozen GitHub held-out mismatch remain; no universal website accuracy is claimed.

## October 20 Firefox AMO archive repair

AMO rejected the original Firefox candidate with `INVALID_XPI_ENTRY` for
`licenses\@babel_runtime-LICENSE`. Inspection found **244 backslash-containing
paths among 273 entries**. The original archive verifier normalized those names
before comparing hashes and therefore missed the invalid ZIP representation.
The earlier zero-error validator result above did not establish that the
uploaded ZIP was acceptable to AMO.

The archive writer now creates explicit forward-slash member names. Its readback
check rejects invalid/duplicate stored names and still verifies every file hash,
unexpected files and the existing empty-directory policy. A regression test
reproduced the original failure before the fix and passes afterward, including
scoped dependency licenses, nested paths, apostrophes, changed bytes and refusal
to overwrite an archive. All six release-tooling tests and TypeScript passed on
Windows with Node 24.19.0. These focused checks do not claim a new full cohort.

A **new, separately named upload candidate** was created from the original
certified Firefox ZIP. Its original checksum and full-certificate file map were
verified before repackaging; all 273 file hashes were verified again afterward.
The build digest remains
`7cbe24d141ea71becbd15f8f20b83c747242200e73aa1386d6037828ed8d357f`.
The manifest version `0.11.0`, Firefox ID and all extension file contents are
unchanged. This is a ZIP container repair using the original certified build,
not a rebuild or certification of the latest source tree.

| Upload candidate               |      Bytes | SHA256                                                             |
| ------------------------------ | ---------: | ------------------------------------------------------------------ |
| `tholi-firefox-0.11.0-amo.zip` | 29,016,970 | `580f7ec1e8241781aaaed95c1d30ce9cae2384508f8d080c2348f0f19fbc6dad` |

The new `.json` sidecar records the original archive/certificate hashes,
source revision, full-run identity, complete file map and local validator
report. The `.sha256` sidecar records the corrected container checksum.
Original Chromium, Firefox and source archives remain unchanged. The matching
reviewer source is still `tholi-source-0.11.0.zip`, SHA256
`060fc704330c90091b9734516325bad3f4761f2c51562605c44e6f19802fc9bc`.

Mozilla **addons-linter 10.14.0** checked both actual ZIPs:

- Original: **1 error**, `INVALID_XPI_ENTRY`, reproducing the store failure.
- Corrected: **0 errors, 0 notices and 12 warnings**: three `DANGEROUS_EVAL` and
  nine `UNSAFE_VAR_ASSIGNMENT` bundled-code warnings. These still need reviewer
  explanation; a local validator pass does not establish approval or signing.

Reports are under `output/qa/firefox-amo-repack-qbdV4i`, named
`addons-linter-original.json` and `addons-linter-corrected.json`. The original
full run remains `43376f90-e8bc-4e4b-baa2-4b2eb84249a0`; no new full-run identity
was invented. The corrected ZIP has not been uploaded to AMO or attached to a
GitHub release by this repair.

## Earlier version preparation

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
- [x] Complete `npm run test:full` passes in one coordinated run against a frozen
      build, including unit, model, extension, UI, live-site and both browser acceptance
      groups, branded browser checks and paired performance budgets.
- [x] `node scripts/verify-full.mjs` accepts all final target-specific evidence.
- [ ] Native installation, permissions and surfaces are recorded for Chrome,
      Edge, Brave and Firefox; accessibility and signed-in checks are reported honestly.
- [x] Gated packagers create candidates without replacing existing archives.
- [x] Candidate version, checksums, sizes and installation instructions are reviewed.
- [ ] Complete browser-store review and Firefox signing. GitHub release assets
      record the separate prerelease publication state.

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
