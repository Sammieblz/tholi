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

The response currently advertises only `capabilities`, `handshake` and `openapi`.
Authentication, account data, decisions and billing are unavailable. No model
provider, credentials, PostgreSQL connection or account is needed for discovery.
There are no successful placeholder account or decision endpoints.

The executable OpenAPI document contains the request example above, bounded
schemas and common error definitions. Its `paths` describe registered operations
and health checks. The separate `x-tholi-route-inventory` is generated from
[`service-inventory.ts`](../../apps/api/src/routes/service-inventory.ts), the
single route inventory. Each future route names its owning issue, access class
and planned status. It covers identity/security, organizations/policies/consent,
decisions, jobs/support, usage/plans/credits, saved-data CRUD/search/export/delete,
revisioned synchronization, approved returns and billing. Planned entries are
not executable paths or a commitment that the feature is available.

## Validation, errors and privacy

[`contracts-service.ts`](../../packages/navigation-core/contracts-service.ts)
owns shared Zod input/output schemas and typed negotiation. The server validates
them and the contract tests act as extension, website and desktop clients,
validating real HTTP responses with the same schemas. No legacy backend client
is silently switched to this profile.

JSON bodies reject unknown fields and type coercion. The service JSON ceiling is
512 KiB; the small handshake has an 8 KiB ceiling. Each later route must declare
its smaller purpose-specific bounds. The multimodal envelope and its separate
image/request budgets belong to #36. An unknown query field is rejected on the
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

All service responses, including errors, are `Cache-Control: no-store`. All
legacy authenticated responses now have the same explicit cache policy while
retaining their response/status contracts. Browser CORS uses exact configured
website origins, permits GET/POST and only the currently needed headers, and
exposes the request ID. CORS and a successful handshake are not authorization.
Account routes must add their own authentication and CSRF policy in #30.

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

Future mutations use the existing repository request ledger, not process-local
deduplication. The identity is `(workspace, actor, operation/version, key)`, bound
to a server-computed canonical-command SHA-256 hash. Canonicalization occurs
after strict validation, includes the operation version, and excludes transport
metadata. Replay with different command content is 409 `IDEMPOTENCY_CONFLICT`.
An identical replay reads the committed request/result state; an uncertain
external effect requires reconciliation, not an automatic second billable call.
The ledger, mutation and outbox updates belong in one scoped transaction where
appropriate. The foundation's discovery endpoints perform no such mutations.

Plan selection is intent. The server resolves catalog versions, entitlement,
credit availability and approved callback/checkout destinations. Client tier
names, counters, payment redirects and arbitrary URLs never grant access.
Shared auth/checkout intent schemas accept named destinations rather than URLs;
#30/#50 implement registered, single-use bound returns. Local use needs no
account or checkout, and Free Cloud must not require paid checkout. Account/data
read, export and deletion permissions stay separate from inference credits.

## Evidence

See [the #29 validation record](testing/service-api-validation.md). These checks
do not certify an archive, enable a paid provider or deploy a service.
