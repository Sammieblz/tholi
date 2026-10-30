# Gateway, CDN and edge-delivery validation

Roadmap [#34](https://github.com/Sammieblz/tholi/issues/34), collected on
2026-10-30. This record covers the delivery milestone separately from earlier
support, identity and database evidence. It does not authorize deployment,
publication, a website release or replacing an existing archive.

## Scope and pending validation

The change extends the existing Fastify, local gateway and website static-build
owners. It adds a VM TLS adapter and shares the website cache policy between
Cloudflare Pages output and an optional Nginx static-host fragment. No edge
function is required by the demonstrated workflows. The raw-byte receiver is
test-only; no unsigned production webhook endpoint is introduced.

The complete deterministic PR cohort, actual local-stack/TLS checks and
exact-head hosted validation are pending until their results are recorded below.
No earlier report is relabeled to cover these edits.

The focused configuration, service HTTP and retained-profile cohort passed all
96 cases. The shared delivery/static-output/metadata/router cohort passed all
12 cases; the resolved VM policy and owned QA safety cohort passed all 12.
Whole-project TypeScript passed after the final account-alias fixture typing
correction. Independent review corrected an obsolete authentication probe,
trailing-slash static aliases and static MIME configuration before collecting
container acceptance evidence. Real socket cases include forged forwarding,
bounded admission, partial-header timeout, header overflow and Node's early
socket-budget rejection with distinct server correlation and no-store headers.

## Initial actual stack

The clean source `834120aa1448e13038bc5502b59bdb9104e419da` passed all 51
PostgreSQL groups, startup and repeated seed/migration checks. Its gateway
cohort passed TLS, exact-host rejection, forwarding/raw-byte preservation,
private cache isolation and upstream retry-header preservation, then failed
inside the grouped authentication/CORS/body probes. The unchanged report is
`output/qa/local-stack/tholi-smoke-mvv2wbrm-8219a696/smoke.json`, collected from
14:39:41 through 14:43:15 UTC. Its owned project, volumes and synthetic TLS files
were removed. It is failed evidence, not acceptance. The probe now identifies
the fixed operation and numeric status without logging headers, bodies, private
URLs or raw exceptions; its assertions are unchanged.

## Complete fresh container run

The clean source `f450bbe470ef710711d840bed23317dd4d55fcc8` passed all 51 actual
PostgreSQL groups and all 27 stack checks. Its unchanged report is
`output/qa/local-stack/tholi-smoke-mvv35oc5-e1d6a698/smoke.json`, collected from
14:46:57 through 14:55:39 UTC. All nine gateway groups ran against actual Nginx
and the production API. They cover the resolved VM overlay, normally verified
synthetic TLS, exact Host/SNI rejection, raw signature-relevant bytes, forwarded
header replacement, private cache isolation, authoritative upstream Retry-After,
direct API controls, static aliases and MIME types, and coarse uncached 429s.

The same run passed the independent worker/mail/private-file cohort, physical
expiry, backup/runtime-role readback, retained restart, private storage denial,
optional collector ingestion, and explicit reset/reseed. The runner removed its
owned containers, volumes, private environment and synthetic TLS fixture.
No user preview was stopped or reused.

The preceding grouped-probe failure did not recur. The only intervening
executable change added diagnostics, without weakening assertions or changing
application/proxy policy. Its original cause remains unattributed. Exact-head
hosted container validation is an additional independent gate; a later pass does
not turn the earlier failed report into successful evidence.

## Initial complete PR gate

The first `test:ci` attempt passed types, then stopped in the website production
build at the strict asset-inventory check. No browser or unit results from that
attempt establish acceptance. Its unchanged coordinator timing is retained at
`output/qa/service-delivery-failed-build-f1dbe0cc-50ff-41b8-bc4c-011d7ff57258/timing-ci-all.json`.
The inventory must inspect Vite's final written bundle, including CSS emitted by
later generation hooks; untracked output remains an error. Complete corrected
build and cohort evidence will be recorded separately.

The corrected collector runs in `writeBundle`, after generation completes. A
distinct regression verifies both late-emitted CSS inventory and its actual
prerendered stylesheet link. The focused website cohort passed 13 cases and
whole-project TypeScript passed. A real website build then passed with 23
prerendered routes, 26 assets and 84 Cloudflare header rules. Every actual asset
has its own immutable rule; untracked assets still fail. The generated operator
fragment is ignored locally and remains outside public assets.

## Deployment limitations

Cloudflare edge behavior, Google gateway/WAF policy, hosted origin firewall
configuration, an internet-trusted certificate and production load testing
remain separate authorized deployment checks. Native browser permission,
screen-reader and signed-in flows retain their existing evidence attribution;
this nonvisual delivery change does not newly certify them.
