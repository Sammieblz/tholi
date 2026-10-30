# Mail, support and private-file validation

Roadmap [#33](https://github.com/Sammieblz/tholi/issues/33), collected on
2026-10-30. This is new evidence for the optional service milestone, not release
certification or authorization to deploy, publish or replace an archive.

## Focused checks and review

The support application, real protocol adapters, worker and signed-provider
cohort passed 54 cases. Existing HTTP coverage passed 14 cases, including current
session revocation during storage I/O. Policy coverage passed 10 cases; support
and account UI coverage passed seven. Configuration, local policy and worker
lifecycle coverage passed 81 cases. The existing OpenAPI and website SEO cohort
passed 25 cases after adding the private-file inventory group and updating the
conditional contact descriptions.

Independent review found and corrected an SMTP ambiguity: Nodemailer can report
a post-DATA socket loss as `CONN`. A real loopback SMTP regression now requires
an uncertain result instead of an automatic resend. Other distinct regressions
cover immutable export bytes, post-read authorization, expired proof, download
integrity, deletion after account/membership revocation, late PUT reconciliation,
restored-membership non-resurrection and lease expiry inside a transaction.

The UI extends the existing form, account request owner, tokens and buttons.
The local `baseline-ui` guidance informed spacing and hierarchy; the local
`fixing-accessibility` guidance informed native labels, linked validation errors,
busy/status announcements and focus after submission. No new animation or
parallel authentication client was added. Automated layout checks do not
establish screen-reader speech or native browser permission behavior.

## Preliminary container evidence

The first clean, disposable stack passed 50 actual PostgreSQL groups and all
18 stack checks from commit `94a6ac712a0337d67e9613b71f3bfbe35031cd58`.
Evidence is retained at
`output/qa/local-stack/tholi-smoke-mvuzxm9z-c03e301c/smoke.json`.
The independently running production worker delivered distinct operator and
verified-account messages to Mailpit. The production API served a verified
diagnostic through its authenticated short-lived link. After account revocation
and expiry, an authorized storage GET independently returned 404. Backup readback,
retained restart, anonymous storage denial, explicit reset and reseeding passed.
The runner removed only its owned containers, volumes and generated credentials.

Final review after that run identified additional completion/prepare lease
checks and a late-write ordering during cleanup. That preliminary report remains
unchanged. It does not establish acceptance of the later corrected source.

## Acceptance gates

The corrected source still requires a fresh complete container run and the
deterministic `npm run test:ci` gate. Their results and exact source attribution
will be recorded here before the PR is accepted. Hosted validation and a fresh
review of the exact PR head remain separate merge gates.

No internet email delivery, hosted bucket lifecycle, production deployment,
account-erasure endpoint, billing notification or release package is certified
by local capture and diagnostic tests. Existing identity verification/recovery
evidence keeps its original attribution; Keycloak remains that workflow owner.
