# Opt-in inference transport verification, October 31, 2026

Scope: [#40](https://github.com/Sammieblz/tholi/issues/40), extending merged
`2e4880de8149c6ac4bd0592e3b28b2e45e6f1cbe`. This is development and PR evidence,
not release certification. Extension/API `0.11.0`, website `0.1.1` and existing
release archives remain unchanged.

## Ownership and safeguards

The existing service HTTP, PostgreSQL request ledger, protected extension account
settings and shared platform client own this transport. There is no additional
credential store, inference queue or journey owner. The new shared abort helper
is extracted from the existing model-operation wait and reused for browser waits.

The service is explicitly fake-only and disabled by default. Capability
negotiation and the required wire `profile: "fake"` cannot enable live Vertex.
Private `/v1` and `/v2` processing choices remain separate. The earlier #39
single-use paid experiment remains consumed; no new paid calls are authorized or
claimed here.

The original native identifiers, browser generations, observation lifetime and
shorter request deadline survive authentication, final transmission checks and
response admission. The last native capture callback runs after asynchronous
capability, consent and protected-account checks. Credential rotation, disabling,
sign-out and grant loss prevent new observation egress.

The API reuses current session, workspace and purpose authorization, with early
authentication before the larger body and fresh checks before model work and
proposal release. The existing durable request metadata is actor-scoped and
versioned. No raw observation, image or proposal enters the request ledger.
Replays are status-only; cancellation acknowledges intent without claiming that
another replica or provider stopped. Conditional SQL status updates prevent
completion from overwriting cancellation while preserving legacy reconciliation.

## Review and verification status

| Check                                                                                 | Status                                                                                       |
| ------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------- |
| Shared contract, platform-client and gateway-policy feedback                          | Passed: 83 cases within the final complete cohort                                            |
| Combined API, client and presentation feedback                                        | Corrected schema conversion; all 31 authorization cases and the final complete cohort passed |
| Original-context, credential-rotation, late-consent and cancellation-body regressions | Passed in the complete cohort                                                                |
| TypeScript and synchronized versions                                                  | Passed before the production build                                                           |
| Actual PostgreSQL, API and gateway stack                                              | Passed: 29 top-level checks, including 59 PostgreSQL checks                                  |
| Complete deterministic `test:ci`                                                      | Passed: 918 unit, 47 core, 20 integration, 2 installed Firefox and 67 UI checks              |
| Hosted required PR checks                                                             | Separate required gate; consult the issue PR before merging                                  |
| Native account/permission prompts and screen-reader speech                            | Not performed for this milestone; remain pending                                             |

The complete passing PR cohort is `ef3f4fb3-156e-447f-8780-626e29ed2aca`, with
1,054 checks and UI port 5188. It used the documented prepared-build option only
after verifying the immutable build produced by the first coordinated run.
The build manifest remained unchanged, with SHA-256
`d77ccb9401f8b48793e1b22a6939df0a48d431a00747226d045b3c72c8653b93`.
Its reports are retained in `output/qa/transport-40-ci/` under that run ID.

The separate actual-container run, `tholi-smoke-mvvxksc6-64cd1508`, passed all
29 top-level checks, including 59 real PostgreSQL checks. It covered the
cross-replica cancellation regression, the actual Nginx upload boundaries,
identity, workers, private mail/storage, backup/restore, telemetry and explicit
volume reset. Its redacted record is
`output/qa/local-stack/tholi-smoke-mvvxksc6-64cd1508/smoke.json`; the owned
containers and volumes were removed. All 23 preexisting release files retained
their recorded SHA-256 hashes after validation.

Earlier failures remain separate. The first combined feedback exposed OpenAPI 3
numeric bounds being supplied to Fastify's executable JSON Schema validator.
The existing schema helper now generates the appropriate dialect for each
consumer, and a permanent HTTP regression checks positive geometry and its
OpenAPI description. All 31 authorization tests then passed. The first complete
CI attempt, `d9b29f78-e881-4294-b93b-e6cabbf244fd`, passed its first four groups
but could not start UI because the developer preview occupied port 5174. The
passing complete rerun used the documented alternate port; it did not reuse or
stop that preview, change a threshold, exclude tests or rebuild the artifacts.

Independent source reviews cover API/client consent races, known-reference and
deadline preservation, cancellation across replicas, ingress limits and platform
credential ownership. The existing gateway fixture now covers actual chunked
uploads exceeding 4 MiB, alongside exact-size admission, declared oversized
bodies, ordinary-route limits and bodyless CORS. A fixture upstream establishes
ingress policy only; the separate real API checks establish authentication and
application admission.

For the account-settings controls, the project-local `fixing-accessibility` and
`ui-ux-pro-max` skills informed native labeled choices, associated helper/error
text, visible focus, minimum control targets and explicit status. Their upstream
files remain unchanged and outside production assets. Unit tests do not establish
native permission dialogs or spoken screen-reader output.

## Reproduction and limits

Use Node 24.19.x and the existing commands:

```sh
npm run typecheck
npm test -- navigation-contracts.test.ts service-client.test.ts local-stack-policy.test.ts gateway-validation.test.ts authorization.test.ts config.test.ts service-contracts.test.ts service-auth.test.ts widget-lifecycle.test.ts
npm run test:local-stack -- --optional
npm run test:ci
```

If another website preview is running, select the documented alternate test port
with `THOLI_UI_PORT=5188`. Prepared builds require an unchanged, verified manifest;
they are not a shortcut around compilation after product-source changes.

Each coordinated cohort retains its original identity and output. Earlier failed
runs are not relabeled as passing evidence. No release archive, production
deployment, provider call, account-data upload, entitlement producer or payment
flow is part of this milestone. The journey integration and richer recovery
presentation remain #41 and #42. Durable cost admission and the plan catalog
remain #44 and #58.
