# Service API contract verification, October 30, 2026

Scope: [#29](https://github.com/Sammieblz/tholi/issues/29), based on
`b933e50e9343ed1605f86b15e9cc8f8dd4b575bc` and this issue branch's changes.
This is development/PR evidence, not release certification. Extension/API
`0.11.0`, website `0.1.1` and existing archives remain unchanged.

## Ownership and review

Extended the existing service HTTP owner, shared navigation contract package and
API route composition. The single inventory distinguishes executable discovery
from future account, organization, decision, data, credit and billing operations.
No protected endpoint, model provider or second backend client was introduced.

Independent source/acceptance review covered profile compatibility, shared wire
schemas, OpenAPI, input bounds, safe errors, cancellation, idempotency and future
scope. Review findings were corrected before the full PR gate:

- JSON example annotations now use the pinned Swagger plugin's supported JSON
  Schema `examples` form, preserving strict AJV validation.
- Explicit HTTP pagination parses canonical query strings without enabling JSON
  body type coercion. Malformed, duplicate and oversized limits are rejected.
- Deadline and shutdown aborts end incomplete uploads before JSON parsing or
  handlers can complete. Disconnects do not write to a closed client.
- Unexpected exceptions return safe, non-retryable 500 `INTERNAL_ERROR`, because
  an exception alone does not establish that an operation failed to commit.

The legacy `/v1` and `/v2` response shapes, bearer policy and inference/OCR
timeouts are preserved. Their authenticated responses gain explicit `no-store`.

## Validation status

| Check                                                         | Status                                                                          |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Focused service contracts and API profiles                    | Passed: 22 new service cases and 8 existing profile cases                       |
| TypeScript after final request-lifecycle corrections          | Passed                                                                          |
| Complete deterministic `test:ci`                              | Passed: 432 unit, 47 core, 20 integration, 2 installed Firefox and 65 UI checks |
| Production build and unchanged product/website version checks | Passed within the coordinated PR run                                            |
| Local documentation targets and formatting                    | Passed: 84 local targets; changed files formatted                               |
| Hosted required PR checks, including container smoke          | Separate gate; consult the issue branch PR before merging                       |

The focused tests use real loopback HTTP for noncooperative-operation deadlines,
client disconnect, shutdown, and deadline/shutdown during unfinished JSON
uploads. Test-created routes exercise transport behavior without adding
production diagnostic endpoints. Shared validators act as extension, web and
desktop clients; OpenAPI's own handshake example is submitted to the live route.
Every planned inventory operation remains unavailable. Existing profile tests
retain resource cleanup ordering and the v1/v2 retained-request regression.

The complete passing local cohort has validation ID
`d0627d08-bb26-422e-82a3-be7913d3053b`. It built once and froze all outputs in
`output/build-manifest.json`. The reported extension build digest remains
`7de2d3035991253cb822afc46c1fade081b2a65f27867bf9a559d1fc5a32533f`, because the
extension bytes did not change; the manifest separately covers the new API
outputs. Generated reports are retained under ignored `output/qa`, not committed
or substituted for earlier release evidence.

A final consistency review corrected the executable's older "only health"
startup message and related setup wording to include API discovery. This
diagnostic-only correction followed the local cohort above; focused TypeScript
and bootstrap checks passed afterward. The required hosted workflow validates
the final PR commit, including that correction.

No signed-in or native permission flow is claimed by this ticket. Real identity
and native-browser authentication remain #30. No release, packaging or
production deployment was performed.
