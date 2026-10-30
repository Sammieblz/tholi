# Service observability validation

Roadmap issue: [#35](https://github.com/Sammieblz/tholi/issues/35).

This record belongs to the observability implementation and does not relabel
earlier release evidence. API/extension version remains 0.11.0; website remains
0.1.1. No publication, packaging, paid resources or deployment is performed.

## Acceptance evidence

- Focused configuration, HTTP request correlation and worker cleanup: 69 passed.
- Final focused telemetry, provider, worker and support owners: 66 passed.
- Audit and PostgreSQL observer unit contracts: three passed.
- Real PostgreSQL migration/retention/consent races and actual collector/provider/
  retried-worker inspection: passed as recorded below.
- Configured account consent and complete real identity lifecycle: both browsers
  passed as recorded below.
- Complete deterministic PR gate: 754 passed, recorded below.
- Hosted exact-head results are recorded on the issue and PR before merge; they
  are independent of these local reports.

Failed diagnostics and subsequent evidence will remain separately attributed.
No local fixture result certifies a native permission flow, screen reader,
external inbox delivery, live Gemini inference or managed alert delivery.

## Initial real PostgreSQL failure

Clean source `5cb2b3686c1069f6d0f4033c00e1b1810ebd30cc` passed Compose policy,
then failed the existing competing-dispatcher completion check. PostgreSQL
reported missing worker EXECUTE permission on `valid_job_correlation`, which is
rechecked by the new jobs CHECK constraint during completion. No successful
container or telemetry certification is claimed for this run.

The unchanged report is
`output/qa/local-stack/tholi-smoke-mvv5tg3n-5c569683/smoke.json`, collected from
16:01:25 through 16:03:48 UTC on 2026-10-30. Its owned project and volumes were
removed. The subsequent grant correction and fresh run are separate evidence.

The next clean source `1d8083575e9c08376b061da0573a7eff37cad50a` passed the
previous worker completion boundary but failed new product-event admission.
Ordinary `FOR SHARE` on the actor's membership applies its existing UPDATE RLS
policy, which deliberately excludes editing one's own membership. The original
report remains `output/qa/local-stack/tholi-smoke-mvv5zcrw-5e186d59/smoke.json`,
16:06:01 through 16:06:22 UTC. Cleanup completed. The correction uses a
parameterless, read-only scoped locking capability, without expanding account
or membership mutation grants. Its fresh actual run remains separate evidence.

Clean source `ca2e19dfa0e5015cd0a35da7b517f20560d44899` then passed the new
consent and retention boundaries and stopped at the last correlation assertion.
The test attempted an unscoped runtime UPDATE, which RLS correctly hid, so the
immutable-origin trigger was never reached. The test now uses the existing
scoped transaction and retains its expected `23514` rejection. Production code
did not change for this correction. Synthetic negative JSON checks also now
use SQL parameters so their payloads do not appear in statement diagnostics.
The unchanged report is
`output/qa/local-stack/tholi-smoke-mvv64jy2-9965e4c4/smoke.json`, collected from
16:10:04 through 16:10:24 UTC, with owned cleanup complete.

## First complete-stack attempt

Clean source `a4fdebccc06036353070292a006a14d3a0255ef4` passed all 58 real
PostgreSQL groups and 26 stack checks, including nine gateway groups, real SMTP
and private-file expiry, restore/privileges, retained restart and collector
ingestion. It then stopped before the new telemetry probe executed because its
command flag was passed to Node rather than the test script. The correction is
limited to QA command wiring. This run does not prove runtime sentinel privacy
or failed-provider/retried-worker correlation.

The unchanged failed report is
`output/qa/local-stack/tholi-smoke-mvv68t8r-2e097bc9/smoke.json`, collected from
16:13:22 through 16:21:02 UTC. Its owned project, volumes, environment and
synthetic TLS files were removed.

## Passing actual stack

Clean source `cd95af7360ac15d663456b826f6cbb3e6a0e6f6c` passed all 58 real
PostgreSQL groups and all 28 stack checks from 16:23:06 through 16:32:10 UTC.
The redacted report is
`output/qa/local-stack/tholi-smoke-mvv6lbab-ba803d44/smoke.json`.
Its owned project, volumes, environment and synthetic TLS files were removed.

The real telemetry check inspected 58 records, correlated an actual rejected
OIDC exchange with its HTTP parent, and observed an independently running worker
complete SMTP on attempt two after an actual capture-service interruption.
Origin correlation remained immutable, attempt spans were distinct, and the
collector received real traces/logs/metrics. Actual Prometheus scraping passed.
Private sentinels were absent from inspected application/collector output and
metric labels. Raw records were not retained; the report preserves only counts
and hashes. Synthetic ingestion alone was not treated as this proof.

Subsequent changes affect website consent controls, their browser/unit checks,
current documentation and a shared local API/worker/collector log-rotation
configuration. They do not alter the API/worker, SQL or collector binaries
exercised by this report. Configured website and final exact-head hosted
container evidence are collected separately.

## Configured website attempts

The initial configured Chromium and Firefox run at clean source
`f8ccb3d8bd783fd6d96877bbe054b1d953394064` completed real registration, email
verification and account access, then failed in the new analytics sequence.
Its report remains
`output/qa/service-observability-identity/tholi-smoke-mvv74dh3-bd04fac9/validation.json`,
16:37:55 through 16:41:47 UTC. The harness now clicks the asynchronous account
permission control, waits for server-confirmed success and asserts its final
checked state, rather than requiring an immediate optimistic checkbox change.

The separate run at clean source
`b0f6b30522cbca2c4391a9e8faffed5aec186d1d` passed Chromium collection, retained
export, both-theme/four-width layout checks, browser and account withdrawal, and
deletion. Later account access hit a gateway 429; Firefox also hit 429 during
export. Its report remains
`output/qa/service-observability-identity/tholi-smoke-mvv7kc6q-db806806/validation.json`,
16:50:20 through 16:53:46 UTC. These are failed cohort results. Both attempts
verified actual API/worker log rotation, then removed only their owned stack,
volumes and temporary environment. The next run separately verifies the existing
account owner's removal of unnecessary CSRF headers on read-only GET requests;
mutation protection and gateway limits stay in force.

Clean source `27e25f9` then passed the complete analytics and layout sequence in
both browsers. Chromium continued through cookie binding, session renewal,
revocation and logout, then encountered a gateway 429 during password-recovery
sign-in. Firefox reached session renewal and revocation before the same limit.
The unchanged report remains
`output/qa/service-observability-identity/tholi-smoke-mvv7vo71-6790d241/validation.json`.
The fixture performs multiple synthetic account lifecycles behind one gateway IP.
Its next revision schedules those phases against the configured gateway burst
budget. It does not change production limits, retry rejected requests or remove
any security or analytics assertions. This attempt remains a failed cohort.

## Passing configured website

Clean source `6b835e56b7eaffbd2053025600acb349dee161f0` passed both configured
browser cohorts from 17:06:14 through 17:12:33 UTC. Chromium 156.0.8078.4 and
Firefox 157.0 each passed all nine check groups against the same immutable
website digest
`a325f4d31d64925b781f87956e7da66b30f39cf86c2db27b52c3b4bf83578978`.
Each scheduled wait was 20,000 ms, derived from the checked-in gateway capacity.
No browser-observed 429 response occurred. Direct fixture security requests also
met their unchanged expected outcomes. The report is
`output/qa/service-observability-identity/tholi-smoke-mvv84st9-1f9e7f21/validation.json`,
with separate browser and progress records alongside it.

The run established actual registration, local email verification, account access,
independent account/browser analytics permissions, retained-event export,
withdrawal and deletion, inert public Local pages, callback binding/replay
rejection, session renewal/revocation, logout, password recovery, retained identity
and sign-out across sessions. The signed-in account and retained JSON also passed
320, 768, 1280 and 1600 px layouts in both themes, keyboard focus, adequate targets
and reduced motion. Screenshots, video and traces were disabled for this cohort.
Actual API/worker log rotation passed. Owned containers, volumes and credentials
were removed; the temporary orchestration script was removed after verification.
This is configured local Chromium/Firefox evidence, not native Chrome, external
inbox or managed-cloud certification.

## Deterministic gate attempts

The first fresh default build at clean source `863ffa6` passed type/version
checks and compilation. Gate run `5f387550-ba22-4b6c-a4cb-2137d6d204d6` then
stopped with 615 of 618 unit tests passing. Two exact assertions omitted the new
analytics inventory group and fifth explicitly unavailable funnel. The first
correlation test also exceeded Vitest's default five-second timeout. Its focused
unchanged file subsequently passed all nine tests, with that case taking 4,059 ms;
the timeout and production deadlines were not changed. The exact-assertion
corrections separately passed all 49 tests in their existing two files.

The failed unit report, timings and build manifest remain under
`output/qa/service-observability-ci-failed-5f387550-ba22-4b6c-a4cb-2137d6d204d6/`.
Only tests and this technical evidence record changed after compilation. The next
gate uses the documented prepared-build path after fresh type checks and full
manifest verification; it does not rebuild or combine results with this failed
run. Hosted PR checks still perform their own fresh exact-head build.

## Passing deterministic gate

Clean test source `dbb82ab152f602df98164dea15f062ff03689ebc` passed the complete
PR gate under run `e284f439-9dda-4f4f-ac16-53a00f432ade`. Fresh type checks passed
before the prepared-build invocation. The build compiled at
`863ffa67e2c7885bc8971c83843da851a1a70d0d` remained byte-identical under full
manifest verification before and after the run. Intervening changes were limited
to the two exact assertions and this technical validation record.

| Scope | Passed |
| --- | ---: |
| Unit | 618 |
| Extension core | 47 |
| Browser integration | 20 |
| Installed Firefox extension | 2 |
| Extension and website UI | 67 |
| Total | 754 |

All scopes share the run identity and immutable target digests. Chromium extension
digest is `292e001a6bef7fca864049c9c277ea144675d01231c3c0020dead061fb6e64d4`;
Firefox extension digest is
`da07409678cada217dd93ac41b2618c363ced89c437f3680a2899816914483dc`.
The ten reports/manifest/timing files are preserved under
`output/qa/service-observability-ci-e284f439-9dda-4f4f-ac16-53a00f432ade/`.
Generated tracked acceptance output was restored after copying the fresh report.
This is PR evidence, not full release certification or authorization to package.

## UI guidance

Applied `.codex/skills/fixing-accessibility/SKILL.md` and
`.codex/skills/baseline-ui/SKILL.md`: distinct native labeled permissions with
connected descriptions, 44 px label targets, existing focus tokens, busy/status
and alert semantics, named keyboard-scrollable retained records and the existing
Base UI confirmation dialog. Branding, fonts and animation policy are unchanged.
