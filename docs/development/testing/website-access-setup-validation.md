# Website access setup change

## Scope

This record covers the user-authorized website-access change on
`website-access-setup`. It is separate from earlier extension, website and
Mac/BYOK validation reports. It does not certify or modify an existing archive,
store listing, deployed website or release version.

Both source manifests request `http://*/*` and `https://*/*` as required hosts.
There is no Wikipedia/localhost exception or optional-host list. The browser
still owns site restrictions and revocation. Ordinary Start, Resume and
exploration check current access without opening a permission request.

The visible **Enable website access** action requests both schemes in one user
gesture for setup/recovery. Subsequent guidance checks the current browser grant,
tab and origin before use. This grants no cloud-processing, private-learning or image
upload consent. Native document identity, frame access and independent outcome
verification remain separate requirements.

## Documentation review

The active help, source setup, architecture, privacy and store-reviewer documents
now describe broad requested access, browser-managed restrictions and explicit
recovery. They no longer promise a per-website request or a Wikipedia/local-only
default. Existing help headings and historical release/archive evidence remain
unchanged.

The documentation review applies
[fixing-accessibility](../../../.codex/skills/fixing-accessibility/SKILL.md): use
the visible control's accessible name, give ordered confirmation instructions
and keep the change focused. This does not establish keyboard behavior, focus,
announcements or actual assistive-technology speech.

## Validation status

| Check                                                              | Status                                                                            |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| Search active docs for superseded per-site/default-host claims     | Performed; active claims corrected                                                |
| Preserve historical release reports, artifacts and version numbers | Documentation edits leave them unchanged                                          |
| Match canonical manifest and shared permission owner               | Source reviewed; broad host patterns and explicit recovery owner present          |
| Focused source/unit checks                                         | 79 lifecycle/access, 51 safety/frame/capture and 11 website checks passed         |
| TypeScript, version consistency and production build               | Passed in the local PR cohort below                                               |
| Complete unit gate                                                 | 1,290 checks passed in 94 files                                                   |
| Complete browser PR gate and native platform matrix                | Required source-bound PR checks; see the branch's workflow results                |
| Store install/update warnings and native recovery dialogs          | Pending manual native checks                                                      |
| Keyboard focus and responsive recovery layout                      | Browser assertions in the existing activation owner, separate from native dialogs |
| Screen-reader speech                                               | Pending manual checks                                                             |
| Release certification, packaging, publication and deployment       | Not performed by this change                                                      |

The earlier `c1fcadf` configured-website cohort is evidence for its original
artifacts. It is not evidence for the changed website-access manifest or setup
flow. Record new run identifiers, target/browser versions and build digests here
only after those checks occur. The source-bound
[PR workflow results](https://github.com/Sammieblz/tholi/actions/workflows/ci.yml?query=branch%3Awebsite-access-setup)
own the complete browser gate and each independent macOS target; the local
cohort below is Windows evidence.

## Fresh local evidence

The local PR coordinator run is `3b583f8b-b561-4415-9135-b2aba98053aa`.
Its build, type/version checks and 1,290 unit checks passed. The same frozen
artifacts are used for the remaining browser groups. Final coordinator results
are retained in `output/qa/timing-ci-all.json` and the pull request validation
summary. The target digests recorded by the unit reporter are:

- Chromium: `44fe023d74dc5a07add28b81f7ff8acc9ed2366bd0707ca74d97ebed4fac1d32`.
- Firefox: `c75a7c8e1a805385a2ed8a103a413feebef4e443ef0909965d2b4a563171e23f`.

Focused lifecycle/access checks passed 79/79 in run
`048238be-6d27-4782-a496-3b02dd574629`. Backend consent checks passed 10/10
in run `692e77e5-973e-4d4b-bd70-07b292a96344`, including the two new
disabled-processing cases. Website docs, SEO and onboarding checks passed 11/11
in `output/qa/website-access-setup-website-unit.json`. These focused reports do
not substitute for the complete PR gate.

The earlier local attempt `17874b56-eb90-4d4d-9f79-ebab570ad747` passed
all unit cases, then stopped at browser discovery because the shared manifest
JSON import lacked Node's required import attribute. The import was corrected
and the coordinator restarted with a fresh identity and build. The original
timings and unit result remain in `output/qa/website-access-setup-attempt1/`;
they are not relabeled as results from the corrected run.

## First hosted cohort and follow-up

[Run 42259172766](https://github.com/Sammieblz/tholi/actions/runs/42259172766)
evaluated source `9d373b291c3ccada073241276e8340c2fdcce50f`. Its build,
container checks, 1,290 unit checks and all 148 ordinary browser checks passed:
56 core, 20 integration, 5 native Windows Firefox and 67 UI cases. Both Apple
Silicon macOS targets passed 9/9 native cases. Each Intel macOS target passed
8/9, with the private-learning fixture reporting closed settings after its
changed-structure fallback. This cohort is incomplete and does not establish
passing Intel macOS validation.

The same local coordinator passed core 56/56 and integration 20/20, then failed
before Firefox startup with Selenium's `instanceof` constructor error. A
separate prepared-build UI run, `6b2f99d7-eeb6-4fe1-9b11-1e80f333848e`,
passed 67/67. A fresh-cache diagnostic passed the actual Firefox frame/restart
case; that observation does not identify the loader failure's cause or replace
the five-case cohort. The temporary loader probe was removed. Automatic
approval review blocked an additional clean local Firefox cohort before
execution with only "blocked by policy"; it was not retried.

The Intel settings failure is being investigated with bounded, content-free
test diagnostics. Native input, readiness outcomes and timeouts remain
unchanged. Final implementation must remove temporary probes and record a new
source-bound passing cohort before this PR is marked ready.
