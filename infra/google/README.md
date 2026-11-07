# Google deployment preparation

This Terraform profile prepares Cloud Run HTTP, a continuous Cloud Run worker
pool and a one-shot migration job. All three select the **same application image
digest**. Infrastructure adapters stay outside application services. No Google
SDK, database identity function or second scheduler is added to domain code.

**Nothing here has been provisioned.** The deterministic checks use a mocked
provider with container networking disabled. The provisioning interlock defaults
to false; enabling it is not budget, deployment or release authorization. Keep it
false while the user requires zero spending. Regional SQL, worker capacity,
load balancing, secrets and storage can incur charges even without model calls.

## Prepared infrastructure

- Cloud Run service: internal/load-balancer ingress, startup schema readiness,
  process liveness, finite request concurrency and at most four API instances.
- Continuous worker pool: manual capacity initially one, configurable zero to
  two, using the existing worker scheduler and leases. A request-throttled HTTP
  service does not supervise this polling loop.
- Private PostgreSQL 18: regional Cloud SQL, no public IP or authorized public
  networks, 100-connection allocation, backups, point-in-time recovery and deletion
  protection. Workload-local pinned Cloud SQL Auth Proxies use private IP and
  verified encrypted database connections. Their application listeners bind only
  loopback; database URLs in secret versions target `127.0.0.1:5432/tholi`.
- Three dedicated service accounts: API, worker and migration. They receive SQL
  connector access and only their named secret records. There are no service-account
  key resources, default editor grants, model permissions or secret values in
  Terraform. Secret versions are numeric and cannot silently advance to `latest`.
- HTTPS load balancer and managed certificate, with API CDN caching and load-balancer
  request logging disabled. Automatic Cloud Run request logs are excluded because
  their URLs can contain authorization codes. Application audit/observability keeps
  its existing minimized owners. Cloudflare can continue hosting the website.

The API's public transport invocation is allowed only inside the configured
Cloud Run ingress boundary; it does not bypass Fastify account, origin, CSRF,
consent or quota checks. Verify direct public `run.app` rejection after any real
deployment. Health endpoints grant no account or journey authority.

## Configuration and phased execution

Use Terraform 1.13.5 and the locked Google provider 7.30.0. Keep operator variable
files outside the repository. Their secret entries contain IDs and versions,
never passwords, tokens, model keys or ciphertext keyrings.

Required nonsecret inputs are `project_id`, `region`, `api_domain`, `service_image`
and the HTTPS OIDC/web values listed in [variables.tf](variables.tf). Website and
API must retain the existing cookie-domain topology, such as `tholi.io` and
`api.tholi.io`. Register the exact service callback and Chrome/Firefox native
returns with the selected real OIDC provider. The development Keycloak realm is
not deployed or promoted by this profile.

The `secrets` object has three maps, each mapping environment-variable names to
`{ secret = "existing-record-id", version = "1" }`. The records must be distinct:

| Runtime   | Required secret references                                                                 |
| --------- | ------------------------------------------------------------------------------------------ |
| API       | `THOLI_DATABASE_URL`, `THOLI_IDENTITY_CLIENT_SECRET_KEY`, `THOLI_IDENTITY_FLOW_SECRET_KEY` |
| Worker    | `THOLI_DATABASE_WORKER_URL`                                                                |
| Migration | `THOLI_DATABASE_MIGRATION_URL`                                                             |

The following is an operator sequence for a **separately authorized future
deployment**, not a command to execute during this ticket:

1. Approve a cost envelope, region, production identity, ingress/DNS ownership,
   recovery policy and a certified immutable image. Review the remaining
   [security gates](../../docs/development/service-security.md). Enable the required
   Run, Compute, SQL Admin, Service Networking, Secret Manager and Logging APIs
   through the operator's approved process. This module does not enable APIs or
   change billing. Use short-lived operator identity rather than downloaded keys.
2. Prepare protected versioned secrets with separate SQL credentials. Review the
   VPC/subnet CIDRs against existing networks. With `enable_workloads=false`, the
   foundation phase prepares SQL, network, runtime identities, secret grants and
   the migration job definition. No API or worker starts against an empty schema.
3. Through an approved private administrative connection, run
   [bootstrap.sql](bootstrap.sql), which reuses the existing role/database bootstrap
   and applies the Google connection allocation. Supply its password variables
   through the protected operator environment. Do not open a public SQL port.
4. Execute the defined migration job once and inspect its exit and schema ledger.
   It runs the existing migration CLI with the existing advisory lock/checksums,
   one task and zero automatic retries. The small infrastructure wrapper stops
   the job-local proxy after either migration success or failure. No schema logic
   is duplicated in Terraform or the wrapper.
5. Only after bootstrap/migration acceptance, a second approved change enables
   `enable_workloads=true`. Publish the approved API DNS record to the load-balancer
   address and wait for certificate issuance. Do not change the existing website
   domain or origin build input implicitly.
6. Verify TLS, direct-ingress rejection, no-store/callback behavior, real OIDC and
   native callbacks, tenant isolation, operational alerts and a quarantined restore
   before admitting production accounts. Startup probes are not a substitute for
   ongoing dependency monitoring or native identity verification.

## Deliberately unavailable services

This first profile fixes managed and customer-funded model transmission off. It
does not grant Vertex permissions or enable BYOK egress. Development allowances,
production product availability, live quality review and billing keep their
existing gates. Local extension processing remains account-free.

Support transports are also disabled in this prepared Google profile. Actual
account export/deletion needs private object storage and encrypted external mail
through the existing S3/SMTP ports before production accounts can be enabled.
Google Storage's XML/HMAC interoperability is a possible adapter configuration;
it has not been tested here. That later configuration needs a private bucket,
least object/bucket permissions, lifecycle/retention, separate secret references
and actual restore/deletion verification. Do not expose a bucket or claim that
unconfigured exports or deletion cleanup work. No paid storage/mail service is
provisioned by preparation.

## Capacity, rollback and evidence

[capacity.json](../capacity.json) allocates 100 connections: API 32, workers eight,
identity ten, migrations two, operations eight, rollout sixteen and emergency
headroom twenty-four. An external identity database does not free that reserve
for unreviewed scaling. Manual worker capacity is capped at two in configuration.
This is a capacity bound, not a financial cap or proof of throughput.

API/worker retain the existing eight-second drain and shared SQL timeouts. Failed
interactive work keeps its original idempotency and uncertain-outcome rules.
Cloud Run job supervision does not retry migrations. Never roll an old image back
against an incompatible schema: prefer a reviewed roll-forward, or restore a
compatible snapshot in quarantine and replay current deletion/consent/credential
removal records under the existing incident/restore runbook.

Run `npm run test:deployment` for format, locked provider-schema and mocked
foundation/workload/interlock checks. Provider download has no credential mount;
planning tests run with networking disabled. The temporary provider cache lives
in an owned Docker volume and is removed afterward, rather than adding thousands
of files to the checkout. Reports include source hashes under ignored
`output/qa/deployment-profile/`.

Local VM checks additionally execute the same migration CLI with a synthetic
loopback proxy shutdown endpoint. That proves wrapper supervision locally,
not actual Cloud SQL IAM, proxy connectivity, regional availability, certificate
issuance, managed backups or deployed Google behavior.

Primary references: [worker pools](https://docs.cloud.google.com/run/docs/deploy-worker-pools),
[worker probes](https://docs.cloud.google.com/run/docs/configuring/workerpools/healthchecks),
[SQL proxy](https://docs.cloud.google.com/sql/docs/postgres/sql-proxy),
[supported PostgreSQL versions](https://docs.cloud.google.com/sql/docs/postgres/db-versions),
[Storage interoperability](https://docs.cloud.google.com/storage/docs/interoperability),
and [Terraform provider mocks](https://developer.hashicorp.com/terraform/language/tests/mocking).
