# Saved-data validation

Owner: [#59](https://github.com/Sammieblz/tholi/issues/59).
Recorded October 31, 2026. Implementation verification is in progress.

## Scope and guidance

Extend the existing artifact, authorization, request-ledger, private-file and
credential owners. Keep one SQL mutation owner for legacy and public formats,
one approved client cache/outbox and one export worker pipeline. Do not attach
cloud sync to local observation, sign-in or plan selection. Current deployment
defaults remain cloud-free; #43 stays open/deferred and #54 remains deferred.

The PostgreSQL best-practices skill informs consistent account/workspace/consent
lock order, bounded claims, metadata-inclusive byte accounting and restricted
runtime/worker functions. No SQL transaction spans an external object request.
Local preview, typed projection, source revisions and account generations prevent
unreviewed uploads; database revisions and tombstones govern server conflicts.

## Focused feedback

The application/authorization-policy cohort passed 14/14, run
`342a528b-0015-42cc-b118-8c787d4c295d`, before later route/helper extraction.
The support cohort passed 16/16, run
`dfa8f4a5-9b51-4d82-aa85-a18a9a3338f0`, including revocation during final
signature verification. Initial sandbox-only esbuild startup failures are kept
as log-only feedback, not passing reports.

The initial client/lifecycle cohort passed 110/110, run
`ed9b39f0-65ae-4b3e-84b4-2a9c9a2c63a2`. Later protocol checks passed 10/10
under `3587b06a-ad3a-466b-b1b9-2afabb0e4503`; a filtered native sender/error
boundary check passed 1/1 under `5349c9b5-b3c6-48fd-b473-22183d77d2cb` with
51 explicitly unselected cases. These remain distinct source-unit cohorts.

The initial privacy/schema cohort passed 12/12. The subsequent HTTP/service/
privacy cohort passed 105/105, including all nine saved-data routes, all four
artifact variants, cookie/native admission, exact import hashes, query bounds,
private cache policy and production write availability. These reports retain
their existing build context; they do not certify a new binary.

The first whole-project typecheck found six test-fixture errors: two deliberately
invalid DTO casts, two deferred-promise helpers outside the repository's configured
library target, and two missing control-risk fields. Corrections retain strict
runtime rejection and the existing compiler target; production types were not
weakened.

Review additionally corrected consent/write lock ordering, exact operation-ID and
revision acknowledgement, tombstone metadata erasure, same-account reload behavior,
owned organization-file resolution and the final session/membership download
ordering. Fresh focused, typecheck, PostgreSQL/container and complete deterministic
PR verification remain required on the final frozen source.

## Final review corrections and focused verification

The next HTTP/support/profile cohort passed 67/68; only the first existing HTTP
fixture exceeded its five-second cold module/schema startup allowance. That one
fixture now has a ten-second startup allowance. Product request deadlines and
their assertions are unchanged. The subsequent six-owner HTTP/authorization/
privacy cohort passed **87/87**, run `be0ebd3a-15d3-4093-8d1e-68a5a107da94`;
its retained report SHA-256 is
`83e70680964d6e0c8a6ab1c96af01e36c55c5d1c740a32538ab7ba3b9b29476b`.
This includes expected-account admission, verified response binding and membership
revocation during a valid final personal-session check before organization export.

The affected client/credential/website run
`e2c2de5e-9cbc-48ff-b76c-82cef2a3c17a` passed 67/68: all 12 client and 49 credential
checks passed; the peer-tab test asserted before verified reloading completed.
Removing a duplicate cache reset and waiting for verified account proof corrected
the website case. Its seven-case file then passed **7/7**, run
`297f7c7b-29a1-4b4f-8ff2-08df102ce31e`, without changing test timeouts. Peer notices
contain no credentials and cannot supply identity authority.

Read-only review additionally found SQL three-valued predicates that could accept
JSON null for scalar enums. Migration 010 now rejects null or wrongly typed enums,
export identifiers/revisions and tombstone metadata. The existing PostgreSQL cases
exercise these constraints and actual signed organization export/download through
`SupportService`, not only mocked metadata reads. Shared 429 response definitions
replace repeated route overrides.

Later typecheck feedback found a final-auth mock forwarding one of two arguments,
and an unannotated export-fixture array. Both fixture types were corrected without
casts or compiler changes. Final whole-project typecheck passed. The frozen
52-file runtime/test map, after formatting and these corrections, has SHA-256
`da728e1a1eae9c437ad004b52e03ea457f5ae72a21f03ee624329f79481fdfaf` in
`output/qa/saved-data-59-frozen-source.json`. Earlier cohorts retain their narrower
source scope; fresh container and PR-gate evidence follows below when complete.

The first disposable container run, `tholi-smoke-mvwt7icg-83adf5a6`, failed before
executing database checks: the test image did not copy the shared saved-data
fixture. A targeted cached build confirmed the unresolved import. The Docker test
stage and context now allow only that additional fixture; the production image is
unchanged. Its smoke report records owned-project/volume cleanup. The next frozen
54-file source/context map has SHA-256
`28f5851dbe33ee3999a54ffa78b1918a59524c30570f0d38f6772ce8bdeedfb8` in
`output/qa/saved-data-59-frozen-source-container.json`.

The next smoke, `tholi-smoke-mvwt92w1-42cdae0a`, reached PostgreSQL and failed the
existing workspace-isolation case's saved-route round-trip assertion. The shared
legacy save adapter had returned its pre-serialization object, including optional
undefined properties, rather than the actual stored row. It now parses and returns
the stored format-1 content with the existing schema. The original assertion is
unchanged. That failed stack also removed its owned project and volumes; report
SHA-256: `74f9144165aa973c35420192165b6d0c348751568e9a7f5030820ea8d7f24db1`.
The corrected source map is
`61584ca567480cc264cc0a7d71e06c749c8954f071a63391f4e14950855003ec`
in `output/qa/saved-data-59-frozen-source-roundtrip.json`.

`tholi-smoke-mvwtbf5r-43515ea2` passed that legacy case, then exposed a worker
permission regression in the existing SMTP crash-barrier case. Updating the shared
request table evaluates its new saved-data receipt check, which needs explicit
execution permission for its pure validator even when the receipt is null. The
worker grant was corrected without granting artifact writes or consent
authority. The failed report records owned-project/volume cleanup.

`tholi-smoke-mvwtdc6l-47ace2a9` passed that worker case and caught a legacy
revocation-denial mismatch. Resolving no currently owned file had returned null
before the existing scoped authorization check. The adapter now checks the
original scope before returning null, preserving `FORBIDDEN` for revoked callers.
It performs no fallback file lookup, so foreign or ambiguous IDs remain denied.
The adapter also freezes its account/workspace input before the first await.
The original test assertion remains unchanged. This stack cleaned up; report
SHA-256: `d75f4d4f62580ac72002b81a4b3dffa96c75dc3c8bb8fd2e49736e551be9b648`.
Corrected 54-file map:
`24df5d03532da9e3d9058216f7ddd39890f273bb8859576820e06d3678e7552b`
in `output/qa/saved-data-59-frozen-source-file-denial.json`.

## Complete local container verification

`tholi-smoke-mvwtfz46-be5c8532` passed **95 PostgreSQL checks and 30 stack checks**
on that unchanged corrected source map. Coverage includes the four approved DTOs,
strict SQL constraints, legacy adapters, account/workspace privacy, consent races,
CAS/idempotency, tombstones and conflicts, actual metadata-inclusive quotas,
signed organization exports, revoked membership and expired files. The existing
worker/mail/gateway/private-storage, telemetry, backup/restore, restart persistence
and explicit reset/reseed checks also passed. Owned project and volumes were
removed. Report SHA-256:
`fa55a40b2b6b0dd96b5b13101384077eb86e98338f2dbbd3264af93fda85a196`.

## Interrupted PR-gate run

Run `3aa11907-aa23-4b54-bae2-7cc44f8e6223` passed whole-project typecheck, a fresh
production build and **1084 unit cases across 77 files**. During browser checks,
review found that an unverified peer notice cleared approved offline work and that
blanket cache cleanup in an older tab could erase a newer account's pending work.
The uniquely identified owned CI process tree was deliberately stopped before
completing its browser groups. This run is **not a passing PR gate**.

Its retained unit report SHA-256 is
`32184b8b0b88641ac61e6907d025a1c5af7c9f4c14d15e6611a6ff9feca30f90`;
build manifest SHA-256:
`a6cfb3efc8a849123d4c37e50d345fc1ae808d09061030f871dd3ca40e77de6d`.
Both are preserved under
`output/qa/saved-data-59-interrupted-ci-3aa11907-aa23-4b54-bae2-7cc44f8e6223/`.
The stale-notice and concurrent-cache regression will be corrected in the existing
client, cache and account owners, then receive fresh focused and full PR checks.
The user's preview process on port 5174 was preserved. No release certification
or packaging is implied by any result here.

## Scoped-cache correction

Before changing the implementation, focused counterexample run
`0f1a41de-6f4a-4735-a396-5f12b441429c` reproduced loss of account B's approved
outbox during account A's late cleanup. The shared store now deletes only an exact
service/account/workspace key. Its destructive `isolate` operation was removed:
keyed reads/writes already separate scopes. Reset retains the last known key and
accepts a previously verified scope; an unknown scope never causes a blanket purge.

Peer notices suspend work, then the existing account endpoint re-proves identity.
Only verified changes clear the previous scope. The existing peer test delays A's
proof until B queues an approved operation, verifies its exact UUID survives late
A cleanup and a forged notice, and permits only the two explicit save attempts.
The existing native import case additionally restarts modules and delays the old
settings read. The auth owner captures a credential-free cleanup scope before
credential replacement; its existing write owner waits only for that snapshot,
without waiting on cache listeners. Logout clears A while preserving B and local
routes.

The three affected owners passed **69/69**, run
`99625ad0-b7dc-4b92-9ac1-aa0c107402bd`. The corrected 54-file source map has SHA-256
`268c7d1b7dbb2fdf08cd5e33664aa6e17db86e78c3e30d7af4f3a4c68007d7a1`
in `output/qa/saved-data-59-frozen-source-final.json`. Its eight changed files are
client/native/web/cache owners and their tests; the PostgreSQL, API and container
sources remain byte-identical to the passing 95/30 smoke. A fresh local typecheck,
build and complete unit group have passed as recorded below. The final pushed head must pass all
hosted PR checks before merge. Neither the interrupted run nor a single local
group substitutes for that aggregate gate.

## Final local preparation gate

`npm run test:ci -- --group unit`, run
`5b6a0143-1c87-4806-afb6-8019ed0857f9`, passed whole-project typecheck, one fresh
production build and **1085/1085 unit cases across 77 files**. Runtime/test/context
hashes were unchanged after that run. Its unit report SHA-256 is
`38b3c90c2846a5c67a8007acffe3527c89f0673007a4708ccd0a9f5ef8892878`;
build manifest SHA-256:
`72c8a383af69ef7faf70bd8e37a54b2b65cff2fa58e2a7f81d5c6ea6e6350ea9`.
The report, immutable build manifest and source map are retained under
`output/qa/saved-data-59-final-unit-5b6a0143-1c87-4806-afb6-8019ed0857f9/`.

Hosted build, all five browser/unit groups, containers and aggregate validation
remain pending on the final committed PR head. Their final evidence belongs in
the PR/issue after completion; this pre-commit record does not claim those checks
already passed. No version, archive, deployment or release change is included.

The organization-export fixture models approved retained data moved by the
migrator with real target-scope consent. It does not create a public organization
Free enrollment path. Automated sender/permission mocks are not native permission
prompt certification. Actual screen-reader speech, hosted provider retention,
production scale and live model quality remain unperformed.
