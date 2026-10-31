# Explicit cloud-saved data

Roadmap [#59](https://github.com/Sammieblz/tholi/issues/59) extends the existing
PostgreSQL artifact owner and private-file pipeline. It does not move local memory
to the service or create a server-owned journey. The public website workspace and
[account workspace](account-dashboard.md) consumes these foundations in #60;
first-run mode selection remains in #61.

## Approved fields

Every artifact has a stable cloud UUID, wire schema version 1 and bounded metadata:
a label of at most 120 characters, an optional folder of at most 80 characters,
and at most ten distinct tags of 40 characters each. Metadata is included in the
actual PostgreSQL storage-byte allowance.

| Kind                    | Approved data                                                                                              | Excluded data                                                                                                                |
| ----------------------- | ---------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------- |
| Saved route             | Website origin, sanitized goal, static step labels/kinds, historical completion marker                     | Local task IDs, native document/control IDs, selectors, objective/form values, session checkpoints and actionable references |
| Selected site knowledge | Website origin and at most 48 static interface controls from a bounded selection                           | Page paths, query strings, DOM, screenshots, field values, options, descriptions and document identities                     |
| Conversation excerpt    | Up to 12 deliberately selected user/assistant messages, at most 1000 characters each, after text redaction | Automatic conversation capture, system/tool context, credentials and hidden runtime instructions                             |
| Preferences             | Website appearance: light or dark                                                                          | Authentication, cookies, host grants, processing consent, assisted-action permissions and credentials                        |

Shared privacy projection applies to public and private origins. Known task-detail
values are replaced with a placeholder in route goals and metadata. Ordinary
value-free goals stay usable. Historical steps and completion are stored history,
not evidence that a current browser step or destination was reached. Explicitly
selected text is redacted before preview; this is not a guarantee that arbitrary
user-supplied text contains no personal information.

The canonical DTOs are strict. The server rejects unknown fields or text that does
not match its canonical privacy form; it does not silently rewrite an approved
payload after the user has reviewed it. No artifact contains executable code.

## Routes and authorization

Require the composed `saved-data` capability and the existing native bearer or
website session boundary. Cookie mutations also require the exact website Origin
and CSRF token. Workspace IDs and artifact IDs are selectors, not authority.
Current account status, workspace membership and ownership are resolved by the
existing authorization and repository owners.

Saved-data requests also require `X-Tholi-Account` with the expected account UUID.
The service compares it with the authenticated session and echoes its verified
account; this selector never grants authority. Clients reject missing or mismatched
proof before reading saved-data responses. Public capability discovery remains
anonymous. The `account-binding` capability is required before sending saved data.

| Operation                     | Route                                                          |
| ----------------------------- | -------------------------------------------------------------- |
| List                          | `GET /api/v1/workspaces/:workspaceId/artifacts`                |
| Account storage usage         | `GET /api/v1/workspaces/:workspaceId/artifacts/usage`          |
| Search/filter                 | `GET /api/v1/workspaces/:workspaceId/artifacts/search`         |
| Create                        | `POST /api/v1/workspaces/:workspaceId/artifacts`               |
| Read                          | `GET /api/v1/workspaces/:workspaceId/artifacts/:artifactId`    |
| Edit or organize              | `PATCH /api/v1/workspaces/:workspaceId/artifacts/:artifactId`  |
| Delete                        | `DELETE /api/v1/workspaces/:workspaceId/artifacts/:artifactId` |
| Selected export               | `POST /api/v1/workspaces/:workspaceId/artifacts/export`        |
| Changes, including tombstones | `GET /api/v1/workspaces/:workspaceId/sync/changes`             |
| Confirm a reviewed import     | `POST /api/v1/workspaces/:workspaceId/sync/import`             |

List/search support bounded pagination, text query, kind, folder and tag. Cursors
are bound to account, workspace and filters. Changes use decimal sync revisions,
with an explicit next revision and more-results indicator. Private responses are
not cached by HTTP intermediaries.

The existing `cloud_saved_routes` purpose advances to policy **2** for these four
explicit saved-data types. A policy-1 grant is readable and revocable but does not
authorize the expanded writes. The actual write transaction locks and rechecks
current policy-2 consent, serializing with withdrawal. Reads, export and deletion
do not require write consent, inference consent or positive credits.

The current pre-launch production profile does not advertise `saved-data-write`
and rejects create/update/import before persistence. Explicit development enables
the typed write path. New or growing public artifacts require an active product
allowance; a never-enrolled account cannot use the legacy manual profile to bypass
storage caps. Expiry and downgrade preserve read/export/delete and authorized
non-growing development updates. No automatic paid overage or model invocation
occurs for data operations.

## Preview, synchronization and conflicts

Preview is entirely local and performs no HTTP request. The caller explicitly
chooses records and reviews the exact projected DTOs. Confirmation is bound to the
service origin, account, workspace, source revisions, stable cloud IDs and selected
content. The authenticated server recomputes the shared scoped SHA-256 before
applying a batch. A changed source or account invalidates the preview.

Each operation has a durable UUID and expected revision. Zero creates; updates
require the exact current revision. The existing scoped request ledger provides
idempotency. Receipts retain only IDs, not another copy of user content. Safe
replay reads current owned records, including later tombstones, without applying
the operation twice. An atomic import either commits its approved batch or leaves
no partial records, receipts or sync stamps.

One shared client engine owns the approved cache, local-ID mapping and bounded
outbox. Its separate IndexedDB store is scoped by service, account, workspace and
schema version. It never replaces `navigator-site-memory` or the private SQLite
profile. Normal same-account reload retains approved offline work. Cleanup targets
the previously verified scope; it cannot erase a different account's pending work
in another tab. Logout and account switches abort pending work and clear the old
scope's cloud cache/outbox. Local routes, site knowledge and deliberately retained
local export files remain separate.

Website tabs suspend stale account state through credential-free peer notices.
Peer messages cannot establish identity or authorize cache deletion: the existing
account endpoint supplies fresh proof. A request bound to the old account fails
if another tab changes the login cookie, even before the notice arrives.

Reconciliation is explicit. It downloads tombstones before sending queued changes.
Unknown outcomes keep the original operation UUID; revision conflicts require a
user choice. The client does not silently merge, allocate a replacement UUID or
recreate deleted records. Successful acknowledgement must identify the intended
records and their committed revision. An absent row in a list is not a deletion.

Deleting an artifact clears its content and private metadata while preserving the
UUID, kind and revision tombstone. An old device cannot recreate that UUID with
revision zero. A deliberate new copy is a separate reviewed user action.

## Private exports

Export requires an explicit selection of up to 20 owned live artifacts. It uses
the existing durable job, private-object, integrity, lease and expiry pipeline,
with the separate `saved-data-export` purpose. It does not widen diagnostic JSON
into an arbitrary data dump or create another queue. Export content is bounded to
128 KiB and expires after one hour; select a smaller batch when needed.

Account file links resolve the actual workspace from the owned file UUID and
current membership. A personal session does not imply that an organization export
belongs to its personal workspace. Foreign or ambiguous files fail closed. Short
signed links still require current authentication; proof is not a bearer session.

The worker checks current authority immediately before starting the object PUT.
An in-flight external request cannot be unsent. Late outcomes remain private and
are reconciled or removed by the existing expiry owner. Download rechecks session,
membership, file revision and expiry after object I/O and before releasing bytes.
Already downloaded local copies are under the user's control.

## Compatibility and validation

Migration 010 adds an internal storage format to the same artifact table. Existing
format-1 SavedTask rows keep their IDs and trusted internal adapters. The public
API, cache and export expose only explicitly approved format-2 rows, whose wire
schema version is independently 1. There is no automatic migration of local or
legacy data. An explicit reviewed conversion may reuse a UUID only at its exact
current revision.

Data editing never sends a journey command. A saved route becomes a new request
only through an explicit handoff to the existing browser-owned goal flow and fresh
binding. Saving, opening a detail view or reading historical completion cannot
change an active journey or establish arrival. Website practice stays isolated.

See [the validation record](testing/saved-data-validation.md) for results and
remaining checks. Provider calls, paid infrastructure, publication, deployment,
version changes and desktop implementation are outside this issue.
