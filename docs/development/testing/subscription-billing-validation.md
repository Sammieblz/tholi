# Subscription billing preparation

Recorded November 18, 2026 for [#50](https://github.com/Sammieblz/tholi/issues/50).
This is unfinished offline implementation, not commercial, release or production
certification. Website 0.1.1 and extension/API 0.11.0 remain unchanged.

## Implemented preparation

Stripe 23.1.0 is declared in the API workspace so minimal runtime installation
can include it. Its signature verifier needs no payment API credential. Provider
HTTP shares bounded decoding, cancellation and deadlines, pins the API version
and sends once. Account discovery uses the credential's own `/v1/account`.
Checkout expiry and both cancellation modes verify returned references, customer,
mode and outcome. Immediate cancellation requests no final invoice or proration;
this does not establish that every other financial obligation is resolved.

Private payment handoffs reuse the existing authenticated envelope primitive with
a dedicated keyring and purpose-bound account/workspace/operation/revision/expiry
binding. Historical provider ciphertext remains readable. No payment key enters
the HTTP ingress verifier, public DTOs, exports or browser storage.

The additive migration 017 registers private financial provenance and negotiated
catalog reads. Migrations 001 through 016 remain unchanged. Default catalog reads
retain version 1; `?schemaVersion=2` explicitly selects the additive view. Fixture
pricing is stripped when fake billing is disabled or the service is in production.
No operator billing profile is composed, and paid checkout remains unavailable.

Subscription and invoice metadata reuse the existing scoped repository,
authorization and identity route owners. Access requires a current bound workspace
owner. Inference consent and a paid balance are not prerequisites for these reads.
Financial record DTOs omit customer/subscription/invoice provider IDs and bearer
links. The HTTP role receives read-only
financial table grants and no direct access to the unscoped event inbox.

The PostgreSQL best-practices guidance used here covers indexed foreign keys,
database-enforced tenant policies and short transactions. RLS preserves the
repository's dedicated migration-owner boundary for controlled cleanup and
backup. The pooled HTTP role cannot bypass it. Financial HTTP execution and
future reconciliation must occur outside database transactions.

## Fresh checks and unresolved validation

- Fifty-one focused billing, provider, encryption and plan checks pass in
  `output/qa/billing50-provider-plan-regressions.log`.
- Ninety focused authorization/catalog/adapter checks pass in
  `output/qa/billing50-catalog-http-regressions.log`, before the billing read API
  was composed.
- Type checking passes after the read API and its test helpers are added, in
  `output/qa/billing50-read-api-types-corrected.log`.
- The subsequent six-file run passes 134 of 135 tests. An existing provider-account
  case exceeds its unchanged five-second deadline. Its isolated run passes one
  test with 55 skipped. The broader run remains failed; no deadline is increased
  and no root cause is inferred from the isolated pass.
- Disposable stack `tholi-smoke-mwltx9qm-50a2c4e1` fails during Docker test-image
  layer export, before executing PostgreSQL assertions. It does not validate
  migration 017 or the new financial data checks. Its cleanup times out, and
  follow-up removal of its verified owned container is pending. The private
  environment remains ignored and retained for that owned cleanup.
- The host reports approximately 0.3 GiB free on C:. New builds are held while
  explicit cleanup approval is pending. Other projects' data and published
  release archives are outside this cleanup request.

The complete billing PR gate has not run. Full PostgreSQL, real local identity,
browser and eventual release evidence remain pending. Earlier passing backend
delivery results do not certify this branch.

## Remaining implementation

Complete durable dispatch, signed-event admission and ordered reconciliation,
customer/merchant ownership checks before effects, unknown-outcome fencing,
subscription changes and cancellation, invoice/credit provenance, retention and
account-deletion cleanup. Reuse the existing job journal, entitlement owner and
credit ledger. The new tables do not create another balance or grant mechanism.

Finish the separately enabled fake payment profile, complete account and native
return flows, UI and invoice-history access, then run current PostgreSQL and
browser cohorts and the complete `test:ci` gate. External payment/model calls,
real checkout, card collection, beta invitations, production prices, deployment,
publication and archive replacement remain unapproved. Actual #43 quality and
#49/#51 customer evidence keep their separate gates.

## Invoice history follow-up

The prepared invoice read API now returns bounded keyset pages with optional
`nextCursor`. It extends the existing credit/usage history owner instead of
introducing another cursor implementation. Existing credit and negotiated usage
wire formats are retained. Invoice cursors bind their view, account and workspace;
all reads still recheck current authorization and PostgreSQL scope. Cursor
timestamps retain all six PostgreSQL fractional digits. Public metadata continues
to use exact integer amount strings and omits provider identifiers and links.

Type checking and 115 focused history, account HTTP, credit and service-contract
tests pass in `output/qa/billing50-invoice-paging-types.log` and
`output/qa/billing50-invoice-paging-regressions-approved.log`. The first focused
attempt stops at the sandbox's `spawn EPERM` restriction before tests start; it is
retained separately. The PostgreSQL case now walks invoices one microsecond apart,
checks page termination and rejects another account's cursor. That database case
has not run. These results do not complete the billing PR gate.

The Stripe verifier also rejects Connect-account and organization-context event
routing. The initial profile supports the credential's own merchant only; a valid
signature does not authorize a different merchant or establish an entitlement.
The final six-file cohort passes 141 checks, including that boundary, account
authorization, shared history compatibility, exact quantities and encryption, in
`output/qa/billing50-invoice-paging-final-regressions.log`. Final type checking
passes in `output/qa/billing50-invoice-paging-final-types.log`. Full PostgreSQL
and the complete PR gate remain pending; C: has approximately 0.25 GiB free at
the latest read-only check.

## November 18 validation after Docker recovery

The user-approved Docker bootstrap recreation restored Engine 28.1.1 without
resetting the separate Docker data disk, Ubuntu or existing data volumes. An
isolated, network-free container check passes. The small bootstrap disk and its
registration remain backed up and hash-verified. The abandoned stack from the
earlier image-export failure was removed through the existing project-scoped
reset owner; this does not change its failed historical report. C: subsequently
has approximately 114 GiB free at the verified host check. No successful
build-cache prune is claimed.

Three fresh, owned PostgreSQL cohorts use the existing migration/repository
checks and actual non-owner runtime/worker roles:

- `tholi-smoke-billing50-935e5964` fails the financial metadata fixture with
  SQLSTATE 23514. It attempted to add an administrator to a personal workspace,
  which correctly preserves canonical-owner-only membership.
- The fixture now explicitly converts that synthetic workspace to an
  organization before adding the administrator. No membership constraint or
  financial access policy changes. Cohort `tholi-smoke-billing50-5d8cad06`
  proceeds beyond billing but fails an existing versioned account-export
  assertion. No exported data, credential or raw error is retained, and no
  root cause is claimed for that assertion.
- `tholi-smoke-billing50-baaa4de3` passes all 118 checks, including fresh and
  retained migration/replay, negotiated catalogs, exact invoice amounts,
  microsecond keyset pagination, owner/admin isolation, deletion-pending
  access, and existing account/identity/job contracts. Export assertions are
  unchanged. The separate passing run does not explain the previous failure.

All three cohorts record successful cleanup of their own project and volumes.
Their reports remain under `output/qa/local-stack/PROJECT/postgres-recovery.json`.
The passing report has SHA-256
`11f5d9a81b237480899968026ac6c79dd075ed5ea727b65ae2bfa371b43d9f7f`.
It records base head `67213cacd569c0451c2abd6e4243698c7d35e418`, a dirty source
tree and patch SHA-256
`5ba3eb7faf05dcd62f3e5d62282fd363b590ba546ea2e16e4158e98947eba557`.
This is focused database evidence, not a complete PR or release certification.

Migration 017 also rejects SQL NULL, zero and unknown catalog versions instead
of treating NULL as explicit version-2 negotiation. The existing PostgreSQL
catalog case checks that boundary. Migrations 001–016 remain unchanged. Failed
checks can now report only a numeric location in the known test bundle alongside
the existing checkpoint and error code, without raw exception or database data.

The PostgreSQL guidance on database constraints, least-privilege roles and tenant
isolation is retained: the fixture obeys the canonical membership owner; the
application still cannot directly mutate financial records or read the event
inbox. Type checking passes in `output/qa/billing50-post-repair-types.log`.
Current browser/complete PR validation and the billing lifecycle work listed
above remain pending. External payment/model calls remain zero.

The fresh six-file focused cohort passes 140/141 checks. The existing provider
account-proof/CSRF case again exceeds its unchanged five-second test deadline;
its assertions and all production deadlines remain unchanged. The failed log is
`output/qa/billing50-post-repair-focus.log`. The passing PostgreSQL cohort does
not clear this unit failure. Complete current `test:ci` validation is required.

### Complete local PR cohort

Fresh complete `test:ci` run `31f342be-9121-4687-8f42-8017ef5036a9` passes
type checking, one production build, all 1,375 unit cases, 57 Chromium core
cases, 20 integration cases, five Firefox cases and 95 UI/website cases. All
eight scope reports identify the same run and pass. The build manifest verifies
again after execution. Reports, timings, the immutable manifest, log and tested
source hashes are preserved under
`output/qa/billing50-post-repair-pr/31f342be-9121-4687-8f42-8017ef5036a9/`.
This cohort runs the current three-file source correction above base
`67213cacd569c0451c2abd6e4243698c7d35e418`, with dirty-source status recorded.
The account-proof case passes unchanged within this complete cohort; no root
cause is claimed for its earlier focused timeout. The separate focused failures
remain failed. This is PR evidence, not full certification or native Mac evidence.

Hosted run 44401224758 validates the archive-access correction and produces
fresh scanner/database evidence for PR merge checkout
`8f4aaa740d558122354e11ec8448245ef6533bd6`, branch head `67213cac`. Candidate
artifact 14474490632 has SHA-256
`4ce0d3a809a7ecb78b4b8a9c52229270a8e1061ee36f8b5ec11c45fd8e825069`;
diagnostic artifact 14473451151 has SHA-256
`a9673c9c0f64f32ae493c2df3d8fbe36a00f4751a4164e02b30fc933cbb9b1ce`.
The scan reports 295 packages, 810 licenses and vulnerability counts of one
critical, 37 high, 100 medium, 87 low and seven unknown. Promotion is blocked
under the existing policy; findings are not waived or assumed exploitable.
The old branch then fails the PostgreSQL membership fixture corrected above.
Its macOS 15 arm64 cohort also fails native Firefox process inspection. Neither
the new local pass nor another head's native pass clears that hosted failure.

Subscription lifecycle execution remains unfinished and disabled. Keep #50 and
PR #97 open, and retain separate native, security, customer and release gates.
No model/payment requests, paid service, deployment, publication or archive
replacement is authorized by these results.
