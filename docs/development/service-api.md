# Portable service API

The service profile publishes contract version **1** under `/api/v1`. Its wire
protocol is `tholi-service`. This version is independent of extension/API release
0.11.0 and the legacy single-owner `/v1` and `/v2` protocols. Choose the service
profile explicitly; an existing private bearer does not authenticate a service
account or enable cloud inference.

## Discovery and compatibility

Start the [local stack](local-stack.md), or build and run `npm run start:service`.
The default direct listener is `http://127.0.0.1:8788`.

1. Read `GET /api/v1/capabilities` before sending account or page data.
2. Send the client kind, client implementation version and supported service
   versions to `POST /api/v1/handshake`.
3. Require compatibility and the capabilities needed for the operation. A
   compatible handshake grants no identity, entitlement or browser authority.

```sh
curl http://127.0.0.1:8788/api/v1/capabilities
curl http://127.0.0.1:8788/api/v1/handshake \
  -H 'Content-Type: application/json' \
  -H 'X-Tholi-Timeout-Ms: 1000' \
  --data '{"protocol":"tholi-service","versions":[1],"client":{"kind":"web","version":"0.11.0"},"requiredCapabilities":["handshake"]}'
curl http://127.0.0.1:8788/api/v1/openapi.json
```

A discovery-only service advertises `capabilities`, `handshake` and `openapi`.
It needs no model provider, credentials, PostgreSQL connection or account.
Configuring the [optional identity profile](service-identity.md) adds the
`authentication` and `account-security` capabilities. The composed authorization
service also advertises `tenant-authorization` and `purpose-consent` for its
registered workspace, membership and consent operations. Its authentication and
accountData availability flags describe these current account capabilities.
The composed accounting service adds [credit and usage reads](service-credits.md)
and durable development inference limits. The composed [product catalog](service-plans.md)
describes Local and unavailable production cloud tiers, with authenticated fake
Free enrollment only in development. The [saved-data service](service-saved-data.md)
adds explicit library operations and reviewed imports; its production write path
remains unavailable. The [account workspace](account-dashboard.md) reuses these
services for private profile, storage, export and deletion controls. Lifecycle
capabilities require the composed private-file pipeline. Billing remains a later
milestone. By default, decisions and billing availability
stay false. Explicitly enabling the
fake navigation transport adds the registered decision routes described below;
this does not enable paid inference or grant a cloud plan.

The executable OpenAPI document contains the request example above, bounded
schemas and common error definitions. Its `paths` describe registered operations
and health checks. The separate `x-tholi-route-inventory` is generated from
[`service-inventory.ts`](../../apps/api/src/routes/service-inventory.ts), the
single route inventory. Each future route names its owning issue, access class
and planned status. It covers identity/security, organizations/policies/consent,
decisions, jobs/support, usage/plans/credits, saved-data CRUD/search/export/delete,
revisioned synchronization, approved returns and billing. Planned entries are
not executable paths or a commitment that the feature is available.

Configured services also expose actor-private [job status and cancellation](service-jobs.md).
The `durable-jobs` capability indicates these registered routes. Dispatch and
operator recovery run independently of HTTP; no public enqueue or retry endpoint
is available. Job capabilities do not enable inference or billing.

## Opt-in development navigation transport

`THOLI_NAVIGATION_TRANSPORT_ENABLED=true` enables the existing service profile's
fake navigation adapter. Identity and PostgreSQL must be configured, and
`THOLI_MODEL_PROVIDER` must remain `fake`. The default is disabled, including in
Compose. Live Vertex inference remains a separately authorized operator experiment;
the deferred quality comparison and production rollout gates still apply. This
flag cannot select a live provider. Ordinary fake inference uses the durable
development policy and requires explicitly provisioned test credits or explicit
development Free enrollment through the product catalog.

The separate loopback-only [operator comparison runtime](testing/perception-comparison.md)
reuses these authenticated routes with explicit `profile: "operator-evaluation"`
and the `operator-navigation-evaluation` capability. It requires an exact plan,
temporary client activation and separate live approval. Public capability metadata
is discovery, not authentication or spending authority. Ordinary startup rejects
this composition, and the fake consumer choice cannot select it.

The configured service advertises both `navigation-decisions` and
`fake-navigation-model`, with `availability.decisions: true`. Clients require
both capabilities and send an explicit `profile: "fake"`. Changing a provider or
advertising a new capability cannot silently upgrade that consent. A successful
handshake still grants no identity, site permission or processing consent.

| Operation            | Route                                                              | Result                                                                                 |
| -------------------- | ------------------------------------------------------------------ | -------------------------------------------------------------------------------------- |
| Request a proposal   | `POST /api/v1/workspaces/:workspaceId/decisions`                   | Original validated proposal, or status-only idempotent replay                          |
| Read request status  | `GET /api/v1/workspaces/:workspaceId/decisions/:requestId`         | Actor-private request status, without page data or a saved proposal                    |
| Request cancellation | `POST /api/v1/workspaces/:workspaceId/decisions/:requestId/cancel` | Cancellation intent with `cancellationConfirmed: false`; requires an empty JSON object |

The request contains an independent transport UUID, the original Nav1 observation
and validation clocks, and the bounded shared request policy. It preserves the
logical browser request UUID, native document identity and original deadline.
Only the exact UUID-scoped decision collection POST accepts up to 4 MiB of encoded
JSON; the ordinary API ceiling remains 512 KiB. The observation retains its
24,000-byte projected-structure, 2 MiB decoded PNG and four-megapixel limits.
Navigation responses are limited to 32 KiB. The client, actual gateway and API
each enforce their own boundary.

In the extension's existing account settings, development transmission requires
a signed-in account, selected authorized workspace, explicit page-context consent
and current native website/service access. Masked images require their separate
choice and `image.transmit` consent. The account/workspace-bound choices are off
by default and do not inherit private-backend consent. Server processing uses
the existing `inference.request` purpose. Disabling, signing out or revoking access
stops new observation egress and aborts active client waits. Failed server consent
withdrawal is reported separately from the immediately disabled local choice.

The existing platform transport owns credentials and the last native capture
check. Credentials never enter observation bodies or content/page scripts. Each
send rechecks capabilities, processing consents, local choices and grants. The
API authenticates before accepting the larger body, then revalidates identity,
workspace membership and purpose before model work and before releasing a
proposal. Loopback HTTP supports local Compose; VM and hosted origins require
HTTPS and explicit native permission. No unavailable endpoint triggers fallback,
checkout, a second provider or automatic upload of the local collection.

The request ledger uses `navigation-decisions.v1` under the existing
workspace/actor-scoped idempotency owner. It persists metadata and a canonical
command hash, not observations, images or proposals. Identical replays return
status only; different content under the same key is rejected. Neither side
automatically retries inference. A shortened deadline includes time spent in
authentication and final transmission checks. Cancellation can record uncertain
work and abort the local operation, but never proves cross-replica/provider
cancellation, zero billing or a completed installation/task.

The browser's [single journey integration](../architecture/navigation-contracts.md#background-proposal-integration)
uses the ordinary local plan first, then explicitly opted-in service enrichment
for that retained task. Network waits do not hold the local inference queue.
The existing Guide presents current-request processing and explicit recovery;
account settings distinguish Local from Connected development service and keep
privacy withdrawal available during pending work. Cloud plans and actual credit
balances remain unavailable in this development profile. This does not enable
paid cloud guidance for ordinary users. Existing account-scoped errors preserve revoked
access, unavailable service and exhausted credit/storage conditions without
opening payment flows. Server-authoritative plans and durable cost enforcement
remain #44 and #58.

## Validation, errors and privacy

[`contracts-service.ts`](../../packages/navigation-core/contracts-service.ts)
owns shared Zod input/output schemas and typed negotiation. The server validates
them and the contract tests act as extension, website and desktop clients,
validating real HTTP responses with the same schemas. No legacy backend client
is silently switched to this profile.

JSON bodies reject unknown fields and type coercion. The service JSON ceiling is
512 KiB; the small handshake has an 8 KiB ceiling. The explicitly enabled
navigation POST alone has the larger bounded envelope described above. Other
routes retain their purpose-specific limits. An unknown query field is rejected on the
discovery routes. HTTP pagination accepts canonical integer query strings, with
an explicit parser rather than global AJV coercion; pages contain at most 100
items and cursors contain at most 512 URL-safe characters. Cursors are opaque to
clients and must be validated against authorized scope by their owning route.

PostgreSQL `int8` values, including credit quantities and revisions, use canonical
decimal strings. Never convert them to JavaScript numbers. The shared validator
enforces the signed 64-bit bounds; nonnegative quantities and positive record
revisions have narrower validators. `expectedRevision: "0"` creates a record;
updates require its exact revision. Sync cursors start at `"0"` and preserve
tombstones. The [repository owner](service-database.md) enforces concurrency and
scope. A cursor or object ID alone never authorizes access.

Service errors use this shape:

```json
{
  "error": {
    "code": "COMPATIBILITY_MISMATCH",
    "message": "The requested service contract or capability is unavailable.",
    "requestId": "00000000-0000-4000-8000-000000000029",
    "retryable": false
  }
}
```

Invalid requests return 400, incompatible contracts 409, oversized bodies 413,
unsupported media 415, expired deadlines 504 and unavailable service 503. The
shared error vocabulary also reserves authentication, authorization, concurrency,
idempotency, quota, rate-limit and cancellation outcomes for their implementing
routes. Unexpected exceptions use a safe internal-error response, without input,
SQL, tokens or provider error text. An unexpected exception is 500
`INTERNAL_ERROR` with `retryable: false`, because it may follow a committed
mutation. Only explicitly classified unavailable failures are retryable.
`X-Request-Id` is a server-generated UUID;
caller-supplied IDs cannot replace it.

All service responses, including errors, are `Cache-Control: no-store`. Legacy
authenticated responses retain the same explicit cache policy and existing
response/status contracts. [Delivery configuration](service-delivery.md) adds
bounded service-only IP admission, explicit proxy trust and receipt/socket
limits, including for direct API connections. Discovery-only browser CORS uses exact configured
website origins, GET/POST and its bounded content-type/deadline headers.

Configured identity additionally admits registered Chromium and validated native
Firefox origins for bearer transport, DELETE session revocation, Authorization
and X-Tholi-CSRF headers. Only the exact configured website origin receives
credentialed CORS. Cookie-authenticated reads reject another Origin, including
native extension origins; cookie mutations require both the website Origin and
session-bound CSRF proof. Native bearer credentials and cookie sessions have
distinct delivery rules over one session owner. Responses expose the request ID.
CORS and a successful handshake grant no authentication or entitlement. See the
[identity guide](service-identity.md#sessions-and-trust) for the complete policy.
The composed workspace service additionally admits PATCH for authorized
membership changes. [Workspace authorization](service-authorization.md) rechecks
current membership and purpose-specific consent through the existing database
transaction owner; selecting a workspace never grants access to it.

## Deadlines, cancellation and idempotency

The API owns a 25-second request deadline, consistent with the adopted
[deployment budgets](../plans/gemini-cloud-and-enterprise.md#scaling-deadlines-and-connection-budgets).
`X-Tholi-Timeout-Ms` may shorten it to a canonical integer from 1 through 25000.
The server derives the absolute deadline at receipt, avoiding client clock skew.
The deadline also bounds an incomplete JSON upload. Service operations use
`duringServiceRequest` and receive only the server request ID, deadline and
`AbortSignal`. Deadline, client disconnect and shutdown abort the signal.
The response is bounded even when an adapter ignores cancellation. Timers and
transport listeners are removed after completion or disconnect. Cooperative
adapters must still stop their own work and respect remaining budgets.

Cancellation does not prove that a provider stopped, that a charge was avoided,
or that a mutation did not commit. The legacy inference/OCR timeouts and
retained-request behavior remain unchanged. Interactive observations must not
become a durable replay queue.

Future workspace/domain mutations use the existing repository request ledger, not process-local
deduplication. The identity is `(workspace, actor, operation/version, key)`, bound
to a server-computed canonical-command SHA-256 hash. Canonicalization occurs
after strict validation and includes the operation version. HTTP correlation IDs
and forwarding headers are not command data. Navigation binds the complete
validated command, including its independent request UUID and original clocks.
Replay with different command content is 409 `IDEMPOTENCY_CONFLICT`.
An identical replay reads the committed request/result state; an uncertain
external effect requires reconciliation, not an automatic second billable call.
The ledger, mutation and outbox updates belong in one scoped transaction where
appropriate. The foundation's discovery endpoints perform no such mutations.

Plan selection is intent. The server resolves catalog versions, entitlement,
credit availability and approved callback/checkout destinations. Client tier
names, counters, payment redirects and arbitrary URLs never grant access.
Shared auth/checkout intent schemas accept named destinations rather than URLs;
Identity uses registered, single-use PKCE-bound broker returns; checkout remains
#50 work. Local use needs no
account or checkout, and Free Cloud must not require paid checkout. Account/data
read, export and deletion permissions stay separate from inference credits.

## Evidence

See [the #29 validation record](testing/service-api-validation.md). These checks
do not certify an archive, enable a paid provider or deploy a service.
The [#40 transport record](testing/inference-transport-validation.md) separately
tracks the explicitly enabled fake navigation routes and their client guards.
