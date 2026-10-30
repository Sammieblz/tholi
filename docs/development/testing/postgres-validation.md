# PostgreSQL foundation verification, October 30, 2026

Scope: [#28](https://github.com/Sammieblz/tholi/issues/28), based on
`2d53de19caa7bbfc723a18904ea69cd4ee897fd4` and this issue branch's changes.
This is development/PR evidence, not release certification. API/extension
`0.11.0`, website `0.1.1` and existing archives remain unchanged.

## Ownership and review

- Extended `apps/api` with one PostgreSQL adapter/repository owner and versioned
  migrations; retained private SQLite storage and navigation contracts.
- Applied `supabase-postgres-best-practices` guidance for indexed foreign keys,
  bounded pooling, explicit transactions and non-owner runtime roles. No Supabase
  service, cloud SDK or vendor-specific identity SQL was adopted.
- PostgreSQL runtime integration uses real container PostgreSQL 18.6 and the
  actual `tholi_runtime` role, not an owner connection or mocked SQL driver.
- Authentication, RLS/application authorization, HTTP contracts, worker execution,
  live inference and commercial credit policy remain their later roadmap owners.

## Findings corrected during verification

The first disposable run passed all fourteen initial PostgreSQL groups. It then
failed creating the operator container because an unquoted YAML flow-list tmpfs
value split on commas. The corrected configuration quotes the complete mount.
The failed project and volumes were cleaned up; its report remains historical.

Independent review found that `pg` can override bounded options by reparsing a
connection URL or reading ambient configuration. The pool now passes explicit
connection fields, an allowlist of TLS options and fixed startup options. Enabled
TLS explicitly requests certificate verification. A real connection test poisons
ambient PostgreSQL credentials, TLS and startup settings and proves they do not
change the selected runtime configuration.

Review also identified transaction-bound repositories remaining usable after
callback completion and mutable command inputs being reused after awaited SQL.
The repository query capability now expires before commit/rollback and client
release. Inputs are snapshotted before asynchronous work. Permanent PostgreSQL
regressions cover use after commit/rollback and pool reuse, mutated job references
and a credit admission race involving different submitted/admitted amounts.

The first complete application cohort built successfully, then hit the unchanged
five-second timeout in the injected private API/OpenAPI test while container work
was running. The test and threshold were preserved. The container workload
finished before a fresh complete cohort reused the immutable, manifest-verified
build; all 410 unit checks, including that test, passed on the serialized run.

## Final checks

| Check                                                                | Status                                                                  |
| -------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Focused configuration, container policy and SQLite startup contracts | Passed before final cohort                                              |
| TypeScript after repository lifetime/input fixes                     | Passed                                                                  |
| Fifteen real PostgreSQL groups                                       | Passed                                                                  |
| Complete optional-profile smoke, all-table backup/restore and reset  | Passed: 13 checks, successful cleanup                                   |
| Existing real SQLite/private API regressions                         | Passed: both real-model v1/v2 API tests                                 |
| Complete deterministic `test:ci`                                     | Passed: 410 unit, 47 core, 20 integration, 2 Firefox and 65 UI checks   |
| Hosted PR workflow                                                   | Separate run; consult the issue branch PR checks for its current result |

The PostgreSQL groups cover retained-data upgrades, checksum/future history
refusal, non-owner privileges, transaction rollback and scope cleanup, ownership
and composite foreign keys, saved-route revisions/tombstones, consent/catalog,
idempotency, concurrent credits and uncertain holds, and atomic jobs/outbox.

The full container smoke uses separate migration/runtime credentials, compares
every application table after `pg_dump`/transactional restore, performs runtime
readback and checks a confirmed reset followed by fresh migrations/seed. Its test
image is separate from the production runtime. Redacted reports are recorded
under `output/qa/local-stack/`; generated credentials are removed after successful
owned-project cleanup. Production resources and user data are not involved.
The final fresh-image report is
`output/qa/local-stack/tholi-smoke-mvujysbg-6fbf02c6/smoke.json`.

The passing application cohort used validation ID
`14b35c2a-20ce-445c-82cb-9c920540c34f` and verified build digest
`7de2d3035991253cb822afc46c1fade081b2a65f27867bf9a559d1fc5a32533f`.
The initial invocation built once; the fresh complete run used the documented
`THOLI_BUILD_PREPARED=1` option after manifest verification. No test assertions or
timeout thresholds were changed to obtain the passing cohort.

The existing `tests/integration/nlp/api.test.ts` and
`tests/integration/multi-app/api.test.ts` then passed through their respective
Vitest projects against those same compiled API workers, without rebuilding.
They exercise real local NLP, legacy v1/v2 contracts, CORS/authentication, SQLite
persistence across restarts, privacy and deletion. These are focused compatibility
checks and are not relabeled as full model certification.

Native permission, screen-reader, signed-in, production TLS/provider and live
cloud checks were not performed by this database change. Full certification and
packaging were not requested.
