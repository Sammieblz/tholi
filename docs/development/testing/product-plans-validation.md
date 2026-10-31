# Product plan validation

Owner: [#58](https://github.com/Sammieblz/tholi/issues/58).
Recorded October 31, 2026. Local preparation is complete; fresh exact-head hosted
validation remains required before merge.

## Scope and guidance

Extend the existing immutable plan versions, entitlements, credit grants,
reservation lifecycle, saved-artifact repository and bounded worker maintenance.
Keep one catalog selector and one ledger. No cloud provider calls, prices,
checkout or paid activation are authorized by this work. #43 remains deferred
and its measured quality gate remains required before beta or release.

The PostgreSQL best-practices skill informs short transactions, consistent lock
order, bounded worker claims, indexed foreign keys and restricted runtime/worker
privileges. Runtime code does not seed or migrate the catalog. Tests use a fresh
disposable database, never the retained development stack.

## Focused feedback

The first six-owner cohort passed 169/172 checks. Two new application assertions
incorrectly assumed that the common authorization context loader would not read
consents. The fixtures retain empty consents; successful reads and enrollment
prove there is no inference-consent prerequisite. Those assertions were removed.
The first existing HTTP test also exceeded its five-second timeout during cold
startup; its timeout and behavior were preserved.

The corrected cohort `0a77ae75-e8b1-4636-8f14-9ca7e59cfa29` passed all 174
checks across plan/application schemas, HTTP authorization, configuration, quotas,
worker scheduling and worker composition. Unit-report SHA-256:
`0ec3a473f000f23203435a8a9b4a5de6ba047605d6805cc543322fa9a9daf54c`.
Its existing extension digest describes context, not a new certified build.

The first typecheck caught an in-progress test's incorrect paid-mode name and
an HTTP fixture's missing repository interface intersection. Corrections preserve
the existing `paid` selection mode and keep `paid-cloud` as a plan identifier.

Review also corrected request counters to include released attempts, moved period
calculation after lock acquisition, prevented production reuse of active fixture
entitlements, and retained original settlement terms after admission.

Whole-project typecheck passed on its second invocation. The first disposable
stack, `tholi-smoke-mvwptd9f-f2ec1ede`, failed while parsing the new migration
with PostgreSQL error `42601`. Its owned containers and volumes were removed.
The failed report SHA-256 is
`32e02b1a55826963b0dc69eb24ec28a6301f37f01ad222f32effb852ea52f3a1`.
The storage trigger's arithmetic `CASE` expression required parentheses inside
the PL/pgSQL `IF`. That expression was corrected before a fresh stack run; the
first failed report is not final migration evidence.

## Fresh PostgreSQL and complete stack

The corrected disposable stack `tholi-smoke-mvwpx9a2-6aec3303` passed all 88
PostgreSQL checks and 30 complete optional-stack checks. Report SHA-256:
`56ff4e9fb5a7a7b6c560385b405e7095491329f9880347204c799f6727f1b1cc`.
It exercises fresh and retained-data migrations, all six new plan cases, existing
financial regressions, actual API catalog composition, gateway/TLS, worker
effects, private objects, correlated telemetry, backup/restore and clean reset.
Owned containers and volumes were removed. Retained development services were
not reset.

The runtime/test source fingerprint used for this stack and the following local CI cohort is
`f17c057e730802108ec98659d6892414d0cbbdf2969bb5a19b9ad5d8f8a854b9`.

## Complete local PR cohort and final cleanup

Complete `npm run test:ci` passed with one fresh production build, run
`9ee3a995-946b-426d-be68-3e089c890728`: 1048 unit, 56 Chromium core,
20 integration, 4 native Firefox and 67 website/UI checks, for 1195 total.
All eight reports have the same run ID and passed. Build-manifest SHA-256:
`4fd2c9cc8f3fe4db0fd89b1fb5ce27d73dc65f0d6c51eb3c51f5de6a88f0cc55`.
Unit-report SHA-256:
`24dab4e0a7598a5bd0828fe7424e63525c84c8f891733829afbb0bc864bbc694`.
The original reports and source fingerprint are preserved as this cohort's evidence.

After that frozen run, review removed an unused catalog constant, type export,
SQL declaration and fixture option. Catalog/effective/entitlement plan references
now reuse the existing account-intent identity schemas so public plan IDs cannot
be accepted by the catalog but rejected by the account flow. This final adjustment
has focused validation; the previous build and PostgreSQL reports remain scoped
to the pre-cleanup bytes. Fresh exact-head hosted build, PostgreSQL/container and
all deterministic browser/unit groups are required before merge.

The final six-owner cohort `daa14e6d-5a17-4c2e-9121-3db338b3c346` passed
174/174 checks (report SHA-256
`1b0388553e8346a14f22b88bb920d3687a3ec8eec46c3cecb31b9ee91d3b693a`).
The final identity-contract check `32e828f3-0355-4edf-90d8-ac1b499c63af` passed
8/8. Whole-project typecheck passed again after cleanup. Final runtime/test source
fingerprint:
`58bd45742aa2a2c9d3e9c0d037842f7e2e4b4feb7434290ec2d4e982f9968c8d`.

No archive, deployment or version change is part of this issue. Live calls stay
disabled. Native permission prompts, actual screen-reader speech, production
scaling, billing and the deferred live-quality comparison are not certified here.

## Post-merge hosted evidence

After this preparation record was committed, final source
`18225f6932f7b988d07bf45b94c2b5618117711f` passed all eight hosted checks in
[run 41230648824](https://github.com/Sammieblz/tholi/actions/runs/41230648824).
The final head was rebuilt and its PostgreSQL/container and all deterministic
unit/browser groups passed. PR #84 merged as
`895c6bb79b2ce0a30e18c25aea064db880d5a5bf`; #58 is closed and marked Complete.
This later evidence does not relabel the earlier local reports or certify #59.
