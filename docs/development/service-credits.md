# Durable development quotas and credits

Roadmap [#44](https://github.com/Sammieblz/tholi/issues/44) extends the existing
PostgreSQL credit and usage owner. The API and worker share that owner across
replicas. Local SQLite knowledge and the browser's pinned journey remain local.

The user deferred [#43's live comparison](testing/perception-comparison.md) and
authorized offline implementation on October 31, 2026. Live provider calls remain
disabled. The measured quality decision is still required before beta, commercial
live validation or release. Development fixtures do not establish model quality,
real provider billing or production scalability.

## Development policy and read APIs

The composed service uses the immutable `fake-development-v1` policy and the
existing `tholi-deterministic-v1` adapter. One validated generated proposal costs
one development credit, with a maximum reservation of one credit. The fake
provider costs zero USD. This is a test policy, not a published plan or paid
price. No account is granted credits automatically by this milestone. #58 owns
the plan catalog, grant quantities and real charging policy.

The policy allows no automatic model retries, one image, at most 32768 input
tokens and 2048 output/thinking tokens, and eight decisions per journey. Durable
account, workspace and global period limits apply independently of journey IDs.
Changing a journey ID or reconnecting does not reset those period limits. The
server's accounting metadata does not give it authority over the browser journey.

When identity and the accounting service are composed, require the
`credit-accounting` capability and use the existing native bearer or website
session boundary:

| Operation                               | Route                                                |
| --------------------------------------- | ---------------------------------------------------- |
| Balance and development charging policy | `GET /api/v1/workspaces/:workspaceId/credits`        |
| Bounded credit events                   | `GET /api/v1/workspaces/:workspaceId/credits/events` |
| Bounded usage and provider-cost records | `GET /api/v1/workspaces/:workspaceId/usage`          |

History accepts `after` and `limit`, with at most 100 records per page. Cursors
are opaque. All credit quantities and USD micro-units travel as decimal strings;
clients must not convert them through floating-point JSON numbers. Unknown costs
and unmeasured token counts remain null. Known zero usage remains zero. The service reports cost per independently verified success as
unavailable until a separate independent outcome source exists. A proposal,
provider response or client click does not establish arrival.

These read routes require current workspace authority and `credits.read` or
`usage.read`, not inference consent or a positive balance. Account and saved-data
read, export and deletion retain their own authorization. Responses are private
and not cached. There is no client grant, settlement, refund or global-disable
endpoint. Production billing availability remains false.

## One durable accounting engine

Append-only grants, settlements and refunds form the existing derived credit
ledger. Reservation allocations attach holds to grant lots, using the earliest
expiry first. Expired grants do not subtract their historical spending from a
new grant again. Active or uncertain allocations retain liability after grant
expiry. Releasing or refunding an old allocation preserves its original expiry
and never creates a new grant period.

Grants record their source, policy and optional period. Idempotency keys and
amount checks prevent duplicate grants, settlement and refunds; changing a
replayed payload is a conflict. The plan and billing milestones must reuse this
engine rather than add another credit counter.

Admission reserves credits, provider-cost liability and request counts together
in a short PostgreSQL transaction. Shared account, workspace and global bounds,
the per-journey ceiling and one foreground decision per account apply across
replicas and workspaces. Locks have a fixed order, and no transaction spans a
model or other external call. Commit funding separately before requesting
inference; do not call admission after a workspace-locking legacy write in the
same transaction. Schema migrations are append-only. Migration 008
also accounts for pre-existing credit history instead of assuming an empty ledger.

The durable disable control is checked during admission and immediately before
the dispatch intent. It blocks new dispatch intents across replicas. An already
dispatched operation may still have a provider cost and must finish accounting.
An intent is not proof that a provider received or completed a request.

## Completion, cancellation and reconciliation

Known no-send and known failed fake generations release their development credit
hold. A validated generated proposal consumes one credit; this charges generation,
not delivery or arrival. An ambiguous HTTP delivery after settled generation does
not automatically repeat or refund it. Any supported explicit refund is an
idempotent, trusted accounting action.

Provider usage and user credits are separate quantities. Reported provider cost
is retained even if a proposal is invalid or withheld. Unknown invocation or
untrusted usage retains the maximum liability and requires reconciliation. A
deadline, disconnect, expired foreground lease or sign-out never proves no charge.
Over-limit or mismatched usage fails closed rather than returning a proposal or
quietly releasing a hold. A trusted reported cost or token overrun records the
known liability and disables new inference globally. It never increases the
user's original maximum credit charge.

Settlement uses the already-created hold's internal fence. It cannot authorize
new inference or read arbitrary tenant data, and it can finish an existing cost
after membership or account revocation. The bounded worker reconciliation path
uses the existing durable jobs and outbox. It may release an expired hold only
with a durable no-dispatch proof. Dispatched uncertainty remains held for trusted
outcome evidence; the worker never reruns a model or infers a refund from time.

The generic accounting storage supports versioned cost policies and integer cost
limits. Offline tests use synthetic nonzero usage to exercise those limits. This
does not activate a live adapter: ordinary composition accepts only the fixed fake
development policy. The separate operator experiment retains its own explicit
single-use data and spending authorization.

The existing worker emits global recorded-cost, reserved-liability and unresolved
count gauges from a worker-only SQL aggregate. Dashboards take their maximum across
workers instead of adding the same global total repeatedly. Failed or inexact
metric conversion marks accounting telemetry unavailable. Integer ledger values
remain authoritative. The verified-outcome availability gauge stays zero; no
cost-per-success value is emitted. Review alerts do not replace SQL enforcement.

## Validation

See the [validation record](testing/credit-accounting-validation.md) for actual
results and pending checks. Existing PostgreSQL integration owners exercise
concurrency, upgrade, expiry, refunds, uncertainty and worker fencing. The full
database checker requires a fresh disposable stack; never run it against retained
development data. Use [the local-stack smoke](local-stack.md) and preserve failed
cohorts. PR checks do not authorize release packaging or production deployment.
