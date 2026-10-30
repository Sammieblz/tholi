# Local backend stack

Roadmap [#27](https://github.com/Sammieblz/tholi/issues/27) supplies development
infrastructure for the [portable backend](../plans/gemini-cloud-and-enterprise.md).
It uses the existing API build and service runtime, with optional account/session
integration from [#30](service-identity.md). Local extension guidance and the
optional SQLite/private API remain independent of accounts.
The configured stack also provides [support mail and private diagnostic files](service-support.md).

## Prerequisites and startup

Use Node **24.19.x**, Docker Engine with Linux containers, and Docker Compose v2
with `up --wait` support. Docker Desktop with WSL2 works on Windows. Start the
engine first and allow enough memory for PostgreSQL and Keycloak alongside Node
builds. The first image build and pulls need internet access. Running the default
stack needs no provider account, cloud project or model download.

From the repository root:

```sh
npm run local:init
npm run local:up
node scripts/local-stack.mjs status
```

`local:init` creates an ignored `.env`, generates separate local credentials and
refuses to overwrite an existing file. Keep it private. On Windows the file uses
your directory's ACLs; choose a private working directory. `.env.example` explains
the supported settings and contains only disposable development values. These
credentials and the local realm must never be used for a hosted environment.

For an environment created before identity integration, append its missing
settings without replacing the file or deleting data:

```sh
npm run local:init -- --upgrade-identity true
npm run local:up
```

The explicit upgrade preserves existing secrets, ports and project settings.
See [identity setup](service-identity.md#local-setup) for the website service
origin and browser callback registration.

For a retained environment from before support/private-file integration:

```sh
npm run local:init -- --upgrade-support true
npm run local:up
```

This appends the dedicated file-link key and any missing storage credentials.
It preserves existing secrets and volumes. The generated 32-byte base64url
file-link key is separate from the identity flow-encryption key.

The API uses the pinned, non-root image built by `apps/api/Dockerfile` through
`build:api`, not the extension/model build or a release packager. The image keeps
the existing API entrypoints and their shared chunks. Its Node/Debian base matches
the repository engine and native CPU dependencies. It is reusable by the durable
worker through `worker.js`. The [durable worker](service-jobs.md) performs scoped
identity maintenance with separate SQL credentials and live polling health.

## Services and trust boundaries

| Service            | Host access                          | Container address             | Persistence                         |
| ------------------ | ------------------------------------ | ----------------------------- | ----------------------------------- |
| API                | `http://127.0.0.1:8788/health/ready` | `api:8788`                    | Account/session state in PostgreSQL |
| Durable worker     | None                                 | SQL, SMTP and private storage | Job state and outbox in PostgreSQL  |
| PostgreSQL         | None                                 | `postgres:5432`               | Named PostgreSQL volume             |
| Local OIDC         | `http://localhost:18080`             | `oidc:8080`                   | Dedicated database in PostgreSQL    |
| Mail capture       | `http://localhost:18025`             | SMTP `mail:1025`              | Named Mailpit volume                |
| Private S3 storage | `http://localhost:18333`             | `storage:8333`                | Named storage volume                |
| Optional telemetry | None                                 | OTLP HTTP `telemetry:4318`    | No durable telemetry store          |

Ports are adjustable in `.env`; all published ports bind to loopback on the local
gateway. It proxies only the four fixed application, identity, mail and private
storage destinations. This makes services reachable on Docker Desktop without
giving those services internet egress. The gateway carries no service credentials
and exposes no general-purpose forward proxy. Internal Docker networks keep
database/identity traffic separate from application-facing services and deny
outbound internet access to those services. No model provider credentials or
SMTP relay settings pass into the default API. The durable worker receives
capture-only SMTP settings; mail goes only to Mailpit. The
collector has only a local debug sink and no external telemetry destination.
The private S3 service requires generated credentials and denies anonymous reads.
The seven long-running default services are gateway, API, worker, PostgreSQL,
OIDC, Mailpit and storage; two one-shot services initialize SQL and identity.

The API runs as a non-root user with a read-only root filesystem, writable tmpfs,
dropped Linux capabilities and no privilege escalation. Images are pinned to
version and manifest digest. Health probes check local services without inference
or paid requests. The configured API checks its PostgreSQL schema during startup
and readiness. It does not treat readiness as proof of provider login, mail
delivery or native browser authorization. A discovery-only API launched without
identity configuration retains its empty dependency set.

The PostgreSQL bootstrap separates administration, migrations, runtime and OIDC
ownership. Application runtime credentials cannot create schemas or bypass RLS.
Use the migration role only for schema changes. PostgreSQL, Keycloak and API
pools have explicit connection bounds; future workers and additional replicas
must fit the
[adopted connection budget](../plans/gemini-cloud-and-enterprise.md#scaling-deadlines-and-connection-budgets).
Do not publish PostgreSQL or identity management ports to a public interface.

## Infrastructure migrations and identity seed

Initial PostgreSQL startup creates the local databases and roles. The identity
container imports `infra/local/oidc/tholi-local-realm.json` on its first startup.
The sample identity is synthetic and local-only; use the username in that file
and `OIDC_TEST_PASSWORD` from your private `.env`. The admin password is separate.
Dedicated `database-migrate` and `identity-configure` initialization containers
apply the service schema and reconcile the local realm/client before the API
starts. HTTP replicas never run migrations or identity administration. The
application account/workspace seed is synthetic and does not sign a user in.
Use the separate [identity guide](service-identity.md) for real local sign-up,
website sessions, native extension login and verification/recovery mail.

```sh
npm run local:migrate
npm run local:seed
```

`local:migrate` reapplies infrastructure bootstrap, then runs checked, versioned
application migrations through the operator-only API-image command. See
[service database setup, roles and pooling](service-database.md). Keep migration
execution as a one-shot operator command rather than racing it from API replicas.

`local:seed` reconciles the owned realm settings and confidential `tholi-service`
client while retaining existing users and their credentials. It also idempotently
provisions a separate synthetic Tholi account and personal workspace after
migrations, without granting credits or paid entitlements. The initializer uses
the same identity seed owner, so retained installations gain the registered
client without a reset. Realm import alone does not update retained installations.

Changing `OIDC_TEST_PASSWORD` or the administrator password in `.env` does not
rotate an existing identity user's credentials. Database-role passwords are
reapplied by the explicit infrastructure migration. The owned OIDC client secret
is reconciled from its configured value. Coordinate credential rotation and
session invalidation using the [identity policy](service-identity.md#sessions-and-trust),
rather than deleting data.

The canonical local issuer is
`http://localhost:18080/realms/tholi-local` (adjust for your chosen port). Containers
reach discovery/JWKS through `oidc:8080`; the issuer must remain the canonical
browser URL. Container `localhost` refers to that container. The configured adapter
validates the public issuer and uses explicit internal token/JWKS endpoints. The
website dev server remains `http://127.0.0.1:5174`; use the configured
`127.0.0.1` API origin for account flows so browser-binding cookies return to the
same host. The confidential client's exact callback, logout return and internal
backchannel are reconciled by the seed. Native browser callbacks require their
own exact registrations, without wildcards.

## Storage, optional telemetry and model policy

```sh
npm run local:up -- --profile storage --profile telemetry
```

Storage is a default dependency consumed by the support/private-file adapter.
The `--profile storage` option remains accepted for compatibility. Telemetry is
still optional: it accepts OTLP HTTP and writes local debug output; send synthetic
data only. Its production observability adapter belongs to the telemetry ticket.
Read generated storage credentials from `.env`; do not copy them into client bundles.

The service configuration defaults to `THOLI_MODEL_PROVIDER=fake`. At this stage
that is a cloud-free policy, not a navigation endpoint. Configured identity adds
accounts, session security, tenant policy, durable jobs and configured support,
without cloud navigation. The typed deterministic
fake and Gemini inference adapters belong
to [#39](https://github.com/Sammieblz/tholi/issues/39). The legacy private API keeps
its existing local NLP/OCR behavior independently.

`infra/local/compose.gemini.yaml` is a separate explicit opt-in configuration. It
requires spend-limit and opt-in settings. This version **rejects live
inference at startup**, even when those settings are supplied, because it cannot
yet enforce a provider budget. It has no paid-call capability. Do not enable
network egress or add provider credentials to the default profile. The later
adapter must implement actual admission/reservation and billed-usage limits
before live experiments can be authorized.

## Stop, retain or delete data

```sh
npm run local:down
npm run local:up
```

Normal teardown removes containers and networks but retains named volumes.
PostgreSQL 18 stores its cluster under the versioned directory in the mounted
`/var/lib/postgresql` volume. Recreating containers must preserve the database,
realm, captured mail and private object data. An image upgrade is not a database
major-version migration; back up and follow the database upgrade procedure.

For a deliberate full local reset:

```sh
npm run local:reset -- --confirm-delete tholi-local
```

This deletes **all named data volumes for that Compose project**, including
identity, database, mail and storage. Substitute your actual project
name if changed. The exact confirmation is required. The command does not remove
your `.env`. Never run it against a production project. Do not use `down -v` as
routine teardown. Use separate `--project` and `--env-file` values for independent
local stacks.

## Verification

See [gateway, CDN and TLS delivery](service-delivery.md) for proxy trust, direct
API protection, private cache boundaries and the separate VM TLS reference.
The local listener remains loopback HTTP; a VM TLS override does not turn the
development identity realm or captured SMTP into hosted production services.

```sh
npm run test:local-stack -- --optional
```

The smoke command creates its own project and fresh volumes, generates disposable
credentials, builds the API image and waits for real services. It checks health,
identity discovery, captured synthetic mail, safe configuration, actual proxy/TLS
boundaries and unchanged raw request bytes, database retention
across container recreation, private storage, support mail and optional telemetry. It then deletes only
the project and volumes it created. It never resets the developer project.
Evidence under `output/qa/local-stack/` records source/config/image identities and
observed results without raw credentials. Cached image layers are allowed;
fresh-volume evidence is not a claim to have tested every host OS.

The synthetic TLS check needs OpenSSL. Linux CI uses its installed command;
Windows prefers Git for Windows' native `mingw64/bin/openssl.exe`, then an
`openssl` command on PATH. The runner removes its synthetic private key after
checking and never uses it as a deployment certificate.

The Linux `containers` CI job runs this smoke independently of the existing
Windows/browser matrix and participates in the required `validate` gate. Fast
unit tests cover command safety and the same normalized Compose policy without
requiring a Docker daemon. `npm run test:ci` remains the deterministic application
PR gate. No image is published and no production resource is deployed by these
commands. Full certification is required separately before release packaging.

See the [dated verification record](testing/local-stack-validation.md) for actual
host coverage, findings and current evidence status.
