# API runtime ownership

The current API has two explicit bootstraps in the existing `apps/api` application.
The [portable backend decision](../plans/gemini-cloud-and-enterprise.md) defines the
later service architecture. This page describes the runtime foundation implemented
for [#26](https://github.com/Sammieblz/tholi/issues/26).

## Profiles and entrypoints

| Profile        | Factory and executable                          | Current capabilities                                                            |
| -------------- | ----------------------------------------------- | ------------------------------------------------------------------------------- |
| Legacy private | `createApi` in `server.ts`; `cli.js`            | Existing authenticated `/v1` and `/v2`, SQLite, local inference and OCR workers |
| Service        | `createServiceApi` in `server.ts`; `service.js` | Health/readiness and injected resource lifecycle only                           |

The service profile has no account, navigation, PostgreSQL or durable-job endpoints
yet. A private bearer never grants service access. It does not load SQLite,
ONNX, OCR or their worker adapters. Importing either bootstrap does not listen;
only running its executable or calling its exported start function does.

`scripts/build-api.mjs` preserves `cli.js`, `server.js`, `inference.js` and `ocr.js`,
adds `service.js`, and emits shared ESM chunks beside those entrypoints. Dynamic
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

No second navigation engine, tenant repository, account implementation or idle
durable-worker stub is introduced. Later tickets add those service capabilities
through these owners and their adopted contracts.

## Health, errors and shutdown

Both profiles provide `GET /health/live` and `GET /health/ready`. The private
profile requires the existing bearer and origin policy for both; the service
profile exposes them without account authentication and applies its exact-origin
allowlist to browser requests. Responses have `Cache-Control: no-store`.

Liveness reports only process/profile/version metadata and performs no dependency
probe or inference. Readiness is 200 when all injected resources are ready and 503
while unavailable or draining. Each readiness probe is bounded to one second;
failure details and credentials are withheld. An empty service resource set means
the health-only HTTP foundation is ready, not that accounts or model inference work.

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
Full authenticated service routes and their OpenAPI contracts remain #29/#30 work.

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
worker locations; their observed result belongs in the issue PR. The deterministic
PR gate remains `npm run test:ci`. These checks do not certify a release, live
Gemini quality, native browser permissions or signed-in accounts.
