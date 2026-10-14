The API is optional; the extension runs NLP and OCR locally without it.
Install Node **24.19.x**, run `npm ci`, `npm run fetch:model`, `npm run fetch:ocr` and
`npm run build:api`. Start the optional API with `npm run start:api`.
It listens at `http://127.0.0.1:8787`. First startup writes a random bearer
token to `.navigator-api/connection.json`, with no allowed browser origins.

For the separate backend `.tgz`, extract it, change into the extracted `package`
directory, run `npm ci --omit=dev`, then `npm start`. Its model files and built
server are included; no model-fetch or compilation step is required. Keep that
directory as the working directory, or set `NAVIGATOR_MODELS` explicitly.

Find your extension ID in `chrome://extensions`. Add
`chrome-extension://YOUR_32_CHARACTER_ID` to `origins` in that file and restart
the API. Alternatively set `NAVIGATOR_EXTENSION_ORIGINS` to a comma-separated
allowlist before launch. Keep the connection file private. On Windows, use a
directory private to your user; the API does not configure Windows ACLs.

In the extension's “Local site memory and AI” → “Optional private backend”,
enter the API address and generated token, enable the connection and Save.
Grant Chrome's requested API-host access. The token is stored only in trusted
extension storage contexts. The extension's origin must exactly match the
API allowlist. An unavailable backend uses the bundled local model.

The authenticated OpenAPI specification is `/v1/openapi.json`. Endpoints:

| Path               | Method   | Purpose                                     |
| ------------------ | -------- | ------------------------------------------- |
| `/v1/health`       | GET      | Version and capabilities                    |
| `/v1/observations` | POST     | Sanitized observation/verified transition   |
| `/v1/knowledge`    | POST     | Browser-authoritative current-site mirror   |
| `/v1/suggestions`  | POST     | Grounded request suggestions                |
| `/v1/plans`        | POST     | Plan, clarification or unsupported response |
| `/v1/routes`       | GET/POST | Read/store saved routes                     |
| `/v1/routes/:id`   | DELETE   | Forget one route                            |
| `/v1/forget`       | POST     | Forget a website and its derived data       |
| `/v1/clear`        | POST     | Clear all knowledge/routes/derived data     |

Use HTTPS through a reverse proxy for self-hosted connections. The service
continues to bind loopback; TLS, authentication and firewall configuration of
that proxy are the owner's responsibility. Accounts and synchronization are
not implemented. `NAVIGATOR_DATA_DIR`, `NAVIGATOR_MODELS`, and `NAVIGATOR_PORT`
override local paths/port. Original site data survives model changes; only
derived indexes are rebuilt. Failed mirror deletion is reported; reconnect and
retry Clear if the backend was offline.

Version 0.8.0 adds `/v2` equivalents of all listed endpoints and
`/v2/openapi.json`, while retaining `/v1`. Negotiate `/v2/health` before using
workflows. v2 planning requires `protocolVersion: 2` and `contextRevision`;
results echo request, document, observation and context revisions. Observations
accept snapshots, frame envelopes and bounded deltas; stale delta bases require
a fresh projection (409). Older backends fall back to local processing. Session
context and private names are processed in memory only; SQLite mirrors reusable
interface semantics and parameterized routes. See the workflow architecture for
contracts and migration details.

Authenticated `POST /v2/ocr` accepts bounded PNG recognition input (4 MB decoded,
4 megapixels) and revision stamps. Recognition runs in a worker with the engine
advertised by `/v2/health`; the current backend uses Tesseract. Images and private
recognized text are not persisted or payload-logged. Enable backend OCR
explicitly in the extension to send temporary masked images; older or failed
backends fall back locally. Paddle is a browser experiment, not an API capability.
