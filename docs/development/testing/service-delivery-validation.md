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

Cloudflare edge behavior, Google gateway/WAF policy, hosted origin firewall
configuration, an internet-trusted certificate and production load testing
remain separate authorized deployment checks. Native browser permission,
screen-reader and signed-in flows retain their existing evidence attribution;
this nonvisual delivery change does not newly certify them.
