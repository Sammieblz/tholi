# Account workspace

Roadmap [#60](https://github.com/Sammieblz/tholi/issues/60) extends the existing
website account boundary. The same static Cloudflare application serves the
workspace. Its configured portable service proves identity and supplies private
data; browser demo accounts cannot authenticate service requests.

## Pages and existing owners

| Route               | Purpose                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------- |
| `/account`          | Account overview and current service availability                                           |
| `/account/data`     | Search, filter, review, edit, organize, export and delete saved items                       |
| `/account/credits`  | Available, held and consumed credits, grant expiry and paged activity                       |
| `/account/security` | Verified profile, provider controls, sessions, privacy choices, account export and deletion |
| `/account/billing`  | Current plan and allowances, explicit Free enrollment where offered, paid availability      |

`/signin` and `/signup` use the configured identity provider. `/welcome` replaces
history with `/account`; `/onboarding` remains optional, account-free practice.
Practice never signs in, changes real extension state or proves installation.
All account paths and their static aliases are private, uncached and excluded
from search discovery. Private content is fetched after authentication, not
embedded in generated HTML or public analytics.

`AccountProvider` is the single website identity owner. Each account, workspace
and session gets a separate workspace lifetime. Stale private-view actions cannot
send requests or clear another account's pending work. Peer notices invalidate views;
server proof establishes the next account. Signing out and accepted deletion
clear the previously verified cloud cache, not local extension knowledge.

One summary hook supplies profile, catalog, entitlements, credits and storage.
Failures remain explicit and independent: a missing credit response does not
mean zero credits, and a failed plan response does not mean no enrollment.
Decimal quantities are formatted without converting large balances to Number.
Exhaustion does not disable authorized reads, exports or deletion.

## Saved items and plans

The workspace consumes the existing [saved-data contracts](service-saved-data.md)
for saved routes, selected site knowledge, conversation excerpts and preferences.
Opening an item does not navigate a browser. Historical completion is history,
not current arrival evidence. Labels, folders and tags can be edited; only
permitted kind-specific content is editable. Synchronization and conflict
resolution are explicit. No local knowledge is uploaded by visiting a page.

The current [plan environment](service-plans.md) determines availability. Local
development uses real identity and PostgreSQL and can explicitly enable fake
inference and development allowances. Production cloud writes and paid plans remain unavailable until their
separate milestones. The workspace invents no prices, invoices or checkout;
available Free enrollment has no payment step.

## Profile and private lifecycle routes

Provider-supported profile, email, password, verification and recovery controls
reuse [identity configuration](service-identity.md). An optional operator-owned
`THOLI_IDENTITY_ACCOUNT_MANAGEMENT_URL` supplies the provider management link. It
must be HTTPS, or HTTP loopback in development, without credentials, query or
fragment. It is never derived from a user-supplied URL. After an email change,
sign in again to obtain newly verified contact information.

Profile changes stay with the provider. The reserved `PATCH /api/v1/account`
inventory entry remains unavailable; this workspace exposes the configured
provider controls and verified profile read instead.

| Operation                                | Route                                                 |
| ---------------------------------------- | ----------------------------------------------------- |
| Current verified identity profile        | `GET /api/v1/account/profile`                         |
| Account-wide saved-item storage usage    | `GET /api/v1/workspaces/:workspaceId/artifacts/usage` |
| Discover owned export requests           | `GET /api/v1/account/exports`                         |
| Prepare or explicitly continue an export | `POST /api/v1/account/exports`                        |
| Export delivery status                   | `GET /api/v1/account/exports/:generation`             |
| Request self-account deletion            | `POST /api/v1/account/deletion`                       |

These routes require current session proof and the expected `X-Tholi-Account`
binding. Cookie mutations also require exact Origin and CSRF proof before body
processing. They do not consume inference credits. Lifecycle capabilities are
advertised only when the existing private-file delivery and cleanup composition
is available. SQL migration 011 extends the existing repositories and worker;
it does not replace the frozen SQL of earlier migrations or add another queue.

## Account export

An explicit request creates a typed JSON index and private JSON parts through
the existing [file pipeline](service-support.md). Parts contain approved profile,
contact, session, membership, consent, saved-data, plan, credit, usage, support and
optional product-event fields, never credentials or arbitrary database rows.
Each file is bounded to 128 KiB and expires after one hour. One preparation step
is bounded to 4 MiB, 10,000 rows and 64 parts. Larger collections require an
explicit owned continuation; there are no automatic continuation calls.

Indexes link previous pages, identify source workspaces and collection intervals,
and report partial data and omissions. This is a collection over an interval,
not an atomic account snapshot. Legacy internal artifact formats are declared
outside the supported export format, rather than silently converted. The user
downloads indexes and their listed files to retain a complete supported copy.
Lost access to a source workspace invalidates delivery even when files are
stored under the user's personal workspace. Expired or failed earlier files
prevent the generation being reported as wholly ready.

The shared website file-delivery owner validates typed contents, current account,
same-origin signed paths and expiry. Account parts are checked against the index
generation, section, workspace, record count, byte size and SHA-256 before a
download starts. A link or click does not establish that a file was saved.

## Account deletion

Deletion requires typing DELETE, a final Base UI confirmation and a current
account revision. The atomic request disables the account and revokes sessions,
refresh grants and brokers, then queues fenced cleanup. The response is a
pending-deletion receipt, not proof of physical erasure. Shared workspaces cannot
be stranded by deleting their last owner.

Cleanup tombstones saved data, removes eligible personal/contact/support/product
data and uses the existing private-object expiry pipeline. Final deletion waits
for physical cleanup and quiescence. Identity and abuse-prevention markers,
financial liabilities, security audit records and deletion tombstones remain
for their stated purposes. Unknown provider charges are not refunded or released
by deletion. The identity-provider account, local extension data and downloaded
copies are separate. The retained provider identity cannot claim a second Free
allowance by registering again.

See the [validation record](testing/account-dashboard-validation.md) for observed
checks and remaining operational limitations. Publishing, deployment and paid
provider evaluation require their separate authorization.
