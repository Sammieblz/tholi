# Backend delivery and promotion review

Roadmap #48 extends the existing build, local-stack and full-validation owners.
It does not provision a registry, VM, cloud service or payment account. Ordinary
CI makes no external model requests and receives no deployment credentials.
Product/extension/API remain 0.11.0 and website remains 0.1.1 during preparation.

## One runtime image per candidate

`npm run test:backend` requires the existing immutable client build manifest.
It creates a new `output/backend-candidate` directory and refuses to overwrite
one. It builds the existing Dockerfile's `runtime` target once for Linux amd64
using the common build's API bundle, verifies its file hashes inside the image,
records its source revision and image config digest, then runs the existing
local, production-style VM and two-replica drills using that loaded image ID.
API, worker and one-shot migration/tools commands use the same bytes. The
PostgreSQL test image is a separate fixture and is never promoted.

The prepared Compose overlay removes source builds, disables pulling and keeps
all existing network, non-root, consent, timeout and resource boundaries. Plain
`npm run local:up` retains the existing source-build development behavior.

The cohort also builds a separately configured local-identity website inside its
owned QA directory. Existing Chromium and Firefox website tests perform real
Keycloak registration, Mailpit verification/recovery, sessions, dashboard,
saved-data, credits, Local/Free onboarding and private-learning controls. They
retain their own focused evidence and do not certify native extension permission
dialogs or screen readers. Shared public website/extension bytes are verified
before and after this explicit side build. Paid plans remain unavailable; a
fixture or checkout return cannot establish an entitlement. Real sandbox payment
lifecycle checks join this owner only when billing #50 exists.
The account cohort retains all twelve existing case deadlines and gateway
capacity schedules. Its coordinator allows up to 65 minutes for their combined
budgets; the job has a separate 95-minute bound including build, SQL, VM and scan
work. Browser, provider and service safety budgets are unchanged. Actual timings
must be measured rather than inferred from these maximums.

## Candidate evidence and security

The reusable `backend-validation.yml` runs in PR and full workflows. It records
one coordinated run ID, hashes the compressed Docker archive and its reports,
and retains a short-lived `backend-candidate-ATTEMPT` metadata artifact. It does not push
an image or assign a release tag. Ordinary PR and nightly runs retain metadata
only. The large image archive stays on the disposable runner unless a manual
Full validation explicitly selects `backend_archive` after storage allowance
approval; that separate `backend-image-ATTEMPT` artifact has one-day retention.
PR candidates remain PR evidence, even if all
checks pass. Full browser owners still require one complete matching run and
both actual target artifacts. Rerun a failed full cohort in full, as required by
the existing [testing policy](testing/README.md).

The pinned Trivy image reads the saved runtime archive without a Docker socket,
home directory or credentials. A new ownership-labelled cache downloads only
the public vulnerability database. Actual archive scanning then runs without
network access and records the package/license inventory. The owned cache is
removed. Findings are retained; high, critical or unknown severity blocks
promotion. A successful scan invocation is not a clean security review. License
acceptance is a separate explicit operator review. Reports older than 24 hours,
missing inventories or a different image digest are rejected.

`npm run verify:backend` verifies the archived bytes, source, schema inventory,
image bindings, completed local/VM/replica evidence, local account checks,
offline deployment profiles and fresh scan. Set `THOLI_VALIDATION_RUN` to the
original recorded run; unrelated results cannot be combined. The archive hash
is an integrity check. Trust in its source requires the matching successful
GitHub run and protected review, not a JSON file supplied by a caller.
Client full certification checks the backend records after the backend job has
already verified the actual archive. The explicitly named `verify-records`
operation does not verify missing archive bytes or authorize promotion. Promotion
requires an approved full archive export and the ordinary full byte verifier;
records alone cannot supply a deployable image.

Current dependency findings from #45 remain release blockers unless a fresh
scan and review resolve them. This pipeline adds no suppressions or risk
acceptance. Hosted identity/provider retention settings and the independent
#43 quality gate remain separate from deterministic preparation.

## Staging, production and rollback

`Review backend promotion` is a manual, non-deploying workflow. It accepts a
successful **main** Full validation run, destination and nonsecret approval
record. Its read-only preflight verifies source repository/revision, full
workflow identity, completed status and original attempt. It refuses a missing
or unprotected environment before GitHub could implicitly create one.
The selected full run must have exported its backend image archive explicitly.
Environment review uses `deployment: false`, retaining required review without
creating a misleading deployment-history entry.

Configure the intended `backend-vm-staging`, `backend-google-staging`,
`backend-vm-production` or `backend-google-production` environment with required
reviewers, no administrator bypass and protected-branch deployment policy.
Protect main separately. These repository settings are operator setup and are
not claimed to exist merely because the workflow exists. No cloud identity,
SSH key, downloaded service-account key or production secret belongs in this
review workflow. Future execution must use separately approved least-privilege,
short-lived credentials for the selected target.

The review checks explicit deployment/release, live-quality, identity, manual
and license attestations. These are references to reviewed human evidence,
not automated proof of those activities. Record actual evidence before setting
them true. Production additionally requires passing same-platform staging with
the identical source, image and schema. Its output explicitly says execution
was not performed. It does not authorize or perform deployment by itself.

After separate execution authorization, follow the existing
[VM](../../infra/vm/README.md) or [Google](../../infra/google/README.md) procedure.
Load/promote the tested archive in an isolated image store; do not rebuild it.
Verify a registry manifest digest resolves to the tested config digest before
using a registry reference. This source milestone does not equate Docker config,
archive and registry-manifest digests. Keep PostgreSQL private, run the existing
locked migration once, verify role/schema/readiness, apply the approved capacity
ceilings and check authenticated no-store routes, identity callbacks and data
isolation through the actual ingress before opening traffic.

The local rollback drill certifies restart of the same compatible image and
schema, not arbitrary older binaries or schema downgrades. The review record's
rollback image/schema must match that tested path. A different rollback image
needs its own compatibility evidence before extending this contract. Follow
the existing [quarantined restore procedure](service-security.md) for database
recovery; replay current deletions and consent withdrawals before restoring
traffic. Production TLS, IAM, provider egress, gateway policy, backup retention
and post-deployment health remain actual deployment checks.

## Primary references

- [GitHub workflow security](https://docs.github.com/en/actions/reference/security/secure-use)
- [GitHub environment review](https://docs.github.com/en/actions/how-tos/deploy/configure-and-manage-deployments/review-deployments)
- [GitHub environment API](https://docs.github.com/en/rest/deployments/environments)
- [GitHub artifact storage billing](https://docs.github.com/en/billing/concepts/product-billing/github-actions)
- [Trivy archive scanning](https://trivy.dev/docs/latest/target/container_image/)
