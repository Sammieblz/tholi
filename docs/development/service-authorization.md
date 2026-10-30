# Workspace authorization and cloud consent

The optional [identity profile](service-identity.md) authenticates a Tholi
account. Authorization then resolves its current workspace membership and role
through the same PostgreSQL runtime. A workspace ID selects a requested scope;
it does not grant access. Neither CORS nor a successful handshake is identity or
authorization proof.

Local guidance and the existing SQLite/private API remain separate. A private
bearer cannot authenticate these account routes. Account authentication and
cloud consent never grant browser website access, capture permission, journey
ownership or desktop action authority.

## Current API

Configured services expose the following operations under `/api/v1`:

| Operation                                                 | Purpose                                                            |
| --------------------------------------------------------- | ------------------------------------------------------------------ |
| `GET /workspaces`                                         | Discover current authorized workspace memberships                  |
| `GET /workspaces/{workspaceId}/memberships`               | Inspect permitted membership metadata                              |
| `PATCH /workspaces/{workspaceId}/memberships/{accountId}` | Change an existing membership with its expected revision           |
| `GET /workspaces/{workspaceId}/policies`                  | Read current role and purpose-specific authorization requirements  |
| `GET /workspaces/{workspaceId}/consents`                  | Read the current actor's consent records and policy versions       |
| `POST /workspaces/{workspaceId}/consents`                 | Grant or revoke purpose-specific consent with an expected revision |

The account comes from the validated session, never a submitted account or
tenant claim. Every scoped operation rechecks active account, membership and
role within its database transaction. Membership removal takes effect for later
operations even while a personal account session remains valid. All responses
and errors retain the existing `no-store`, deadline and safe-error policy.

Browser cookies and native bearer credentials share the
[existing transport guards](service-identity.md#sessions-and-trust). Cookie
mutations require the exact website Origin and session-bound CSRF proof. Native
requests retain their separate bearer delivery. The executable OpenAPI document
describes registered routes; future data, billing and inference entries remain
planned.

## Roles and data boundaries

| Role            | Authority in this milestone                                        |
| --------------- | ------------------------------------------------------------------ |
| Member          | Manage own consent and authorized own data; read applicable policy |
| Admin           | Member authority and permitted organization membership inspection  |
| Canonical owner | Admin authority and changes to existing organization memberships   |

Each workspace has one canonical owner. Public membership changes preserve its
active ownership; operator security actions can still revoke a membership or
suspend an account. Personal workspaces cannot acquire additional members. An
ordinary role update cannot create a second owner, remove the canonical owner or
transfer ownership. Invitations, workspace
creation and enterprise organization management retain their later roadmap
owners.

Account/session controls and authorized data read, export and deletion do not
depend on inference credits or inference consent. No workspace role grants
client authority to publish plans, fund credits, settle usage or assign paid
entitlements. Those remain internal operations with separately implemented
entrypoints. Declaring an authorization action does not expose its future API.

## Purpose-specific consent

The server owns the admitted purposes and current policy versions in the shared
authorization contract. Current purposes distinguish cloud inference, image
transmission, cloud saved routes and product analytics. Their grants are
independent. Image transmission also requires inference authorization.

A grant must match the current version for that purpose. Creating a consent uses
expected revision `"0"`; changing or revoking it requires its exact positive
revision. An old request cannot restore a grant after revocation. Withdrawal
remains possible for an existing older policy version. A newer policy does not
silently inherit an older grant.
When withdrawing, submit the stored policy version returned by the consent
record, including when the current catalog has a newer version.

Consent records do not upload local knowledge, start synchronization, activate
analytics or make inference available. Later services must check the relevant
purpose again immediately before transmission or a durable effect. Browser host
grants, private-backend consent and website cookie preferences remain separate.

## Database enforcement

Migration `004-tenant-authorization` adds row-level policies to tenant business
data and scoped account metadata. Application queries retain explicit ownership
predicates. One checked-out connection owns the transaction-local actor and
workspace context, which is cleared by commit or rollback before pool reuse.
Missing scope fails closed.

The migration owner and runtime remain separate. Narrow trusted helpers resolve
membership without recursive policies and provision the existing personal
account bootstrap. Their search paths are fixed and execution is restricted.
Private identity credentials, one-use flows and signed provider-event lookup
remain in their existing adapter; they are not generic account-data routes.
Identity discovers the actor through verified proof or secret hashes before
installing database scope.

Row policies protect against omitted scope predicates. They do not make runtime
SQL credentials safe for untrusted clients or defend against trusted SQL code
deliberately changing its own transaction settings. Keep database credentials
inside the service. Operator backup/restore remains migration-owner work.

## Validation and later integration

The real [PostgreSQL harness](service-database.md#backup-restore-and-verification)
covers two organizations, roles, forged IDs, membership changes, optimistic
revisions, consent versions, connection reuse and identity compatibility.
HTTP tests cover the same shared cookie/native guards and strict wire contracts.
Fresh execution evidence is recorded separately in
[the authorization validation record](testing/service-authorization-validation.md).

Saved-data APIs and synchronization remain #59; the account dashboard remains
#60. Their caches must be scoped by account and workspace and discard pending
responses when that scope changes. The existing account boundary already fences
stale identity responses; this milestone does not introduce a cloud-data cache.
Durable jobs, support and inference must consume the same authorization owner
when their implementation milestones register those operations.
