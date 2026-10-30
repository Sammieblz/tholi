# PostgreSQL service database

Roadmap [#28](https://github.com/Sammieblz/tholi/issues/28) implements the database
foundation of the [portable backend decision](../plans/gemini-cloud-and-enterprise.md).
The same migrations and repositories run locally, on a VM or against hosted
PostgreSQL. They never read, migrate or upload the private SQLite knowledge.
The HTTP service still exposes health endpoints only.

## Local setup

Follow [local stack setup](local-stack.md), then run:

```sh
npm run local:migrate
npm run local:seed
```

Migration reapplies infrastructure bootstrap, then applies versioned application
migrations. Seed preserves the OIDC realm and idempotently provisions one synthetic
Tholi account and personal workspace. Their UUIDs end in `0028` and `0029`.
It grants no credits or paid entitlement and does not implement application login.
The operator-only `database-tools` container reuses the API image; its migration
credentials never enter the HTTP service. The seed requires both
`NODE_ENV=development` and `THOLI_ALLOW_DEV_SEED=true`.

`local:down` retains data. `local:reset -- --confirm-delete EXACT_PROJECT` removes
only that project's volumes. Migrate and seed again after an explicit reset.

## Owners and data

`apps/api/src/database/` owns the pool, scoped repositories, typed records,
versioned migrations and one-shot CLI. Migration SQL is embedded in TypeScript
so the existing API build carries the exact bytes without a second SQL tree.

| Area                 | Stored foundation                                                             |
| -------------------- | ----------------------------------------------------------------------------- |
| Identity and scope   | Accounts, issuer/subject links, workspaces, memberships and session metadata  |
| Consent and requests | Versioned decisions, scoped command keys, canonical payload hashes and status |
| Plans and usage      | Immutable plan versions, workspace entitlements and integer model usage       |
| Credits              | Integer grants, reservations and immutable settlements; one derived ledger    |
| Saved data           | Account-owned saved routes, optimistic revisions, sync stamps and tombstones  |
| Background work      | Scoped job references, lease/status fields and transactional outbox metadata  |

Composite foreign keys and uniqueness keep tenant references within their
workspace. Indexes cover foreign keys, scoped lookups, sync and pending work.
Requests store hashes and metering references, not raw prompts, DOM, images or
inference projections. Saved routes reuse `savedTaskSchema` and
`parameterizedTask`; there is no arbitrary JSON artifact or local mirror import.
Jobs admit typed record references, not browsing data or credentials.

## Transactions and scope

`PostgresRepositories.transaction(scope, callback)` checks the active account and
membership, freezes a copy of scope and supplies transaction-bound repositories.
Later identity/authorization owners create that server-validated context. A
request body cannot grant scope. Internal account provisioning is the explicit
bootstrap exception.

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

Credit quantities are PostgreSQL `bigint` and JavaScript `bigint`. Workspace-first
locking and unique keys prevent concurrent overspending and duplicate settlement.
The balance foundation conservatively subtracts historical settlements from
unexpired grants and retains active/uncertain holds after their deadlines.
Grant allocation, expiry reconciliation, refunds, pricing and provider uncertainty
policy remain [#44](https://github.com/Sammieblz/tholi/issues/44). This is not a
completed billing system. Job claiming/execution remains #32.

RLS and role-specific application authorization remain
[#31](https://github.com/Sammieblz/tholi/issues/31). No RLS policy is claimed here.
Runtime SQL credentials remain internal, and new cloud endpoints must not be
exposed before authentication/authorization pass. Scoped repositories already
enforce ownership; they do not make arbitrary SQL safe for untrusted clients.

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
grants operations on named tables only. Runtime gets no DDL, DELETE, TRUNCATE or
blanket future-table grants. Catalog/financial tables are append-only for runtime;
physical erasure remains later privileged deletion work.

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
