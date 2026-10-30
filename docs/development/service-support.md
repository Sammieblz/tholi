# Account support, notification mail and private files

Roadmap [#33](https://github.com/Sammieblz/tholi/issues/33) adds optional account
support and an explicit account diagnostic export to the portable service. Local
extension guidance, store installation, practice and email drafts still work
without an account. Cloud inference, billing and general saved-route export are
not enabled by this feature.

## Ownership and transport

`packages/navigation-core/contracts-support.ts` owns the strict public DTOs,
topic catalog and limits. The existing contact form consumes them. A single
`SupportService` serves support and private-file routes, using `PostgresSupport`,
an object-storage port and a file-link port. The durable worker uses the same
application image and registered job owner, with separate SQL credentials.
Nodemailer and the S3-compatible SDK remain in adapters outside application
services. These ports do not require a Google-specific deployment.

The API advertises `support-requests` and `private-files` only when the real
service is composed with identity. Unconfigured discovery does not advertise
them or register placeholder handlers. Requests derive account/workspace scope
from the authenticated session. Current account, personal-workspace ownership
and membership are checked inside existing scoped transactions. Cookie
mutations retain the exact website Origin and CSRF requirements; native clients
use their existing bearer boundary. No route accepts a caller-selected tenant.

| Method | Path                                               | Result                                                    |
| ------ | -------------------------------------------------- | --------------------------------------------------------- |
| POST   | `/api/v1/support/requests`                         | Saved request and queued notification job identifiers     |
| POST   | `/api/v1/account/diagnostic-exports`               | Explicit export request, job and private-file identifiers |
| GET    | `/api/v1/account/files/:fileId`                    | Scoped file status, revision and expiry                   |
| POST   | `/api/v1/account/files/:fileId/link`               | Short-lived authenticated download URL                    |
| GET    | `/api/v1/account/files/:fileId/download?token=...` | Verified JSON attachment for the current account          |

All responses use `no-store`. File links additionally use `no-referrer`; clients
must not put these URLs in analytics, logs, screenshots or stored route data.
The link proof is not a replacement for an authenticated session. Downloading
rechecks actor, workspace, file expiry and revision before and after object I/O,
and verifies the size, checksum and approved diagnostic schema.

## Contact and delivery behavior

The existing website contact form has two accurate paths. Without a configured,
signed-in support service it prepares an email draft in page memory. The user
opens an email app or copies and sends the draft themselves. With an advertised
account-support capability, an explicit **Send request** saves the request and
queues processing. The confirmation does not claim SMTP acceptance, inbox
delivery or a support response.

Names are optional and bounded to 80 characters. Email, subject and message
limits are 254, 120 and 3000 characters. The four topics remain **Support**,
**Feedback**, **Partnerships** and **Something else**. Plain-text templates,
versions, sender and support destination are operator-owned. A submitted email
address is reply information for support, never an arbitrary receipt recipient.
Receipts use the selected verified account notification contact, when one is
available. Its identity/contact revision is rechecked before delivery.

Commands use payload-bound idempotency through the existing request owner. A
changed payload cannot reuse the same key. Each actor/workspace has separate
support and diagnostic admission budgets of three new requests per hour and ten
per day. Replays do not create another job. A rejected quota returns `429`,
`RATE_LIMITED` and `Retry-After: 3600`; these abuse budgets do not consume inference
credits or grant paid entitlements. Support message content expires after 30 days
and is purged by bounded maintenance. Emails already delivered are separate
copies governed by the operator's email retention.

SMTP is not exactly-once delivery. A durable start barrier precedes adapter I/O.
An uncertain post-send outcome is recorded without automatically sending the
same SMTP effect again. Known pre-send failures can retry within the existing
bounded job policy. Worker leases, request IDs and outbox metadata do not prove
that an inbox received a message. Cancelling or revoking authority cannot undo
an external effect that already happened; current authority is checked before
starting another effect.

## Explicit private diagnostic

The optional JSON diagnostic contains only schema/service version, active
account status, personal-workspace kind, owner role and bounded job counts. It
does not contain account identifiers, email addresses, credentials, goals,
routes, page text, screenshots or captured images. Export is an explicit user
action, not a side effect of opening Contact or submitting a message.

The approved snapshot is frozen when requested. The worker writes it to a
generated private S3-compatible key; clients cannot select a bucket, key, upload
body or remote URL. The maximum file size is 128 KiB. Files expire after one hour;
links last no more than 60 seconds and require the expected positive revision.
The website requests a link through its existing cookie/CSRF account client,
checks its exact service origin/path, then downloads the authenticated JSON as
`tholi-diagnostic.json`. It does not attach the file to a support message.

Expiry cleanup is mandatory and cannot be cancelled by the user. The worker's
bounded cleanup capability continues after membership revocation or account
inactivation, without reopening account access. Private object data, diagnostic
snapshots and expired support content are removed through that maintenance
owner; stopped workers can delay physical cleanup. Expired files remain
unavailable to HTTP clients regardless of cleanup timing.

Cleanup waits for bounded in-flight upload windows and retains deletion
tombstones for reconciliation of uncertain or late object writes. A stale upload
completion cannot restore file visibility. An aborted client request does not
prove that a storage server cancelled its write. Hosted operators must configure
a bucket lifecycle for the dedicated export prefix as a final deletion bound,
including noncurrent versions and incomplete uploads if those features are
enabled. Do not enable object retention locks on these ephemeral exports.

Account removal must schedule the same approved-artifact cleanup and preserve
only the tombstones needed to finish it. Backups can retain prior encrypted
copies until their documented rotation deadline; restoring a backup must replay
deletion and expiry records before serving account data. Financial records, when
billing is implemented, have their own documented legal retention and must not
retain support bodies or diagnostics as billing evidence. These obligations do
not make the future account-deletion endpoint available in this milestone.

## Configuration and local development

The [local stack](local-stack.md) enables support with local mail capture and
private storage. Its seven long-running services are gateway, API, worker,
PostgreSQL, OIDC, Mailpit and S3-compatible storage. Migration and identity
configuration remain separate one-shot initialization services. Storage is now a
default dependency. The existing `--profile storage` option remains accepted for
command compatibility; telemetry is still optional.

For a retained environment from before this feature:

```sh
npm run local:init -- --upgrade-support true
npm run local:up
```

The upgrade appends missing settings without replacing existing secrets,
volumes or users. Follow the earlier identity/worker upgrades too if that
environment predates them. `THOLI_FILE_LINK_SECRET_KEY` is a dedicated, generated
32-byte base64url key, different from the identity flow-encryption key. It belongs
only in the API, never the website, extension or worker.

Outside Compose, support is explicitly enabled with `THOLI_SUPPORT_ENABLED=true`
in the API and durable worker. The API requires the configured identity/SQL
profile, `THOLI_SERVICE_PUBLIC_ORIGIN`, the dedicated file-link key and object
settings. The worker requires its separate SQL role plus object and mail settings.

| Owner          | Settings                                                                                                                                                                                                                    |
| -------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| API and worker | `THOLI_OBJECT_ENDPOINT`, `THOLI_OBJECT_REGION`, `THOLI_OBJECT_BUCKET`, `THOLI_OBJECT_ACCESS_KEY`, `THOLI_OBJECT_SECRET_KEY`; optional `THOLI_OBJECT_TIMEOUT_MS`                                                             |
| API only       | `THOLI_FILE_LINK_SECRET_KEY`; optional `THOLI_SUPPORT_LINK_LIFETIME_MS` from 1000 through 60000                                                                                                                             |
| Worker only    | `THOLI_SMTP_HOST`, `THOLI_SMTP_PORT`, `THOLI_SMTP_FROM`, `THOLI_SMTP_SUPPORT_RECIPIENT`, `THOLI_SMTP_SECURE`, `THOLI_SMTP_REQUIRE_TLS`; optional paired `THOLI_SMTP_USER`/`THOLI_SMTP_PASSWORD` and `THOLI_SMTP_TIMEOUT_MS` |

Local Compose uses `mail:1025`, no SMTP credentials, no external relay and
`THOLI_SMTP_LOCAL_CAPTURE=true`. Mailpit's loopback UI shows captured synthetic
messages; this is not internet delivery. External SMTP requires verified TLS,
and external object endpoints require HTTPS. SDKs use explicit object
credentials, without an ambient cloud credential chain. Default services remain
on internal networks behind fixed loopback gateway routes and receive no model
provider API keys. Keep all secrets in the private environment or deployment
secret mechanism, never committed client configuration.

Keycloak remains the owner of registration verification and password-recovery
mail. This support mail service does not implement another identity or recovery
pipeline. The existing website AccountProvider owns credentialed requests,
CSRF and generation-fenced account changes. Local practice has no access to it.

## Validation and remaining scope

Focused HTTP tests extend `tests/unit/api/authorization.test.ts` for conditional
capabilities/OpenAPI, session/CSRF enforcement, strict commands, quota headers
and authenticated attachment downloads. `website-support.test.ts` covers the
account-free draft, explicit queued submission, retry keys, hostile download
links, Blob download and removal of private controls on session expiry. Adapter,
worker and actual PostgreSQL checks cover their own boundaries. The existing
local-stack smoke owns actual local mail/object/expiry evidence; recorded
results belong in a fresh dated validation report.

`npm run test:ci` remains the required PR gate. Focused evidence or captured mail
does not certify a release, external email delivery, a hosted deployment or
screen-reader speech. Packaging still requires the existing full certification.

General cloud saved-data export remains [#59](https://github.com/Sammieblz/tholi/issues/59),
account deletion remains [#45](https://github.com/Sammieblz/tholi/issues/45), and
billing remains [#50](https://github.com/Sammieblz/tholi/issues/50). This bounded
diagnostic and its expiry are not substitutes for those milestones.
