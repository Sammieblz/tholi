# Security and lifecycle hardening validation

Roadmap #45, November 7, 2026. Versions remain API/extension 0.11.0 and website 0.1.1.
No provider calls, paid resources, publishing or production deployment are enabled.

## Changes and acceptance

The [service security owner](../service-security.md) maps prompt injection,
forged scopes/origins, replay, callback mix-up, SSRF/egress, malformed images,
direct gateway access, plan spoofing and credit abuse to their existing controls
and regression owners. Its inventory distinguishes ephemeral inference input,
approved saved data, provider keys, account cleanup, mail and operator backups.
It records secret rotation, restricted support/audit access and quarantined restore
requirements without inventing an online suppression/backup service.

Migration 015 adds a worker-only expiry capability for idle PKCE proofs, logout
proofs and absolutely expired session/refresh families. Each table has a bounded
batch and locked candidates; refresh history remains until family expiry. Existing
account-scoped broker jobs remain compatible. Identity/provider grants and audit
access are unchanged. The existing worker scheduling tick invokes maintenance.

The OIDC wrapper explicitly retains manual redirects and exact configured JWKS
destination. It also refuses redirected/non-JSON/invalid-UTF-8 bodies. The pinned
JOSE version already supplied manual redirects; this is explicit boundary
hardening, not a claim of a previously demonstrated redirect exploit.

Service prevalidation bounds JSON depth, collections and total nodes before route
AJV/Zod work, without changing public wire schemas or the private API profile.
The focused real HTTP regression confirms rejection before a route validator and
retains ordinary input and the redacted correlated response. Existing navigation
and private-file contracts keep their own limits. This is a mitigation for hostile
HTTP collections, not a claim that every non-HTTP validator input is covered.

Existing account export/deletion, consent, provider isolation, saved-data version
conflicts/tombstones, tenant and sentinel regressions retain their owners. No
duplicated export, permission or deletion system was introduced. Public legal
drafts now explain immediate account disablement, pending physical cleanup,
separately retained copies and server-authoritative development allowances.

## Collected checks

- Focused OIDC/service transport: 60 checks passed, including distinct redirect,
  media/encoding and structure-budget regressions. TypeScript/version checks pass
  after serializing a test payload through the actual JSON transport type.
- The first local stack passed PostgreSQL, gateway, actual mail/storage, physical
  object expiry, snapshot/restore and retained/reset-data checks. Its runtime
  changed during investigation, so it is intermediate evidence, not final-image
  certification. The frozen hardened-image smoke and final hosted container
  checks are recorded with the implementation PR. The final PostgreSQL regression
  also checks logout expiry and refresh histories larger than one cleanup batch.
- The first complete local PR attempt stopped at one unchanged authorization
  test's five-second deadline while container/scanner work overlapped. It retained
  1,316 passing checks and one timeout. Its isolated existing authorization owner
  then passed all 54 checks without changing its deadline. Final matching-head CI
  is required; these partial/focused results are not combined into a full pass.
- The complete deterministic PR gate and matching-head hosted result are required
  before merge; final hosted evidence belongs with the implementation PR.

The frozen hardened-image stack subsequently passed all local-stack checks in
`tholi-smoke-mw6xe9sa-ef53d1be`, with the API and worker on runtime image
`sha256:7827cd746265887f3236d3df7285c8b35e084d253c1ebd9bbf2298a725c31d39`.
It covers actual PostgreSQL, TLS/gateway boundaries, Mailpit/private storage,
physical export expiry, backup/restore/readback, retained data and explicit reset.
The owned containers, volumes, networks and private environment were removed.
The later logout/history assertions remain assigned to final matching-head CI.

## Dependency and image review

Initial `npm audit --omit=dev --json` reported three affected package groups:
Fastify low, fast-uri moderate and Zod high. Fastify moved from 5.12.5 to 5.12.8;
fast-uri resolved to patched 3.1.9/4.2.3 within existing dependency ranges. No
package/API release version changed. The follow-up audit reports only Zod high,
[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
Zod 3.25.76 is the existing schema/converter API. Its major migration remains a
release gate; no compatibility import or scanner suppression pretends to fix it.
The HTTP structural guard, existing byte limits, strict route contracts, finite
model/file budgets and bounded application queues reduce exposure. An independently
reviewed resolution is required before certifying production.

Container vulnerability and license inventory use official Trivy 0.76.2, image
digest `sha256:8f6bb947dbc528902e11f2f5be52f7b519f6a39d5d148f41166f2040499768fb`.
The scanner receives only a saved runtime image and a report directory, without
host Docker socket, credentials or repository secrets. The first download exceeded
128 MiB of scratch space; an owned disk cache corrected that scanner setup. An
intermediate rescan still selected the older image and is excluded from the final
comparison. The reviewed candidate was checked for actual package versions and
absent npm/yarn before saving. Exact runtime/config digests, database timestamp,
raw-report checksums and findings are in
[the dated metadata evidence](evidence/security-review-2026-11-07.json). Existing build
notices remain the dependency-license owner. Scan output is an inventory, not an
independent license/legal opinion or proof of no vulnerabilities.

The API Docker runtime now applies available Debian security updates and removes
unused npm/yarn package-manager tooling. API and worker still use one image, Node
24.19.0, nonroot/read-only boundaries and the same shutdown/safety budgets. Build
repositories may change; reviewed immutable images, not a rebuild of an old tag,
are the deployment/rollback artifact. Baseline scanner observations were OS
critical 4/high 44/medium 104/low 82/unknown 5 and Node critical 1/high 13/medium
20/low 3. Final observations are OS critical 1/high 34/medium 95/low 82 and no
Node-package findings in that scanner's feed. The separate npm audit still flags
Zod. License observations are OS 589, Node 203 and loose files 17, not counts of
unique packages or legal conclusions. The remaining critical zlib source finding
is retained with [Debian's binary-package assessment](https://security-tracker.debian.org/tracker/CVE-2023-45853);
no global ignore rule was added. Other unresolved vendor findings and the Zod
major migration remain production-review gates, not implicitly accepted risks.

Provider documentation review is linked in the canonical security owner. It
records documented training/retention exceptions and unverified account/residency
controls; it does not promise zero retention. No prompt or screenshot is sent to
review documentation or execute these tests.

Local raw reports stay under ignored `output/qa/`. Native store installation,
permission prompts, physical devices, screen-reader speech, professional legal
review, actual hosted retention/restore/incident operation and the deferred live
quality gate remain separate and unperformed by this milestone.
