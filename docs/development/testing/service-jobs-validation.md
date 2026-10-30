# Durable jobs validation

Roadmap [#32](https://github.com/Sammieblz/tholi/issues/32), collected on
2026-10-30. This record does not replace previous milestone evidence and does
not authorize packaging, deployment or publication.

## Completed local checks

TypeScript, the production build, 126 relative documentation targets and the
complete deterministic PR cohort passed. The cohort contains 530 unit, 47 core
extension, 20 integration, 2 installed Firefox and 65 UI cases: 664 total.
Its validation ID is `1d63cbbb-5122-490e-aa96-34ab5536bf95`.

The first invocation stopped before website tests because a user-owned server
occupied port 5174. Its timing record is preserved separately. The complete
rerun used `THOLI_UI_PORT=5188` and the documented `THOLI_BUILD_PREPARED=1` option;
it verified the existing immutable build manifest before running every group.
TypeScript was rerun for the final test sources. No unrelated server was stopped
or reused. Fresh reports are retained under ignored `output/qa/service-jobs-*`.

The focused worker cohort passed 14 cases. Existing authorization HTTP/policy
coverage passed 20 cases, and the integrated CI run covers the new composition,
configuration and container-policy regressions. Independent source review found
and corrected two defects: cleanup after health-marker failures, and SQL
enforcement of uncertainty for unsafe retries. Both have permanent regressions.

## PostgreSQL and complete local stack

The fresh PostgreSQL cohort passed all 39 groups: the previous 31 database,
identity and authorization groups plus eight durable-work groups. These prove
worker-role isolation, competing dispatchers, exact lease fences, expiry,
bounded retries, revision-guarded dead-job recovery, unsafe-outcome uncertainty,
queued/running cancellation, membership revocation and private-payload refusal.
The maintenance fixture verifies rollback, a restarted repository, a 100-record
batch bound against 105 actual expired records, safe results and atomic outbox
completion.

The complete disposable stack passed all 15 checks using source commit
`0973668792b77f89b1d74370764c2ee9438ffa56`. The independently running worker
processed a registered maintenance job and published its database-local
completion event. The suite also verified live polling health, separate
non-owner roles and connection limits, idempotent initialization, actual
runtime-role backup readback, retained restart, isolated networks, captured mail,
private S3 operations, anonymous denial, the collector and explicit reset/reseed.
Worker processing was quiesced while comparing the restored backup snapshot.

Fresh redacted evidence is
`output/qa/local-stack/tholi-smoke-mvuy4288-62b77203/smoke.json`. The runner removed
its owned containers, volumes and generated private environment. A previous
attempt passed PostgreSQL and backup checks but stopped at an unsupported
`docker compose start --wait` flag. That failed report remains separate at
`output/qa/local-stack/tholi-smoke-mvuxscvp-d6b45b1d/smoke.json`; the complete
fresh rerun used supported `up --wait` behavior. Application source did not
change for that harness correction.

## Hosted acceptance

The hosted PR gate and a fresh review of its exact head remain separate gates.
Consult the issue acceptance record for their final result and merge. No
native-browser permission, hardware-DPR or screen-reader result is established
by this backend milestone. Existing browser identity evidence retains its own
source attribution. No cloud resource, production deployment, model call or
release archive was created or changed.
