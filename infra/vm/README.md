# Standalone VM service profile

[compose.yaml](compose.yaml) runs the existing API, independent worker and one-shot
migration command from **one reviewed immutable image**. It does not build a VM
fork. PostgreSQL remains private; only the TLS gateway publishes ports. The
superseded gateway-only overlay has been removed.

This is a production-style reference, not deployment authorization or a claim of
high availability. The account, model, legal, dependency and release gates in
[service security](../../docs/development/service-security.md) still apply.

## Protected configuration

Use Compose 2.24.4 or newer from the repository root. Keep credentials outside the
checkout, with an operator-only parent directory and files readable only by their
owner. Do not print resolved environment values in logs.

The operator deployment env file selects these inputs:

| Input                    | Purpose                                               |
| ------------------------ | ----------------------------------------------------- |
| `THOLI_SERVICE_IMAGE`    | Reviewed registry reference ending in `@sha256:...`   |
| `THOLI_VM_API_ENV`       | Absolute protected API env-file path                  |
| `THOLI_VM_WORKER_ENV`    | Absolute protected worker env-file path               |
| `THOLI_VM_MIGRATION_ENV` | Absolute protected migration env-file path            |
| `THOLI_VM_POSTGRES_ENV`  | Absolute protected PostgreSQL bootstrap env-file path |
| `THOLI_TLS_DIRECTORY`    | Absolute certificate directory, read-only in gateway  |

API configuration uses the existing [identity](../../docs/development/service-identity.md)
and [service](../../docs/development/service-api.md) settings. Set the runtime
`THOLI_DATABASE_URL`, production HTTPS issuer and all four identity endpoints,
client ID, dedicated client secret and flow-encryption key, exact website/API
origins and approved native callbacks. Use a parent/child website/API topology,
such as `https://tholi.io` and `https://api.tholi.io`, as required by the existing
cookie policy. A local development realm is not a production identity provider.

The worker file contains only its `THOLI_DATABASE_WORKER_URL` and selected worker
transports. The migration file contains only its `THOLI_DATABASE_MIGRATION_URL`.
Use the existing roles `tholi_runtime`, `tholi_worker` and `tholi_migrator`.
Their URLs target private `postgres:5432/tholi`; never distribute the admin
password to application containers.

The PostgreSQL file supplies `POSTGRES_PASSWORD`, `THOLI_DB_PASSWORD`,
`THOLI_WORKER_PASSWORD`, `THOLI_MIGRATION_PASSWORD` and `OIDC_DB_PASSWORD` for the
existing bootstrap owner. The last credential reserves the separate identity
database; this profile starts no development identity service or test user.

The profile fixes production cookie/catalog behavior and disables managed and
customer-funded model transmission. It preserves operator-selected support
settings: enabling support requires matching API/worker configuration, verified
HTTPS private object storage and encrypted external SMTP. Without it, account
exports and deletion cleanup are unavailable. Do not admit production accounts
until these data-lifecycle transports and the other security gates are verified.
No local Mailpit, public object bucket or mock identity is substituted.

## TLS and startup

1. Replace the canonical `api.example.test` hostname in [nginx.conf](nginx.conf)
   with the exact approved API hostname.
2. Mount operator-issued `fullchain.pem` and `privkey.pem`. Gateway UID/GID
   `101:101` must be able to read them. On a dedicated Linux host, a protected
   parent directory, group 101, directory mode 0750 and key mode 0640 are suitable.
   Synthetic QA keys must never be deployed.
3. Review the complete configuration without printing secrets:

   ```sh
   docker compose --project-directory . --env-file /protected/deployment.env --project-name tholi-vm -f infra/vm/compose.yaml config --quiet
   ```

4. After separate deployment approval, obtain the exact reviewed image in the
   host image store. The profile uses `pull_policy: never`, so startup cannot
   silently replace that artifact. Use the same Compose invocation with
   `up --detach --wait`. PostgreSQL becomes healthy, the migration initializer
   completes, then API/worker readiness admits the gateway.
5. Validate the mounted certificate with normal verification, the exact hostname,
   no-store responses, real OIDC/native callbacks and account isolation. A store
   installation or a redirect alone is not successful authentication.

The API and worker run nonroot, read-only, without added capabilities or public
ports. The database network is internal.
PostgreSQL omits statement/parameter logging and verbose row details from errors;
inspect sanitized service classifications instead of collecting private payloads.
Application egress is available for
explicit identity/support endpoints; restrict the host firewall and outbound
policy for the selected transports before deployment. No model egress is enabled.

## Capacity and operations

[capacity.json](../capacity.json) allocates 60 database connections: two API
replicas at four connections, two workers at two, identity six, migration two,
operations eight, rollout twelve and emergency headroom twenty. The default is
one API and one worker. Treat two of each as the reviewed VM ceiling; additional
containers require a revised capacity review. SQL role limits enforce aggregate
runtime eight and worker four connections. This is not an autoscaler or a
billing cap. API/worker drain is eight seconds inside the ten-second container
grace period.

Use the existing database migration lock and checksum ledger. Replicas never
migrate themselves. No production seed is enabled. Back up the application
database and approved private objects to encrypted, access-controlled off-host
storage and perform restoration drills. Follow the existing
[quarantined restore and incident runbook](../../docs/development/service-security.md).
Do not expose PostgreSQL, identity administration or telemetry ports publicly.

A known-good image/configuration can be restarted after a rejected candidate.
Schema rollback is different: strict schema checks can reject an older image
against a newer database. Prefer a reviewed roll-forward; otherwise restore a
compatible snapshot in quarantine and replay current deletion, consent and
credential-removal records before opening traffic. Never downgrade migrations
automatically.

For certificate renewal, replace the protected files, run `exec gateway nginx -t`
and then `exec gateway nginx -s reload` through the same Compose invocation.

## Evidence

`npm run test:local-stack -- --optional` exercises this standalone profile after
the local profile, reusing the exact API/worker image ID and migration bytes.
It uses a separate owned Linux-VM Compose project, synthetic TLS, controlled
database identities and no external provider traffic. It checks secure cookies,
canonical callbacks, concurrent migration replay, scoped HTTP reads, a rejected
candidate, restoration/readback and retained data after restart.

These checks do not certify a physical remote VM, production identity provider,
DNS/certificate issuance, external SMTP/object service or Google Cloud.
