# Service scaling and resilience

Roadmap #47. API/extension remain 0.11.0 and website 0.1.1. This is local
development evidence, with zero external model calls. Production capacity,
hosted accounts and live model quality remain gated separately.

## Reproduction and ownership

Run `npm run test:local-stack -- --optional`. The existing smoke owns a fresh
Compose project, runs the real PostgreSQL contract suite and complete local/VM
checks, resets to a fresh application seed, then applies
[compose.replicas.yaml](../../../infra/local/compose.replicas.yaml).
Two independently running API containers and two workers share one PostgreSQL
database. All four use the same immutable runtime image. The probe addresses each
replica explicitly, without sticky sessions. Its authenticated identities are
controlled database fixtures, not real provider login.

The existing PostgreSQL test image owns the coordinator. It has no Docker socket,
host ports or external-model credentials. Lease capabilities and access tokens
stay in memory. The host receives static phase flags and sanitized outcomes and
only stops, pauses or removes identity-checked containers in its own project.
Ordinary developer services and browser profiles are untouched.

The composition drill separately injects deterministic throttling, unknown
outcomes and held inference into two real HTTP/SQL runtimes through the existing
composition seam. It stops the ordinary API pair first, respecting the SQL role
limit. It does not claim a real provider failed or that these test compositions
are the released runtime image.

## Capacity and backpressure

The shared [connection allocations](../../../infra/capacity.json) remain the
capacity owner. The VM ceiling is two API pools of four and two worker pools of
two, within aggregate SQL role limits of eight and four. The Google preparation
caps the API service at four instances with pools of eight, workers at two with
pools of four, and reserves migration, identity, operations and rollout capacity.
These are ceilings, not a recommendation to autoscale to them without measurements.
Roll local containers one at a time without adding a third instance.

The HTTP owner admits at most 32 ordinary in-flight requests per replica and
eight per verified account, plus four independently bounded cancellation/health
requests. Excess ordinary work receives a safe 429 or 503 with Retry-After rather
than entering an unbounded application queue. Admission uses current verified
identity, never a caller-supplied account header. Global transport admission
precedes body parsing. Peer buckets remain finite and give control operations a
separate allowance. These replica-local guards supplement shared SQL quotas.

Operator inputs `THOLI_SERVICE_MAX_CONCURRENT_REQUESTS`,
`THOLI_SERVICE_MAX_CONCURRENT_PER_ACCOUNT` and `THOLI_SERVICE_CONTROL_RESERVE`
configure the bounded transport envelope. Per-account capacity cannot exceed
ordinary replica capacity. Existing receive, application, database-acquisition,
statement, lock and shutdown deadlines remain intact. No automatic model retry,
provider switch or account-budget increase is added.

The SQL adapter independently caps waiting acquisitions at four times its pool
size, including work left after a caller times out. Both promise and callback paths
reject excess work safely and recover when capacity returns.

Migration 16 bounds the shared active SQL job backlog, including uncertain jobs:
2,048 ordinary jobs, 64 ordinary jobs per workspace and a separate 128-slot
recovery reserve for account deletion, file expiry and inference reconciliation.
Operators may lower or explicitly review bounded limits in `tholi.job_admission`;
HTTP and worker roles cannot change them. Existing jobs can drain after an upgrade
which starts above a limit. Replays consume no new slot, and completion, cancellation
or deletion releases one transactionally. Workers retain two active handlers each,
bounded claim/schedule batches and existing lease fencing. Completed history is
not an executable backlog and retains its separate retention policy.

Provider limits remain lower than the deployment envelope: conservative
development request allowances, one foreground request per account, journey limits
and existing byte/image/token budgets still apply in PostgreSQL. The drill lowers
its synthetic Free/storage/global limits to expose races; it never raises model
or browser safety budgets.

## Required observations

The combined report at `output/qa/local-stack/<project>/smoke.json` records source
identity, runtime image digest, Docker Linux VM architecture/CPU/memory, each
replica's CPU/memory allowance, steady and burst concurrency, status counts,
successful-request throughput, p50/p95 and recovery latency. Successful HTTP
responses are not independently completed browser tasks and do not establish
model quality or a production latency promise.

Distinct checks cover one Free grant, one inference settlement with status-only
replay, shared Free/global/foreground exhaustion, saved-data conflicts and content-free
tombstones, export/read/delete while storage is exhausted, competing worker claims,
one completion per job, expired-lease recovery and rejection of the old capability.
Rolling APIs preserve identity and deletion; rolling workers continue processing
and refill one Free period only once. Account deletion revokes both replicas
without affecting another account. Injected throttling never retries automatically;
uncertain inference retains its hold and replay fence. After HTTP drain/restart,
lost private evidence is not reconstructed from durable request metadata.
Cross-replica cancellation records an uncertain request and explicitly leaves
cancellation unconfirmed. Restart checks reuse one schema-compatible image; they
do not certify mixed-schema rollout or zero-downtime migration upgrades.

## Validation status

All 115 focused real PostgreSQL checks pass in cohort
`tholi-smoke-mw72zyod-c87a8db2`, including actual bounded connection waiting,
concurrent job admission/replay, workspace isolation, counter consistency,
recovery capacity and role isolation.
The original identity-retention setup now writes the same 105 flows without
overfilling the acquisition queue; its 100-row pruning and five-row remainder
assertions remain intact. Sixty focused HTTP/pool/bootstrap unit checks pass.

The four injected-model HTTP/SQL checks pass separately in cohort
`tholi-smoke-mw72s5oa-28e4e077`. They make no external provider calls. The earlier
complete local gate passes with 1,320 unit, 57 core, 20 integration, five native
Firefox and 95 UI checks, before the final SQL backlog and acquisition enhancements.
A fresh complete local `npm run test:ci` gate passes with the final backlog and
pool changes: version/types, one production build, 1,322 unit checks across
95 files, 57 core, 20 integration, five native Firefox and 95 UI checks. Generated
acceptance output was copied to ignored QA evidence and the historical tracked
report restored. Final fixture cleanup has a separate fresh type check; exact-head
combined and hosted verification remains required below.

The first focused drill exposed a fixture
expectation that treated a saved-data tombstone as a missing record. The existing
contract returns its content-free tombstone; the new replica assertion now checks
that exact contract. Other fixture corrections use the actual account revision,
configured website origin, shared foreground-conflict result and unconfirmed
cancellation contract. The worker-competition fixture prepares work while its
owned workers are paused, then briefly observes both claim owners under the
unchanged lock timeout. Earlier cohorts are retained separately.

A frozen combined drill and matching-head hosted checks remain required before
merge. No report here authorizes packaging, deployment, public beta or production
traffic.
