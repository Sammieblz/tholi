# Invited private beta

Owner: [roadmap #23](https://github.com/Sammieblz/tholi/issues/23),
[issue #49](https://github.com/Sammieblz/tholi/issues/49). This is an operating
proposal and readiness checklist. No cohort has been recruited or enabled by
this document. The approved offline preparation exception permits development;
it does not supply live quality, hosted, customer or release evidence.

## Opening decision

Keep the beta closed until the operator records every gate below against the
same reviewed source and immutable artifacts. Store a private execution record
for participant details; commit only credential-free, aggregate evidence.

| Gate                          | Required evidence and owner                                                                                                                                                                                                                                                                             |
| ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Product quality               | #43's independent comparison and an explicit go/no-go decision. The zero-spend decision keeps live evaluation deferred. Fake inference supplies integration evidence only.                                                                                                                              |
| Delivered bytes               | #48's complete candidate verification plus the existing [certification and release procedure](releasing.md). Record website, both browser targets, API/worker image, schema and configuration digests. Public store approval for older bytes does not deliver unshipped account/cloud features.         |
| Invited admission             | A reviewed identity-provider and service admission policy that actually rejects an uninvited actor. Prove the boundary before exposure; the open-registration [local realm](../../infra/local/oidc/tholi-local-realm.json) is a development fixture.                                                    |
| Hosted operation              | Separately authorized deployment, identity/PKCE returns, TLS, private SQL/storage, gateway/egress restrictions, quotas, backups, suppression-aware restore and outage drills. [VM](../../infra/vm/README.md) and [Google](../../infra/google/README.md) preparation do not establish deployed behavior. |
| Security and support          | Review unresolved dependency/image findings, processing recipients/locations, retention, support ownership and incident response through [service security](service-security.md). Verify the actual support transport; a queued notification is not inbox delivery.                                     |
| Publication and native checks | Approved beta distribution, permissions and accessibility checks using the actual proposed clients. Native CI does not replace store prompts, physical-device or screen-reader evidence.                                                                                                                |
| Commercial isolation          | Local and approved Free access remain independent of checkout. Paid plans stay unavailable until #50 and their subsequent commercial gates are satisfied. No unlimited-service promise.                                                                                                                 |

Record each decision as pass, fail or pending, with its artifact/run reference,
reviewer and time. Pending or missing evidence keeps admission closed. Do not
replace the deferred quality gate with a successful sign-in, credit grant,
synthetic proposal or website animation.

## Proposed cohort and support

Start with at most five consenting adult technical testers for one week. This is
a proposal for the maintainer's approval, not a list of invitations. Include
supported desktop Chrome and Firefox, Windows and macOS, with each tested
OS/browser/build recorded separately. Use the minimum browser versions in the
current [setup guide](../guides/getting-started.md).

Limit navigation to signed-out public Wikipedia reading, public GitHub repository
browsing and synthetic practice. Select exact supported tasks from the existing
[comparison declaration](testing/perception-comparison.md) before collection.
Keep credentials, private repositories, banking/medical tasks, destructive or
publishing submissions and OS control outside this first cohort. Unsupported
requests should stop or clarify rather than invent an action.

The proposed support owner is the repository maintainer. Before opening, record
a named primary and backup, a monitored contact channel, coverage hours and an
achievable response target. Reuse [Support and Contact](service-support.md), the
operator-owned contact address and the incident procedure. Do not invent an SLA
or use a notification job receipt as proof that support received the message.

## Separate participant choices

1. Explain the build, supported tasks, known failures, processing recipients,
   retention and withdrawal procedure before enrollment. Obtain separate consent
   for participation and any optional research collection.
2. Offer **Use Tholi locally**, with **No account required**, throughout. A store
   link, practice session or account creation does not install the extension or
   enable cloud inference.
3. An invited account may explicitly enroll in approved Free Cloud when the
   deployment advertises it. Use real website/OIDC registration, verification,
   recovery and native PKCE. A website cookie never establishes an extension
   session. The local fake Free allowance is not a commercial allowance.
4. Require separate choices for provider transmission, optional images, cloud
   saved-data import, persistent navigation learning and product analytics.
   Learning remains off until account/workspace/site approval. Signing in must
   not upload local records automatically.
5. Customer-funded connections require their own provider/data/cost disclosure
   and participant authorization. This zero-call preparation does not authorize
   a BYOK test or make the customer's provider cost zero.
6. Make pause, Local mode, disconnect, export, forget-site and account deletion
   reachable. Withdrawal stops future collection. Explain existing copies,
   in-flight effects, worker cleanup and backup rotation accurately.

Keep invitation identities, credentials, provider keys and consent receipts out
of public issues and source control. Record study participation in the private
operator execution record. Application processing continues through the existing
account, authorization and audit owners. No research-consent purpose or database
is claimed to exist. Account processing choices remain separate from participation.

## Required hosted walkthrough

Execute these checks on the proposed deployment and retain results per browser
and build. Existing local fixtures can rehearse them; mark hosted checks pending
until performed.

| Scenario                   | Required result                                                                                                                                                                                                                                                       |
| -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Installation and Local     | Exact approved store/distribution destination, working permission choice, no account dependency, no cloud requests in Local and no installation claim from a link click.                                                                                              |
| Identity and first run     | Real signup/verification, sign-in/recovery, cancelled and stale native returns, restart, sign-out and account switching; previous private views never populate the next account.                                                                                      |
| Data and learning          | Explicit import/CRUD, all four artifact kinds and negotiated graph views, revision conflicts, export downloads, deletion/tombstones, retention and independent verified transitions; Local stops transmission/retrieval/learning.                                     |
| Quotas and credits         | Exact quantities, concurrent admission, replay and uncertain outcomes across replicas. Exhaustion retains authorized read/export/delete and Local use. Fake grants and provider usage never establish task completion.                                                |
| Outage and recovery        | Provider/SQL/storage/identity failure, cancellation, rolling restart, queue recovery, read-only fallback and a quarantined restore that reapplies current withdrawals/deletions before serving data. No automatic redispatch of an unknown model/mail/payment effect. |
| Feedback and accessibility | Actual support delivery status, explicit content-free diagnostic export, keyboard/focus/errors/reduced motion, both themes and representative narrow/wide layouts; screen-reader speech and permission prompts recorded manually.                                     |

Reuse [backend delivery](backend-delivery.md), [account onboarding](account-onboarding.md),
[saved data](service-saved-data.md), [credits](service-credits.md),
[support](service-support.md) and their existing tests. These checks add operating
evidence; they do not create another planner, account, ledger or cleanup owner.

## Measurement and stop rules

Before collection, freeze supported tasks, attempt denominators, observation
windows and decision criteria. Retain failures, unsupported attempts, abandonments
and unknown outcomes. Measure independently completed tasks and repeated use,
calls/tokens per completed task, latency, stale-route rejection, verified spend,
unknown liabilities and support time. Keep user-reported success separate from
independent verification. Do not turn clicks or animations into arrival metrics.

Reuse [consented analytics and operational telemetry](service-observability.md).
Default feedback contains a case/build reference, a bounded failure category and
voluntary comments. Never automatically capture goals, field values, page bodies,
screenshots, credentials, private URLs or support text into analytics. Explain
the optional diagnostic's actual contents before export. Small-cohort reports
must avoid identifying individual participants. Synthetic/fake cost is not
measured live unit economics; missing spend stays unknown.

Stop admission or transmission for unauthorized data exposure, missing masking,
scope/callback violations, duplicated charges/grants, an unknown cost barrier,
broken withdrawal/deletion or a failed restore boundary. Use the existing
[incident procedure](service-security.md#incident-and-quarantined-restore).
Retain Local guidance, contain effects and verify recovery before resuming.
The current preparation allowance is **zero external model/payment calls**.
Any live beta scope needs its own bounded approval; an alert is not a hard cap.

At review, publish a credential-free operating record with cohort size, consent
process, source/artifacts, separately collected outcomes/cost/support burden,
failures, withdrawals, remediation and the next decision. This phase does not
promise general availability or establish sustainable paid value for #51.

## Draft availability wording

Use the following only after reviewing it against the actual approved build and
configuration, with the relevant help, privacy, terms and store disclosure owners:

> Tholi's local guidance works without an account. Cloud account features are
> available only to invited testers where enabled. Signing in does not upload
> local data automatically. Cloud processing, optional images, saved data and
> navigation learning have separate controls. Free usage is limited by the
> service. Paid plans are unavailable in this beta. Guidance can be incomplete;
> you make the clicks and can pause, stop or return to Local.

The contact page prepares an email draft unless the signed-in deployment offers
the actual support-request capability. That capability confirms saving/queuing,
not inbox delivery. Practice controls the website example, not an installed
extension. Keep published help factual for its current release; do not silently
replace existing public/store disclosures with this draft.

## Preparation validation

November 18, 2026: this change introduces repository operating documentation only.
It changes no public help, legal notice, browser artifact, account configuration,
commercial allowance or release version. Relative links, referenced control labels
and opening gates are reviewed against their existing owners. All 102 relative
links across this guide, the documentation index and the canonical plan resolve.
The complete `test:ci` cohort `c4995203-9372-49e3-8f7a-5ff90cf68ea1` passes
1,336 unit, 57 core, 20 integration, five native Firefox and 95 UI cases.
The documented prepared-build option uses unchanged, verified artifacts. All
eight passing reports share that run and PR tier; evidence is preserved under
`output/qa/private-beta49-pr/`. This is PR validation only. Hosted walkthroughs,
participant outcomes, measured live spend and support burden remain pending.
