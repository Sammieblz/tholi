# Product catalog and development allowances

Roadmap [#58](https://github.com/Sammieblz/tholi/issues/58) adds a versioned
product catalog to the existing [credit ledger](service-credits.md). This is
offline preparation. Production cloud enrollment, billing and live inference
remain unavailable while the deferred [quality comparison](testing/perception-comparison.md)
and cost evidence are outstanding.

## Discovery and enrollment

The composed identity service advertises `product-plans`. Its routes are:

| Operation                           | Route                                                    |
| ----------------------------------- | -------------------------------------------------------- |
| Public deployment-specific catalog  | `GET /api/v1/plans`                                      |
| Current authorized entitlements     | `GET /api/v1/workspaces/:workspaceId/entitlements`       |
| Idempotent personal Free enrollment | `POST /api/v1/workspaces/:workspaceId/entitlements/free` |

Enrollment requires an empty JSON object, a current signed-in personal-workspace
owner and the existing native bearer or website session boundary. Cookie writes
also require the exact website Origin and CSRF token. Client plan intent is a
selection hint; it cannot supply a grant, period, price, environment or limit.
No checkout is required for Free. There is no public paid activation endpoint.

Local requires no account, network enrollment or payment. Selecting Local is a
client processing choice. It does not cancel an account, cloud entitlement or
subscription, upload local knowledge, or delete saved data. A null effective plan
means an account has never enrolled in a product plan and may use the separately
provisioned manual development profile. An expired or suspended product plan
cannot fall back to that profile.

## One catalog owner

Migration 009 records the immutable initial catalog release and references the
existing immutable `plan_versions`. A migrator-owned selector chooses the current
release. Runtime services read that selection rather than importing a second
catalog or writing seed records on startup. Historical migration data remains
frozen; new catalog definitions require a new version. Product catalog, allowance
version and inference charging-policy version are separate identifiers.

The initial catalog identifies Local, Free Cloud and two provisional paid entries.
Paid names remain descriptive placeholders, all paid prices are null, and every
production allowance is null. The API's production profile strips development
allowances and reports cloud plans unavailable. Production enrollment fails before
funding. Billing availability stays false. This does not advertise cloud features
that users can purchase or use today.

Only explicit `NODE_ENV=development` enables the fake Free fixture in API and
worker composition. Other values default to production. The fixture is:

| Limit                  | Development value                                                        |
| ---------------------- | ------------------------------------------------------------------------ |
| Grant                  | 6 development credits per fixed 24-hour period                           |
| Conversion             | `fake-development-v1`: at most 1 credit per validated generated proposal |
| Requests               | 6 per period, 2 per minute                                               |
| Foreground concurrency | 1 per account across workspaces and replicas                             |
| Model                  | Existing fake `tholi-deterministic-v1` only                              |
| Model budget           | 8192 input tokens, 512 output tokens, 1 image, no retries                |
| Journey ceiling        | 2 decisions                                                              |
| Saved artifacts        | 20, at most 16384 bytes each and 131072 bytes total                      |
| Provider cost          | 0 USD; existing global limits and disable control also apply             |

These quantities are development fixtures, not commercial promises or measured
provider economics. Live model access remains disabled. Shared credit reads show
the original charging policy, current exact balance, holds and known usage. All
credit and byte quantities travel as decimal strings. Maximum credit reservation
is an estimate; a generated proposal does not establish delivery or arrival.

## Periods, transitions and accounting

Free enrollment and bounded worker refills reuse the existing append-only grant
ledger. A durable account/program/period claim prevents duplicate grants across
replicas, workspaces or catalog changes. A program's period is stable; changing
catalog versions does not create a fresh allowance within an existing period.
Grants expire at period end and do not roll over. Old held liability remains
accounted for under its original grant terms.

Admission derives current caps in the existing reservation transaction. Model
execution receives the stricter plan and charging-policy budgets. Dispatch
rechecks current entitlement so a downgrade or expiry before invocation fails
closed. Settlement retains the original hold terms; there is no silent overage,
automatic top-up, automatic recharge or model retry. New journey identifiers,
workspaces or reconnects do not reset account limits.

Storage limits use actual persisted JSONB bytes and counts under account/workspace
locks. Growth and new artifacts are bounded. Reads, tombstones and reductions
remain possible after a limit reduction or plan expiry. Future saved-data routes
and billing reconciliation must extend these owners rather than create another
allowance or credit system. Diagnostic export storage retains its own limits.

Exhaustion blocks new billable work while account access, Local processing and
independently authorized data reads/export/deletion remain available. Paid
activation, subscription changes and provider reconciliation belong to #50.
They must use the same ledger and verified billing evidence. Prices, recurring
paid quantities and production limits require cost evidence before publication.

## Validation

See [the plan catalog validation record](testing/product-plans-validation.md).
Focused HTTP/application contracts and the existing fresh PostgreSQL stack own
catalog, grants, expiry, concurrency, forged input, storage and transition checks.
No provider calls or payment operations are part of these checks.
