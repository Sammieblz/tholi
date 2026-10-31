# Credit accounting validation

Owner: [#44](https://github.com/Sammieblz/tholi/issues/44).
Recorded October 31, 2026. Offline implementation and local validation are complete;
the exact-head hosted PR gate remains pending.

The user authorized offline continuation after merged preparation PR #82
(`7259410bcd439b51ce38692704470186878c7bbb`). The live comparison in #43 remains
open and deferred. Its previous passing hosted PR gate is historical preparation
evidence, not validation of the new quota changes.

## Scope and guidance

Extend `database/repositories.ts`, its versioned migration owner, the existing
navigation operation lifecycle, and durable jobs/outbox. Keep one credit ledger.
The public service composes only fake development inference, with no automatic
credit grants, paid prices, cloud publication or provider calls.

The PostgreSQL best-practices skill was applied to keep transactions short,
acquire locks in a consistent order, bound claims, retain indexed foreign-key
access and restrict runtime/worker privileges. Validate these properties against
actual concurrent PostgreSQL operations, including upgrades with credit history.

## Focused feedback

The first HTTP/contract cohort (`a2e94b66-8c23-4a9d-8d50-a59c980060b7`) passed
74/75. It found a real query-admission defect: the new coercing numeric schema
did not admit string query parameters under the service's strict AJV boundary.
The correction reuses the existing bounded pagination and cursor owner. The next
cohort (`445b405f-cdf6-42f6-a2e0-9056f383b4e5`) passed all 75 checks.

Quota, worker and observability feedback
(`580cff96-f3a5-40e9-80de-5edd477c3646`) passed 39/39 checks. Its preserved unit
report SHA-256 is
`5d39b924093da621eda1bc079314e42d8fe5829ec3cbdc8404377d59ec8ef879`.
The report's extension digest is existing build context, not proof of a rebuilt
quota artifact. After adding the registered reconciliation kind to the exporter
allowlist, cohort `1160da71-78a4-4ae0-ad84-364703ee74cd` passed 12/12 focused
exporter checks. This still does not certify a production build.

Whole-project typecheck passed on its second invocation after correcting generic
test mocks. The first failing log is retained; no production type contract or
timeout was weakened.

The first disposable PostgreSQL smoke (`9a3774ea-107c-404d-9735-40822e3f3559`,
project `tholi-smoke-mvwmkgl3-3d5e0a6d`) passed 81 PostgreSQL checks, then failed
clean-stack startup at the migration initializer. Its owned containers and
volumes were removed. Source changed between its test-image and API-image builds;
the report is failed pre-correction feedback, not final matching-byte evidence.
A parallel review found that migration allocation must use
historical occupancy rather than current settled consumption. The corrected
upgrade fixture covers both later settlement and later release. Fresh matching
source/image verification remains required; do not relabel that first smoke as
acceptance of the final migration.

## Final local results

The pre-null-projection cohort `41e62ebb-8790-414b-a630-ed0539f3ac6a`
passed 82 PostgreSQL and 29 complete optional-stack checks. Its report SHA-256 is
`bef9490e8520ceb0f0aba55c592e5b9266589655a188fe1ed2966061a4528abc`.
That passing report stays distinct from the final read-contract verification.

After correcting unknown token counts to null, cohort
`b6120c82-8cc9-4d5a-8af8-07c7bd714ffc` passed the same 82 PostgreSQL and 29
optional-stack checks in project `tholi-smoke-mvwnioku-7bcbb667`. Report SHA-256:
`b7ab52efeef3dc5a656756e08d79e9fb04a7b3f8377b220ec86ded1b2b684d24`.
It covers historical overlapping holds, unknown versus measured-zero usage,
cross-replica budgets, trusted receipts and reconciliation, disable races,
refunds, reported token/cost overruns, actual worker effects, gateway/TLS,
private telemetry, backup/restore and reset. Its owned containers and volumes
were removed; the retained development stack was not reset.

The third whole-project typecheck passed. Complete `npm run test:ci` then passed
in one coordinated run, `387393f2-aa64-4c03-8c92-e768922996ad`, with one fresh
production build:

| Owner                                                  | Passed |
| ------------------------------------------------------ | -----: |
| Unit                                                   |   1029 |
| Chromium core                                          |     56 |
| NLP, multi-app, continuity and reliability integration |     20 |
| Native Firefox                                         |      4 |
| Website and UI, including Firefox                      |     67 |
| Total                                                  |   1176 |

Build-manifest SHA-256:
`a04f4dcad9ecf82f45e4784fc5c6e7d80fc23162c83ef90cb9d4a0d2ffe7ab80`.
Unit-report SHA-256:
`8eb7d23061fc89dab7409b05302b563322cfd334557e3a0f13ea4ac3585b677a`.
All eight report owners have the same run ID and passed. The current native
Firefox cohort completed successfully without a browser-policy workaround;
earlier failed cohorts remain unchanged.

The frozen runtime/test-change fingerprint was
`47bfbbc171ec7e3f271baccae06473e2efacb00f3c88c306025f43342c12a60f`,
covering 29 changed code, test and infrastructure files relative to preparation
merge `7259410bcd439b51ce38692704470186878c7bbb`. Those file hashes remained
unchanged through final validation. Documentation is excluded from that fingerprint.
The existing preview process on port 5174 remained running.

## Remaining gates

Exact-head hosted PR checks remain pending before merge. Development grants and
synthetic priced-provider tests are not paid billing or provider availability.
Cost per independently verified success remains explicitly unavailable until its
independent outcome source exists; it is not inferred from proposal generation.

Native permissions, screen-reader checks, real provider cost/retention, the live
quality comparison, production scaling and full release certification remain
unperformed. No new version, package, deployment or archive is authorized.
