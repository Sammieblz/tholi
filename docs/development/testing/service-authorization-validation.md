# Workspace authorization verification, October 30, 2026

Scope: [#31](https://github.com/Sammieblz/tholi/issues/31), following accepted
identity [PR #69](https://github.com/Sammieblz/tholi/pull/69), merge
`df2f60ffa0e2e0927ab9868beffd51c1931d1023`.

This record covers development and PR acceptance. It does not authorize a
release, packaging or deployment. Extension/API `0.11.0`, website `0.1.1` and
existing archives remain unchanged.

## Validation status

| Check                                                                | Recorded status                                                                |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| Shared wire schemas, action matrix and purpose/version policy        | Passed within 64 focused cases                                                 |
| Shared HTTP identity and mutation guards                             | Passed within the same focused cohort                                          |
| Two-organization real PostgreSQL isolation and role checks           | Passed within 31 real PostgreSQL contract groups                               |
| Consent grant, old-version withdrawal and replay refusal             | Passed in focused HTTP/policy and real SQL checks                              |
| Pool reuse, identity lifecycle and backup/restore under row policies | Passed; runtime-role restore readback verified                                 |
| Fresh, retained, optional-service and reset stack lifecycle          | Passed: 13 checks; owned resources and credentials removed                     |
| Independent source and acceptance review                             | Passed; no remaining actionable findings                                       |
| Complete deterministic `test:ci` and production build                | Passed: 500 unit, 47 core, 20 integration, 2 installed Firefox and 65 UI tests |
| Formatting and relative documentation targets                        | Passed: changed files formatted and 107 targets resolve                        |
| Hosted checks on final PR head                                       | Separate gate; consult the issue acceptance record before merging              |

The focused cohort covers 22 existing service contracts, 18 identity cases,
6 authorization route groups, 10 policy/contract cases, 4 identity composition
cases and 4 website account-boundary cases. The existing account-switch test now
checks that a delayed previous-account response cannot replace the new account.
No parallel cloud-data cache was introduced.

The complete local PR cohort has validation ID
`d3608c2f-8003-474b-bd50-085ae6cfaace`. It typechecked, built once and froze all
outputs before the 634 tests. Generated reports are retained under ignored
`output/qa`; earlier release and identity records have not been relabeled.

The complete disposable stack ran from `2026-10-30T11:01:31.386Z` to
`2026-10-30T11:12:59.951Z`. Its PostgreSQL cohort includes the 24 existing
database/identity groups and 7 new authorization groups. It also verified actual
runtime-role backup readback, retained startup, internal isolation, captured
synthetic mail, signed private S3 operations, anonymous denial, the local
collector and explicit reset/reseed. Redacted evidence is
`output/qa/local-stack/tholi-smoke-mvuv3rei-b4642429/smoke.json`. The script removed
only its owned project/volumes and generated environment file. No paid service or
production resource was used.

No native-browser permission or screen-reader result is established by this
backend milestone. Previously recorded identity evidence remains attributed to
its own tested source. Later account-data, inference, billing and enterprise
features are not claimed by the authorization foundation.
