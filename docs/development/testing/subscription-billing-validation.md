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
