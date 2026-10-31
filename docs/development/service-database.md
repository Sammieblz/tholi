# PostgreSQL service database

Roadmap [#28](https://github.com/Sammieblz/tholi/issues/28) implements the database
foundation of the [portable backend decision](../plans/gemini-cloud-and-enterprise.md).
The same migrations and repositories run locally, on a VM or against hosted
PostgreSQL. They never read, migrate or upload the private SQLite knowledge.
The optional [identity profile](service-identity.md) uses these repositories for
account authentication and session security. Opt-in fake navigation and
[credit/usage reads](service-credits.md) share these repositories. Cloud-saved-data
and billing HTTP endpoints remain later milestones.

## Local setup

Follow [local stack setup](local-stack.md). Normal `local:up` runs the dedicated
schema and identity initialization containers before admitting API traffic.
For an explicit migration replay and the optional synthetic application fixture:

```sh
npm run local:migrate
npm run local:seed
```

Migration reapplies infrastructure bootstrap, then applies versioned application
migrations. Seed preserves the OIDC realm and idempotently provisions one synthetic
Tholi account and personal workspace. Their UUIDs end in `0028` and `0029`.
It grants no credits or paid entitlement and does not sign a user in. Real
provider login links its verified identity to an internal account separately.
The operator-only `database-tools` container reuses the API image; its migration
credentials never enter the HTTP service. The seed requires both
`NODE_ENV=development` and `THOLI_ALLOW_DEV_SEED=true`.

`local:down` retains data. `local:reset -- --confirm-delete EXACT_PROJECT` removes
only that project's volumes. Migrate and seed again after an explicit reset.

## Owners and data

`apps/api/src/database/` owns the pool, scoped repositories, typed records,
versioned migrations and one-shot CLI. Migration SQL is embedded in TypeScript
so the existing API build carries the exact bytes without a second SQL tree.

| Area                 | Stored foundation                                                                                                                            |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Identity and scope   | Accounts, issuer/subject links, workspaces, memberships, one-use flows/brokers, session families, refresh hashes and provider logout markers |
| Consent and requests | Versioned decisions, scoped command keys, canonical payload hashes and status                                                                |
| Plans and usage      | Immutable plan versions, workspace entitlements and integer model usage                                                                      |
| Credits              | Integer grants, reservations and immutable settlements; one derived ledger                                                                   |
| Saved data           | Account-owned saved routes, optimistic revisions, sync stamps and tombstones                                                                 |
| Background work      | Scoped job references, lease/status fields and transactional outbox metadata                                                                 |

Composite foreign keys and uniqueness keep tenant references within their
workspace. Indexes cover foreign keys, scoped lookups, sync and pending work.
Requests store hashes and metering references, not raw prompts, DOM, images or
inference projections. Saved routes reuse `savedTaskSchema` and
`parameterizedTask`; there is no arbitrary JSON artifact or local mirror import.
Jobs admit typed record references, not browsing data or credentials.

## Transactions and scope

`PostgresRepositories.transaction(scope, callback)` checks the active account and
membership, freezes a copy of scope and supplies transaction-bound repositories.
Identity resolves the internal account and personal workspace from verified
provider proof. [Workspace authorization](service-authorization.md) resolves the
current role and consent inside the transaction. A request body cannot grant
scope. Internal account provisioning is the
explicit bootstrap exception.

Queries are parameterized and contain scope/ownership predicates. One checked-out
connection owns `BEGIN`, transaction-local scope, callback, commit/rollback and
release. Failed rollback discards the connection. Callbacks can atomically compose
saved data, requests, jobs and outbox records. Never hold the transaction across
model, mail or storage calls. Writes with unknown outcomes are not auto-retried.
Await every operation inside the callback. Its repository capability expires
when it returns, before the connection is committed or released.

Saved-route writes require expected revisions. Deletion clears content while
retaining a tombstone; an ordinary update cannot resurrect it. Sync uses bounded
keyset pagination over monotonic workspace revisions. Saved-data export/delete
persistence has no credit-balance gate.

Credit quantities are PostgreSQL `bigint` and JavaScript `bigint`. The
[accounting owner](service-credits.md) allocates holds to original grant lots and
uses fixed-order locks for shared account, workspace and global admission.
Historical spending on an expired grant does not consume a later grant again;
uncertain allocations retain liability. Versioned fixture policy, refunds and
metadata-only reconciliation do not make production billing available.
[Durable job claiming and execution](service-jobs.md)
use the same scoped repository owner with worker-only dispatch permissions.

Row-level policies and role-specific application authorization extend the same
repository owner in [#31](service-authorization.md). Missing transaction scope
fails closed for tenant data. Private identity discovery and personal-account
bootstrap have narrow internal boundaries, separate from data access. Runtime
SQL credentials remain internal; row policies do not make arbitrary SQL safe for
untrusted clients. New endpoints must use the same authorization owner before
their data or effects become available.

## Migration and deployment commands

The existing build emits an operator CLI:

```sh
node apps/api/dist/database-cli.js migrate
node apps/api/dist/database-cli.js verify
```

Supply `THOLI_DATABASE_MIGRATION_URL` only to migration, and
`THOLI_DATABASE_URL` for runtime verification/repositories. URLs explicitly name
host, database, user and password. Production should use verified TLS, such as
`?sslmode=verify-full`; `sslrootcert` can supply a private CA with that mode.
Unsupported URL options and insecure TLS modes are rejected. Parsed connection
fields prevent ambient credentials, TLS or startup options from overriding the
selected configuration and bounded budgets.

Provision separate migration/runtime roles, using the existing local bootstrap
as the reference. The migrator owns the schema. Set
`THOLI_DATABASE_RUNTIME_ROLE` for the existing runtime role, default
`tholi_runtime`. Migration refuses privileged, owner or owner-assuming roles and
grants operations on named tables only. Runtime gets no DDL, TRUNCATE or blanket
future-table grants. DELETE is limited to expiring identity flows, brokers and
provider logout markers for one-use consumption and bounded cleanup. Saved data
remains tombstoned and catalog/financial tables remain append-only for runtime;
broader physical erasure remains later privileged deletion work.

Migration `003-portable-identity` extends the existing session foundation and
revokes pre-identity active session rows rather than interpreting them as issued
credentials. It leaves migrations 001/002 and their checksums intact. Identity
flow, broker and session operations share the existing transaction owner; provider
HTTP calls run outside those transactions. See [identity session security](service-identity.md#sessions-and-trust)
for refresh replay, account-wide revocation and provider logout fences.

Migration `004-tenant-authorization` adds tenant row policies, narrow trusted
helpers and scoped grants without changing earlier migration bodies. Replay
removes superseded broad grants before applying the current column permissions.
The migration owner retains operator backup/restore authority; the runtime
cannot assume that owner or bypass its policies.

Run migrations once before admitting traffic, not from every API replica. An
advisory lock excludes another migrator. Each version commits SQL and its SHA-256
history entry together. Replay rejects unknown/newer versions and changed bytes,
and reapplies explicit runtime grants. Append new bodies rather than changing
applied versions. `verify` is read-only and checks complete schema compatibility.
There is no automatic downgrade; use reviewed forward changes and backups.

Pools default to eight runtime connections and one migration connection.
`THOLI_DATABASE_POOL_MAX` configures CLI pools, bounded to 32 for runtime and two
for migrations; server role limits still apply. Default acquisition, statement,
lock and idle-in-transaction timeouts are 3, 5, 2 and 10 seconds respectively.
Programmatic pool options can select bounded budgets. Budget replicas, workers,
identity and rollout overlap together using the
[architecture example](../plans/gemini-cloud-and-enterprise.md#scaling-deadlines-and-connection-budgets).
Transaction-local scope does not require sticky connections or named statements.

## Backup, restore and verification

Use PostgreSQL `pg_dump` custom format and `pg_restore --single-transaction
--exit-on-error` into a separate database with the intended migration owner and
preprovisioned runtime role. Protect backups using restricted access, encryption
and the deployment's retention policy. Restore permissions as well as data, run
`database-cli.js verify`, compare records and exercise runtime access before
switching traffic. Production backup schedules, recovery drills and deletion
replay before restored data is served remain later operational work.

`npm run test:local-stack -- --optional` owns a fresh disposable project. Its
dedicated PostgreSQL test image exercises actual upgrades, constraints,
non-owner privileges, scoped queries, rollback and concurrent revisions/credits.
The existing smoke also repeats migration/seed, compares all application table
contents after backup/restore, checks runtime readback, retains data across
recreation and proves explicit reset followed by a fresh seed. Tests are absent
from the production runtime image. Redacted reports live under
`output/qa/local-stack/`; generated credentials are removed after cleanup.

Ordinary unit checks still require no Docker daemon. Existing private API/SQLite
tests retain ownership. The [testing policy](testing/README.md) requires
`test:ci` for PRs and full certification before packaging.
See the [fresh verification record](testing/postgres-validation.md).
