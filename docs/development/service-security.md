# Service security and data lifecycle

Roadmap #45 reviews the existing portable service. This is a source and local
verification milestone, not an independent penetration test or production approval.
The browser owns observation, action review and independent outcome verification.
Local use needs no account. Managed inference and paid checkout remain gated.

## Threat model and validation owners

| Untrusted entry or failure                                            | Control and existing verification owner                                                                                                                                                                                                                                                                              |
| --------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Page instructions, forged goals, stored graph or model injection      | Strict model proposals, bounded privacy projection and fresh native rebinding; `tests/unit/api/navigation-model.test.ts`, `provider-inference.test.ts` and the navigation/browser owners. Knowledge never grants authority or declares arrival.                                                                      |
| Forged actor, workspace, origin or gateway headers                    | Current identity, account binding, exact CORS/CSRF and transaction-local SQL scope; `authorization.test.ts`, `service-contracts.test.ts`, PostgreSQL authorization/account checks and `gateway-validation.mjs`. Runtime cannot assume migration/worker privileges.                                                   |
| PKCE callback replay, mix-up, recovery abuse or open redirects        | Registered returns, state/nonce/browser binding, issuer/audience/expiry, single-use brokers and refresh-family replay revocation; `identity.test.ts`, `service-auth.test.ts` and real local identity cohorts. A website cookie cannot authenticate the extension.                                                    |
| Plan spoofing, payment-return tampering or Free-credit repetition     | Server catalog, locked enrollment and identity-linked grants; PostgreSQL plan/accounting checks and first-run setup checks. Paid checkout is absent; a return URL cannot grant an entitlement.                                                                                                                       |
| SSRF, redirects or credential exfiltration                            | Operator-owned OIDC/object endpoints; exact curated provider endpoints; no arbitrary client URLs; manual model/OIDC redirects, bounded JSON and closed failures. Default internal Compose networks have no provider egress. Customer egress is a separately enabled restricted profile.                              |
| Malformed images or oversized validator inputs                        | PNG admission before allocation, mask-before-transform, image/byte budgets and bounded queues. Service prevalidation also caps depth at 64, nodes at 32,768 and any collection at 4,096 before recursive schemas. `service-contracts.test.ts`, image/privacy and provider adapter fixtures own distinct regressions. |
| Revocation, account switching, offline conflicts or stale restoration | Generation/revision fences, tombstones, versioned sync epochs, current grants at dispatch/return, and disabled-account cleanup. PostgreSQL saved-data/account checks and existing native private-learning/account cohorts. Local fallback cancels pending activation.                                                |
| Noisy tenant or uncertain provider/mail effects                       | Shared SQL admission, reservations, bounded workers and durable dispatch barriers. Status-only replay never resends an uncertain generation or SMTP effect. Exhaustion preserves authorized read/export/delete. Scaling evidence is #47.                                                                             |
| Support or operator access                                            | Support is current-account scoped and content expires. No general support impersonation, arbitrary file fetch or cross-account data endpoint exists. Runtime cannot read security audits; only an explicit operator-scoped export can. Operational telemetry uses finite metadata, not request/response bodies.      |

These checks cover synthetic attacks and named sentinels. They cannot prove that
all page text is private or safe, that a provider erased its copies, or that a
hosted gateway/firewall matches this repository. Do not enable capture of request
bodies, query strings, Authorization/Cookie headers, private file URLs or JWTs in
the proxy, tracing agent, error tracker or hosting dashboard.

## Retention inventory

| Data                                           | Current boundary and deletion                                                                                                                                                                                                                                                                                            |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Navigation observations and masked screenshots | Transient request/worker memory only; excluded from durable jobs, request receipts, routine telemetry and audit. Explicit saved conversations/graphs are a separate approved data product, not inference logging.                                                                                                        |
| PKCE flows and provider logout proofs          | Their existing absolute expiry; opportunistic identity writes plus bounded idle-worker maintenance remove expired rows. Worker sees counts only.                                                                                                                                                                         |
| Service session and refresh history            | Absolute session expiry, including revoked families. Refresh hashes stay together until that expiry so replay cannot regain authority. Migration 015 prunes at most the configured batch per table; it never accepts an actor or cutoff. Account deletion also removes eligible session rows through its existing owner. |
| Provider keys                                  | Dedicated versioned AES-GCM keyring and bound account/connection/provider/revision. Connection removal and account deletion immediately erase ciphertext from the live row. Metadata-only exports exclude keys. Backups are separate.                                                                                    |
| Saved artifacts and private learning           | Existing versioned saved-data contracts, revisions, expiry, tombstones and outbox. Knowledge has a 90-day evidence ceiling. Revoked consent stops new use; explicit deletion and account cleanup remove stored content. See [saved-data ownership](service-saved-data.md).                                               |
| Support and private exports                    | Support body 30 days; private exports at most one hour, links at most 60 seconds and always authenticated. Worker deletion/reconciliation and object lifecycle must both operate. See [support](service-support.md).                                                                                                     |
| Product analytics and audit                    | Separately consented product events 30 days; withdrawal purges attributed events. Fixed security audit metadata 90 days, append-only for runtime. Worker expiry is bounded and can lag a backlog.                                                                                                                        |
| Accounting and abuse prevention                | Identity links, grant/liability history and deletion markers prevent repeated free grants, replay and lost unknown charges. Account removal does not refund uncertain charges or erase required financial/security evidence. No paid financial retention period is invented before billing exists.                       |
| Logs, provider copies, mail and backups        | Independently operated systems. The deployment inventory must specify access, encryption, TTL and deletion owner. Local Docker logs have size rotation, not a time TTL. No claim of automatic remote deletion follows from a local toggle.                                                                               |

The [account workspace](account-dashboard.md#account-deletion) coordinates immediate
disablement and bounded physical cleanup. The pending receipt is deliberately
separate from completion. Do not implement a second deletion pipeline in support.

## Provider-data review

Reviewed against official documentation on November 7, 2026. These are documented
provider terms and current request settings, not verified operator-account settings.

| Processor                | Adapter and documented limits                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| ------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| OpenAI                   | Responses requests set `store:false`, with no tools or stored conversation. [OpenAI data controls](https://developers.openai.com/api/docs/guides/your-data) distinguish application state from default abuse-monitoring retention and approved retention/residency controls. API data is not used for training by default, subject to the provider's stated choices/exceptions. No approved zero-retention or residency entitlement is established here.                                                                                                                                 |
| Anthropic                | Messages requests carry no uploaded file or stored conversation. [Commercial retention](https://privacy.claude.com/en/articles/7996866-how-long-do-you-store-my-organization-s-data) normally removes API inputs/outputs within 30 days, with policy, legal, contractual and covered-model exceptions. [Commercial training terms](https://privacy.claude.com/en/articles/7996868-is-my-data-used-for-model-training) distinguish default processing from voluntary feedback. Tholi does not submit provider feedback. No model/account-specific zero-retention approval is established. |
| OpenRouter and Anthropic | Both are processing recipients. The catalog restricts Anthropic, denies data collection, requires parameters and forbids fallback. [OpenRouter data collection](https://openrouter.ai/docs/guides/privacy/data-collection) and [provider logging](https://openrouter.ai/docs/guides/privacy/provider-logging) include exceptions and account controls. `data_collection:"deny"` alone does not establish zero retention, safety-log exclusion or a country.                                                                                                                              |
| Managed Google           | Disabled under the existing live gate. The [Google retention reference](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention) separates training restrictions, caching and abuse/advanced-model logging. API location and terms require actual configuration review before live use. The previous single synthetic experiment retains its own evidence and does not certify this preparation.                                                                                                                                                    |

Cloud profiles must record the selected region and all processors. Neither an API
hostname nor a `global` endpoint proves a processing country. No provider call is
needed to save or rotate a credential, run these fixtures or review these terms.

## Secret rotation and operator access

Keep identity client, PKCE encryption, file-link signing, SQL-role, object/SMTP and
customer-provider keyring secrets distinct. Provision via protected files or the
deployment's secret port, never frontend variables, shell history or support logs.
Maintain a named operator inventory and record approvals/access in the operator
system; the application has no support-staff impersonation or hidden admin user.

1. Quiesce admission when a secret may be compromised; disable model egress first.
   Preserve content-free request/effect IDs and the metadata needed to fence unknown
   charges. Do not retry unknown provider/mail effects to test recovery.
2. For the provider keyring, introduce a new random version while retaining old
   versions required by live ciphertext. The existing cipher reads old versions
   and seals new writes with the active version; account key rotation advances its
   revision and invalidates old selections. Count remaining key versions with an
   operator-only metadata query before retiring one. No bulk re-encryption service
   is supplied. If an old encryption key is compromised, keep egress disabled,
   remove the affected keys through the existing owner and require provider-side
   revocation/re-entry. Removing a Tholi copy does not revoke an upstream key.
3. Changing the PKCE encryption key invalidates pending flows. Stop new sign-ins,
   let the ten-minute proof window expire, update the key and restart all API
   replicas. Existing hash-based sessions are separate; explicitly revoke them
   when incident scope requires it. Reconcile the provider client secret before
   reopening sign-in. Never silently accept two issuers or unregistered callbacks.
4. A file-link signing-key change invalidates existing links, which last no more
   than 60 seconds. Authenticated clients can request a fresh link. Rotate SQL,
   object and SMTP credentials at their owners, restart bounded pools/workers and
   verify readiness without printing the new values. Remove old grants after
   overlap ends. Rollback must not restore a compromised credential.
5. Verify current authorization, a redacted failure and an actual local lifecycle
   path before reopening traffic. Retain the time, image/config digest, affected
   key versions, operator and outcome outside application payload logs.

## Incident and quarantined restore

The default is to stop transmission and retain Local guidance. Revoke affected
sessions, suspend accounts or disable provider admission through existing owners.
Preserve unknown-effect fencing and request/ledger IDs. Restrict operator exports
by actor/workspace and limit; do not export bodies as a diagnostic shortcut.

Restore into a new private database with ingress, identity and provider egress
closed. Use `pg_dump`/`pg_restore` and role/migration verification from
[database operations](service-database.md#backup-restore-and-verification).
Compare restore contents before running expiry, since expiry intentionally changes
the snapshot. Run current migrations and worker cleanup, then verify scoped access.

Before serving any restored account data, reconcile deletion/suspension requests,
provider removals, consent withdrawals and tombstone/sync epochs recorded after the
snapshot. The operator must retain this current suppression record independently
of the snapshot and replay through the existing lifecycle owners in quarantine.
If that record is unavailable, do not reopen affected data. Revoke restored sessions
and refresh grants, replace compromised secrets, expire old export objects and
verify current object lifecycle/backup expiry. Never treat an old snapshot as proof
of present consent or issue a second Free grant by dropping identity links.

Production requires a documented, enforced backup lifetime (baseline ceiling 35
days), encrypted storage, restricted restore rights, and an exercised deletion
reconciliation drill. This source milestone records the procedure and the local
snapshot/restore check; it does not claim a hosted backup or operator suppression
service is deployed. Hosted settings and restoration since a real deletion remain
deployment gates. Financial liabilities and security records retain their separate
purposes and expiry; do not restore raw page/image payloads into telemetry.

## Dependency, image and license review

Run `npm audit --omit=dev --json` against the lockfile and scan the actual tested
runtime image by digest, including OS packages and license inventory. Existing
third-party notices remain the build owner; do not copy skill files into assets.
Record scanner/database versions, findings, mitigations and untested scope in
[the validation record](testing/security-hardening-validation.md). Scanner findings
are not proof of exploitability or a complete license opinion.

The current Zod 3 advisory cannot be removed honestly by loading its compatibility
API from a differently versioned package. The service structural guard mitigates
oversized recursive HTTP input, in addition to existing route/image/JSON budgets.
A reviewed migration of schemas and their JSON-Schema converter remains a release
gate; do not suppress the finding or claim that all non-HTTP parsing is covered.
Production certification, independent security/legal review and actual provider
account retention settings remain unperformed.
