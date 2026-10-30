# API runtime ownership

The current API has two explicit bootstraps in the existing `apps/api` application.
The [portable backend decision](../plans/gemini-cloud-and-enterprise.md) defines the
service architecture. This page covers the runtime foundation from
[#26](https://github.com/Sammieblz/tholi/issues/26) and service database foundation
from [#28](https://github.com/Sammieblz/tholi/issues/28), with
[versioned service discovery and contracts](../development/service-api.md) from #29
and [optional portable identity](../development/service-identity.md) from #30.

## Profiles and entrypoints

| Profile        | Factory and executable                          | Current capabilities                                                                                                       |
| -------------- | ----------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| Legacy private | `createApi` in `server.ts`; `cli.js`            | Existing authenticated `/v1` and `/v2`, SQLite, local inference and OCR workers                                            |
| Service        | `createServiceApi` in `server.ts`; `service.js` | Health/readiness, capability negotiation, OpenAPI and optional PostgreSQL-backed account authentication/session management |

Without identity configuration, the service exposes health and discovery without
opening PostgreSQL or an identity provider. Configured identity adds account and
session routes through the same service runtime. Navigation, saved-data, credit,
billing and durable-job endpoints remain planned. A private bearer never grants
service access. The service does not load SQLite, ONNX, OCR or their worker
adapters. Importing either bootstrap does not listen; only running its executable
or calling its exported start function does.

`scripts/build-api.mjs` preserves `cli.js`, `server.js`, `inference.js` and `ocr.js`,
adds `service.js` and `database-cli.js`, and emits shared ESM chunks beside those entrypoints. Dynamic
legacy imports remain lazy in the compiled service. Chunks stay at the output
root so existing worker URLs and custom inference/sibling OCR locations work.
The build verifies the output directory and removes obsolete generated JavaScript
and source maps before emitting a new set. No archive is changed by a build.

## Dependencies and seams

- `server.ts` composes validated profiles and injected capabilities. Its public
  `createApi(ApiOptions)` facade remains compatible.
- `config.ts` validates options and environment settings before resources or
  listeners are created. It preserves `NAVIGATOR_*`, `.navigator-api/connection.json`
  and `navigator.sqlite`. Invalid stored settings fail without rotating the token.
- `routes/private.ts` owns private CORS/bearer policy, OpenAPI, request schemas,
  response validation and abort propagation. Both namespaces use one application
  service; their public shapes, limits and protocol stamps remain intact.
- `application/navigation.ts` owns plan-timeout recovery, suggestions, bounded
  delta assembly and forget/clear orchestration. It has no Fastify, worker-thread,
  SQLite or cloud SDK dependency. Repository methods use the existing navigation
  storage port, extended only for the existing mirror operation.
- `adapters/private.ts` binds the existing `SqliteStorage` to local inference/OCR
  capabilities. `storage.ts` retains SQL and privacy ownership.
- `adapters/local-workers.ts` shares the two actual worker transports' request,
  timeout, cancellation and failure lifecycle. `inference.ts` and `ocr.ts` keep
  their existing CPU/model responsibilities; they are not durable job workers.
- `http.ts` owns shared Fastify lifecycle, health and error presentation.
  `runtime.ts` owns listening, signal handlers and the executable drain deadline.
- `database/` owns the PostgreSQL service schema, scoped repositories, pooled
  transactions and one-shot operator commands. See
  [service database setup and boundaries](../development/service-database.md).
  Identity repositories back configured account/session routes; other domain
  repositories have no public routes yet. Neither profile migrates private SQLite.
- `application/identity.ts` owns one application session lifecycle for website
  cookies and native credentials through `identity-contracts.ts`. `adapters/oidc.ts`
  verifies provider proof; `adapters/service-identity.ts` composes the database and
  provider ports. `routes/identity.ts` owns HTTP credential delivery and CSRF.
  See the [identity guide](../development/service-identity.md) for the protocol,
  approved callbacks, revocation policy and deployment settings.

There is one navigation engine and one repository owner per database profile.
Workspace role authorization/RLS and durable worker execution remain later tickets.
Authentication does not authorize model inference, upload local knowledge or
transfer journey ownership to the server.

The [local container stack](../development/local-stack.md) uses this same build
and executable, with PostgreSQL, a local OIDC realm and captured mail. Its default
internal networks deny internet egress. One-shot initialization containers apply
migrations and reconcile the local identity client before the configured API starts.
HTTP replicas receive runtime SQL and confidential OIDC client credentials, never
migration or identity administration credentials. `THOLI_MODEL_PROVIDER`
defaults to `fake`; any other provider fails startup until #39 implements the
actual inference adapter and spending enforcement. This policy does not advertise
an inference endpoint or change the legacy local model.

## Health, errors and shutdown

Both profiles provide `GET /health/live` and `GET /health/ready`. The private
profile requires the existing bearer and origin policy for both; the service
profile exposes them without account authentication and applies its configured
browser-origin policy. Configured identity separates credentialed website
requests from native bearer transport; CORS is not authentication. Responses have
`Cache-Control: no-store`.

Liveness reports only process/profile/version metadata and performs no dependency
probe or inference. Readiness is 200 when all injected resources are ready and 503
while unavailable or draining. Each readiness probe is bounded to one second;
failure details and credentials are withheld. An empty service resource set means
the HTTP discovery foundation is ready. With identity enabled, readiness verifies
the service database schema through the runtime role. It does not probe provider
login, send mail or run model inference; those need their own verification.

Local workers acknowledge startup after imports, database/queues and message
listeners initialize. Model loading stays lazy; this is not a warm-model or asset
quality check. Startup waits up to ten seconds for both acknowledgements and
cleans partial worker/storage initialization on failure. A failed worker makes
readiness unavailable and rejects new work promptly. Request settlement removes
its timers and abort listeners. Inference retains the 120-second indexing timeout
and retained-request fallback; OCR retains its 30-second cancellation limit.

On close, Fastify's `preClose` first marks the runtime draining and stops pending
application work. `onClose` then terminates workers and closes storage, attempting
every resource even when cleanup fails. Cleanup is idempotent. The executable
drain deadline is eight seconds; a stuck/failed drain exits unsuccessfully with a
safe diagnostic. Interrupted startup and listen failure also clean resources and
remove installed signal handlers.

Legacy public errors retain `{ "error": "message" }`. Service errors use an
object containing `code`, safe `message`, server-generated `requestId` and
`retryable`; response headers include `X-Request-Id`. Validation, forbidden origin,
unknown route, payload/content-type limits and unavailable service have distinct
statuses/codes. Unexpected exceptions do not expose their original message.
The [service API contract](../development/service-api.md) defines separate
versioned discovery, strict schemas, request deadlines and future route inventory.
Configured account/session routes use the same safe error and deadline policy.

## Validation ownership

Existing real-model integrations remain the functional owners:

- `tests/integration/nlp/api.test.ts`: v1 NLP parity, private auth/CORS, OpenAPI,
  persistence and deletion.
- `tests/integration/multi-app/api.test.ts`: v2 parity/stamps, stale deltas,
  privacy, persistence and deletion.
- `tests/integration/vision/ocr.test.ts`: bounded OCR, coordinate parity and
  absence of persisted image/text data.

`tests/unit/api` covers distinct configuration, profile isolation, safe errors,
worker startup/cancellation/failure and runtime shutdown contracts. Compiled
bootstrap smoke checks additionally verify lazy native dependencies and default
worker locations; their observed result belongs in the issue PR. Identity has
distinct signed-token/HTTP regressions and real PostgreSQL coverage, with native
browser and provider-flow checks recorded separately. The deterministic PR gate
remains `npm run test:ci`. Unit checks do not certify a release, live Gemini
quality, native browser permissions or completed provider sign-in.
