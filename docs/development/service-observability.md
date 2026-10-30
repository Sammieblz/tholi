# Portable service observability

Roadmap [#35](https://github.com/Sammieblz/tholi/issues/35) adds three separate
record classes to the existing API, worker, identity and account owners. It does
not enable live inference, cloud plans, financial charging or deployment.

## Operational telemetry

Set `THOLI_OBSERVABILITY_ENABLED=true` explicitly. With no collector endpoint,
the adapter writes bounded JSON lines only. `THOLI_OTLP_ENDPOINT` accepts an
HTTPS origin without credentials, path, query or fragment. Local HTTP additionally
requires `NODE_ENV=development` and `THOLI_OTLP_ALLOW_LOCAL=true` and is restricted
to the named local collector or loopback. No ambient cloud credentials, host
metadata, database statement capture or HTTP auto-instrumentation is used.

The shared application port accepts finite operation names, outcomes, registered
route operation IDs, provider/job kinds, status and error codes. The adapter
reconstructs every record. It excludes bodies, headers, SQL, error messages and
stacks, screenshot pixels, goals, private URLs, prompts, auth codes, tokens,
emails, account IDs, IP addresses and arbitrary attributes. A valid-looking field
name does not authorize arbitrary content. Metrics never include correlation IDs.

The API generates a request UUID and trace/span identifiers. Incoming tracing
headers are not trusted. `duringServiceRequest` installs the shared asynchronous
context for database and provider work. The existing enqueue transaction stores
that internal correlation in the job row. It is not part of a client command or
public job DTO. The independent worker restores the origin and creates a fresh
attempt span. Provider acceptance, handler return, durable acknowledgement and
independent navigation arrival remain different outcomes.

The queue defaults to 256 records and 256 KiB, with batches of at most 64 records
and 64 KiB before export encoding. Metric series have a separate fixed ceiling.
There is one export pump, bounded request/response sizes, bounded retries and
two-second export/shutdown budgets. Collector failure drops bounded telemetry
instead of delaying application requests. Readiness is independent of telemetry.
Shutdown accepts late application completions, closes application resources and
then flushes the observer within the existing runtime drain budget.

### Local collector, dashboards and alerts

Set the local environment's `THOLI_OBSERVABILITY_ENABLED=true`, then run:

```powershell
npm run local:up -- --profile telemetry
```

Use the documented [local stack command syntax](local-stack.md) if selecting an
alternate project/environment. The existing optional collector receives real
OTLP JSON logs, traces and cumulative metrics. Its debug exporter is local-only
and API, worker and collector logs rotate at 5 MiB across two files per container.
Its Prometheus exporter listens
at `telemetry:8889/metrics` only on the private application network. No telemetry
host port is published. Do not copy detailed debug export into a public host.

[Prometheus scrape and rule configuration](../../infra/observability/prometheus.yaml),
[alert rules](../../infra/observability/alerts.yaml) and the
[Grafana dashboard](../../infra/observability/dashboard.json) are portable
operator assets. Mount the two YAML files together, import the dashboard and
choose its Prometheus data source. A separately operated Prometheus must join the
private network and use a seven-day storage retention policy. Configure private
authenticated access, Alertmanager routing, recipients and persistent-volume
budgets for the deployment. The repository does not create a managed monitoring
account or claim that alerts have reached an operator.

The dashboard covers HTTP/provider errors and latency, SQL capacity, worker
health, due-queue age, dead/uncertain jobs, stale fences, retries and telemetry
loss. Missing series stay missing. Provider spend, model stale results,
Local/Free/Paid activation and allowance exhaustion are explicitly unavailable
until their authoritative producers exist in later milestones. Never infer an
installation from a store click or a paid activation from sign-in.

For hosted collectors enforce a seven-day operational TTL, encrypt transport
and storage, restrict operator access and disable content capture. Local API,
worker and collector Docker
logs use size rotation rather than a time-based TTL and disappear when their
owned containers are removed. Operator-retained exports/backups need their own
expiry and deletion process; this code cannot delete a third-party collector's
copy. No optional product consent is required to protect service security.

## Durable security audit

Migration 007 adds `security_audit`. Existing session creation/rotation/replay/
revocation, membership changes and consent changes append fixed metadata inside
the same database transaction. Rolled-back changes do not leave success audits.
Provider replay does not duplicate a successful revocation record. Delivery
receipts and credit ledgers are not copied into this table.

Runtime SQL has append-only scoped access and cannot select, update or delete
audit rows. An operator connection can run `database-cli.js audit-export` with
`account|workspace UUID LIMIT [AFTER_UUID]`; exports include account/workspace and
subject identifiers and require private operator handling. They are deliberately
not normal logs or public analytics. Rows expire after 90 days; bounded worker
maintenance or `audit-prune BATCH` deletes due records, including inactive accounts.
Expiry immediately excludes rows from the export helper; physical pruning can
lag behind a large backlog. Restrict operator exports and expire backup copies.
General account-erasure and saved-data export flows remain later roadmap work.

## Consented product analytics

The independently versioned [event contracts](../../packages/navigation-core/contracts-analytics.ts)
contain finite categories only. The current account page registers a disclosed
Tholi account-service provider inside its authenticated boundary. Both current
workspace `product_analytics` consent and provider/disclosure-specific browser
consent are required. Appearance choice, sign-in, onboarding and store clicks do
not grant either. Leaving the boundary or changing account unregisters the
provider, purges its bounded queue and aborts pending work.

Ingestion uses the existing authenticated account request/CSRF/generation owner
and the existing scoped PostgreSQL transaction. It rechecks account, membership
and locked current consent through commit. The server associates the actor;
clients cannot submit another actor's identifiers. Event IDs make retries
idempotent and ingestion is bounded. Records expire after 30 days and due
maintenance physically prunes them; expiry excludes them from normal reads.
The 1,000-event admission cap counts retained events from the last 24 hours.
Deleting or withdrawing removes those rows and frees that capacity. It is not
an undeletable abuse or financial ledger; transport admission is independent.

The account page can review and delete its own retained records without granting
collection consent. Withdrawing the account purpose atomically purges attributed
events; browser withdrawal stops/aborts collection without pretending to erase an
already accepted server copy. Essential auth/security/audit records and financial
ledgers remain separate. Public Local use and practice have no account provider.
The website's **Essential only** action withdraws both browser analytics and
appearance storage immediately; it does not change the separate account-purpose
grant. Saving an appearance choice does not grant analytics consent.
Future cloud activation/allowance schemas are reserved but rejected by current
ingestion. No automatic local-data upload is introduced.
The public onboarding/practice/store funnel is unavailable to the configured
account provider, rather than reported as a zero-count funnel.

## Validation

Use the focused API/account/privacy owners, real PostgreSQL contracts and
`npm run test:local-stack -- --optional`. The latter inspects actual API/worker
JSON and collector output after an invalid bound OIDC exchange and interrupted
SMTP retry. It verifies shared correlation, fresh attempt spans and absence of
private sentinels without retaining raw records. See the
[validation record](testing/service-observability-validation.md). The normal
`test:ci` gate still runs once before a PR is merged. No release archive or
deployment is authorized by these checks.

The wire encoding follows the official
[OTLP JSON mapping](https://opentelemetry.io/docs/specs/otlp/#json-protobuf-encoding).
The local metric endpoint uses the pinned collector's
[Prometheus exporter](https://github.com/open-telemetry/opentelemetry-collector-contrib/blob/v0.164.1/exporter/prometheusexporter/README.md).
