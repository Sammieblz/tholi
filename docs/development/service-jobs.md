# Durable work and scheduling

The portable service runs noninteractive work in an independent process from
the same API image. Run `npm run build:api`, then `npm run start:worker` with an
explicit `THOLI_DATABASE_WORKER_URL`. HTTP replicas expose job status and
cancellation but never poll the queue. Local navigation, OCR workers and the
SQLite/private API retain their existing owners.

## Current work and boundaries

The first registered handler, `identity.prune-expired-brokers` version 1,
removes at most 100 expired identity handoff records for one currently active
account and its personal workspace. It returns only a processed count. It does
not read or return credentials. Existing bounded identity cleanup remains in
place for flow and logout metadata.

Jobs carry typed record identifiers, never goals, page text, URLs, screenshots,
tokens or serialized browser state. Interactive navigation stays request-scoped.
The worker does not own a browser journey or authorize browser or OS actions.
Future mail and storage handlers extend this boundary in their own milestones;
the current process does not deliver email or contact model providers.

## Leases and transaction ownership

PostgreSQL is the single queue and lease owner. Competing workers claim bounded
batches with `SKIP LOCKED`, commit the claim, then open a scoped transaction for
the effect. Each claim gets a fresh UUID fence independent of the process ID.
A stale or expired fence cannot heartbeat, commit a result or acknowledge work.
Workspace locks precede job locks in scoped effects and user mutations.

The current SQL-only handler commits its effect, safe result, final status and
completion outbox publication together. A lost acknowledgement cannot repeat a
committed logical effect. The outbox has no independent competing dispatcher or
retry loop. Producers enqueue references and associated domain changes within
the same existing repository transaction.

Workers recheck current account and membership before effects through the
shared authorization owner. Revocation blocks execution even when enqueue was
authorized earlier. Each new handler must declare its actual consent and
replay requirements; a client cannot declare an operation replay-safe.

## Cancellation, retries and recovery

`GET /api/v1/workspaces/{workspaceId}/jobs` and its `/{jobId}` detail route
return actor-private, bounded status metadata. They omit internal references,
lease credentials and worker identifiers. Even workspace administrators cannot
inspect another actor's jobs through these endpoints.

`POST /api/v1/workspaces/{workspaceId}/jobs/{jobId}/cancel` requires the current
revision and the existing identity/CSRF guards. Queued work can be cancelled
immediately. Running work records a durable cancellation request and cooperates
with the handler; that response does not claim an irreversible effect stopped.

Transient replay-safe failures use bounded exponential backoff with jitter and
an attempt limit. Permanent failures finish as failed. Exhausted work becomes
dead. An expired non-replay-safe operation or ambiguous external outcome becomes
uncertain and has no generic automatic redelivery path. Heartbeats cannot revive
an expired lease.

Inspect safe job metadata through the authorized status endpoints. An operator
can retry a known replay-safe dead job using the migration credential and its
current revision:

```sh
node apps/api/dist/database-cli.js retry-job WORKSPACE_UUID JOB_UUID REVISION identity.prune-expired-brokers 1
```

The command preserves logical keys and attempts, adds one bounded attempt and
rejects stale revisions, unregistered kinds and uncertain outcomes. It is not an
HTTP operation and worker/HTTP roles cannot execute its recovery helper.

## Scheduler and deployment

Every worker may propose bounded maintenance schedules. PostgreSQL supplies the
time slot and current eligible actor/workspace metadata. A deterministic key
including the actor UUID deduplicates competing schedulers and restarts. Only
scoped reference rows enter the queue.

The local Compose stack starts a hardened worker without host ports, provider
credentials, identity credentials or migration credentials. Its separate
non-owner SQL role has only dispatch helpers and the scoped capabilities needed
by registered work. It cannot assume the HTTP or migration role. The worker
health check requires a fresh marker from successful live polling, not merely a
separate successful database connection.

For an older local environment, preserve existing secrets and volumes:

```sh
npm run local:init -- --upgrade-worker true
npm run local:migrate
npm run local:up
```

The same image, handler contract and SQL queue run on a VM or cloud container
platform. No cloud queue or scheduler is required. A future wrapper must preserve
the same idempotency and authorization rules and demonstrate a measured need.

Each worker has at most two concurrent handlers and four SQL connections.
Defaults are a 30-second lease, 10-second heartbeat, one-second poll, 60-second
scheduler interval and 60-second maximum retry backoff. Process shutdown stops
claims, signals cooperative cancellation and permits eight seconds to drain.
Budget all replicas and connection overlap before scaling; local role limits
are not a production autoscaling policy. See the
[adopted capacity budgets](../plans/gemini-cloud-and-enterprise.md#scaling-deadlines-and-connection-budgets).

[Validation evidence](testing/service-jobs-validation.md) records completed
checks separately from intended behavior.
