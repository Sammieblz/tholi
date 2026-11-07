# Deployment portability validation

Roadmap #46, November 7, 2026. API/extension remain 0.11.0 and website 0.1.1.
No release, deployment, paid resource or external model request is authorized.

## Changed owners

The complete [VM profile](../../../infra/vm/README.md) replaces the incomplete
gateway-only overlay. It uses the same API/worker/migration image, role bootstrap,
migration ledger, gateway policy and existing configuration owners. Separate
protected files keep migration credentials out of API/worker environments. The
local and VM profiles now share one actual restore/readback check rather than
duplicate backup verification. Historical delivery evidence is unchanged.

The [Google profile](../../../infra/google/README.md) prepares HTTP service,
continuous workers, a one-shot migration job, private managed PostgreSQL, separate
runtime identities, pinned secret references and HTTPS/no-CDN ingress. Provisioning
defaults off. A separate workload phase prevents startup against an empty schema.
The operator migration wrapper only supervises proxy shutdown; schema logic stays
in the existing CLI. Secret values and service-account keys never enter IaC.

The worker's optional private HTTP health port reuses `JobWorker.ready()` and its
existing healthy timestamp. It exposes only empty live/ready responses, starts
no business API, closes on drain and is absent by default. Current database/worker
roles and shared safety budgets stay intact. The focused existing runtime/bootstrap
cohort passes 24 checks, including stale health, bad paths/methods and cleanup.

Installed PostgreSQL guidance applied: finite role-specific connection pools,
separate migration authority and explicit rollout/headroom allocation. No external
pooler, Supabase service or cloud-specific SQL authority was introduced.

## Collected evidence and limits

The initial local combined smoke passed its local-profile checks, then rejected
an invalid synthetic cookie-domain topology in VM startup. The fixture was
corrected to the same parent/child policy required of real website/API origins;
identity validation was not relaxed. This intermediate cohort also overlapped
source preparation and is not final immutable-head certification.

The focused VM cohort `tholi-smoke-vmvmcheck46-e270c242` passes nine checks with
runtime image `sha256:4bae30df67d0afffe5237c99a71829f22f6fa6332a3f1e51e185283b441cb5f2`:
same API/worker bytes, verified synthetic TLS and Secure/HttpOnly cookies, canonical
callback, concurrent migration replay/runtime verification, real local migration
under synthetic proxy supervision, controlled authenticated HTTP reads, rejected
candidate/known-configuration recovery, complete restore/scoped readback and retained
data after restart. Its owned project/volumes/private env files were removed.
It runs inside the local Docker Linux VM; it is not a physical remote VM or Google
deployment. Its database identity is a controlled fixture, not real provider login.

Locked Terraform validation and mocked interlock/foundation/workload/capacity plans
pass with networking disabled. Provider initialization downloads only the pinned
public tooling, with no home, token, ADC or cloud-state mount. The canonical
`npm run test:deployment` report records source hashes and removes its owned
provider cache. It adds no dependency tree to the repository.

The complete local `npm run test:ci` gate passes: version/types and production
build, 1,318 unit checks across 95 files, 57 core, 20 integration, five native
Firefox and 95 UI checks. Its first attempt caught the removed gateway argument
still present in the adjacent type declaration; the declaration was corrected
before this complete fresh pass. Generated acceptance output is kept separately
in ignored QA storage; historical tracked reports were restored.

The frozen combined local/VM cohort `tholi-smoke-mw7099at-2d0da87a` passes at
source `7babc9fe2987c1f18331b8b5d929599a7b4afdcd`, including both successful and
failed local migration supervision. Review then added explicit private PostgreSQL
logging flags and a service-wide Google replica cap across revisions. This earlier
cohort is not relabeled as evidence for those changes. Final matching-head hosted
checks remain required before merge. Final evidence belongs
with the implementation PR and issue acceptance record; focused and failed cohorts
must not be combined or relabeled as that result.

The first hosted cohort rejected the VM gateway on Linux. Its QA TLS mount used
the host-private 0700 environment directory as the container mount root, denying
the nonroot gateway traversal. QA now mounts a separate traversable TLS child;
environment files stay outside that mount. Windows bind-mount behavior had hidden
this fixture permission failure. The hosted failure is retained, and a new complete
matching-head cohort is required.

Production DNS/certificates, external identity/native callbacks, Google IAM/SQL,
managed backups, configured mail/object transports, hosted alerting and production
restore remain unperformed. The prepared Google profile cannot yet admit production
accounts because its export/deletion transports are disabled. Neither this record
nor the VM drill authorizes a production launch or resolves deferred live quality
and security release gates.
