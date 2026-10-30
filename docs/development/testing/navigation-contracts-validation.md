# Navigation contract validation

Roadmap [#36](https://github.com/Sammieblz/tholi/issues/36), recorded on
2026-10-30. This evidence owner covers the independent ephemeral observation and
decision contract. It does not relabel earlier perception, OCR or navigation
reports, and does not authorize publication, deployment or packaging.

## Scope

The change adds strict bounded navigation schemas and pure admission/freshness
validation, shares the sanitized task-context projection with the existing model
context, and publishes explicit future schemas in the service OpenAPI components.
It enables no decision route, model provider or upload path. Service discovery
continues to report `decisions: false`, and current HTTP body limits remain in
force. Legacy private protocols and persisted models remain compatible.

The [architecture record](../../architecture/navigation-contracts.md) describes
native references, browser authority, sanitization, coordinate provenance and
clock-domain rules. PNG container admission is not pixel decoding or proof of
privacy masking.

## Validation status

The final combined focused cohort passed 99 tests across eight files, covering
navigation contracts, service contracts, static PNGs, continuous navigation,
task journeys, authentication, natural language and page context. Whole-project
TypeScript and synchronized version checks passed after correcting a literal
version type in the new test fixture. An independent source review found no
remaining contract blocker. This is working-tree feedback, not release evidence.
The production build and complete `test:ci` passed as recorded below. Exact-head
hosted PR checks remain a separate pending gate. No previous milestone's run is
claimed as current evidence.

The first complete gate, source `6bc43a5e2fae6661fba5e2613d743ca85829ec2e`
and run `5ff69dd7-d24e-4074-b6f9-da776e6c1208`, passed its fresh build, types
and all 651 unit tests. Core browser checks passed 46 cases and failed one
existing model-follow-up assertion that still expected the removed raw
`task.destination` object. The full sanitized goal and verified step summary
were present. The existing browser test now requires the destination object to
be absent, verifies that summaries contain only label and kind, and retains the
independent destination-navigation outcome check. Its focused rerun passed with
run `591c5508-0a34-44dd-b62f-bf200cdd3226` against the same verified build digest
`86515f15740ba17f01c2a2f0694625fd36866be165a10f8a2cc4989c41d466e4`.
The failed and focused reports are preserved separately under ignored
`output/qa/navigation-contracts-*`; neither is a complete passing gate.

## Complete local PR gate

Source `c8de5a62624bf586454f48b9f7a22aab689e96a3` passed the complete
`test:ci` selection with run `312a08bd-8e2e-4f48-abe6-5b27225d165d`:

| Owner                    | Passed |
| ------------------------ | -----: |
| Unit                     |    651 |
| Core browser             |     47 |
| Integration browser      |     20 |
| Installed Firefox        |      2 |
| Extension and website UI |     67 |
| Total                    |    787 |

Only the existing browser assertion and this validation document changed after
the fresh build from `6bc43a5e2fae6661fba5e2613d743ca85829ec2e`. The complete
rerun therefore used the documented prepared-build option, with the immutable
manifest verified before and after the run. A fresh whole-project TypeScript
check also passed on the final source after that run. This is PR evidence, not
full release certification.

The Chromium artifact digest is
`86515f15740ba17f01c2a2f0694625fd36866be165a10f8a2cc4989c41d466e4`;
the installed Firefox report identifies its separate target digest as
`e359d7c62e27201c33cdbe71e2dcf93747578f04f5c6e9fb9ecb273c73bac465`.
All eight test-report files identify the same complete PR run. The ten retained
reports, timing record and manifest are under
`output/qa/navigation-contracts-ci-312a08bd-8e2e-4f48-abe6-5b27225d165d`.
The verified manifest SHA-256 is
`6e1caccfd0406115327b0acf86f39a00eb14860736a0bb9b1e4ef264965bedce`.

## Initial hosted container failure and fixture correction

[PR #75](https://github.com/Sammieblz/tholi/pull/75)'s initial
[workflow 41111115550](https://github.com/Sammieblz/tholi/actions/runs/41111115550)
built successfully at head `090d9e288bdf9d4e86b0cd9b9a469db81c1cfa2d`.
Its container job failed in the existing real PostgreSQL check for external
completion when a live lease expires during SQL lock waits. The report recorded
only `ERR_ASSERTION`, so the exact failing assertion is unknown. No complete
PostgreSQL or container pass is claimed for that attempt.

The redacted report is preserved at
`output/qa/hosted-navigation-contracts-failed-41111115550/tholi-smoke-mvvc2lwb-cf348220/smoke.json`.
Its clean source was GitHub's PR merge
`cfee9a09f5b71cd16397121cbde6789bd8d84da7`. Artifact `13003158290` was
downloaded and verified against SHA-256
`bc487d52d025be819576c42f06dd007ef07d4b969fe63f6400f19def0cde495d`.
The report confirms cleanup of its owned project and volumes.

Two independent reviews identified concrete fixture defects. The expiry was
round-tripped through a JavaScript `Date`, which loses PostgreSQL microseconds
as documented by [node-postgres](https://node-postgres.com/features/types#date--timestamp--timestamptz).
The short lease also started before blocker setup completed. These defects can
release the lock too early or consume the intended observation interval; the
original report does not establish which caused its failure.

The existing test now arms the same 750 ms lease only after the protected row
is locked, using the existing scoped runtime transaction. It compares database
time directly against the exact stored expiry. The 500 ms positive lock-wait
witness and every refusal, rollback and outbox assertion remain intact. Fixed
assertion-phase codes survive redaction, and cleanup drains pending completion.
No production SQL, grants, repository behavior or timing budget changed.

Independent review passed. Fresh actual PostgreSQL/container validation and a
new exact-head hosted workflow remain pending for this correction.

## Local stack rerun and HTTP admission probe

The first local rerun used clean source
`5d0d7ab96f0e3cdf7fe5c89bed198117b489be47`. Actual PostgreSQL migration and
repository checks passed, including both corrected lease-expiry scenarios.
The broader smoke then failed at the direct API body-budget probe: the client
recorded no completed status where 413 was required. Its report is preserved at
`output/qa/local-stack/tholi-smoke-mvvcjfun-5ac6ddfa/smoke.json`; it confirms owned
project and volume cleanup. This is not a complete passing stack run.

Independent review found that the existing probe wrote 512 KiB plus one byte
while Fastify could reject its declared length before reading that upload and
close the connection. The report did not retain the transport error, so an
early-response/upload race remains a diagnosis rather than a proven sole cause.

The probe now accurately tests declared-length admission: it declares the same
oversized length on a dedicated connection without uploading the rejected body,
and requires a complete actual 413 and `no-store` at both boundaries. The direct
API must also return the exact safe JSON error with its server request ID;
Nginx's existing HTML error response remains unchanged. Real raw-body and
signature-preservation checks still send and verify their payloads.

Two distinct actual-listener regressions use the existing handshake's eight KiB
route limit. One declares 8,193 bytes without sending them; the other sends
8,193 actual bytes using chunked encoding without a `Content-Length`. Both
require a complete 413, safe JSON and `no-store`. The focused service/gateway
cohort passed all 46 cases, and independent review passed. No production limit,
route, TLS verification or error policy changed. Bounded transport diagnostics
now distinguish request errors and response completeness without recording
headers or bodies. Resets never count as a 413, and no retry was added.

A fresh complete stack rerun and final hosted checks are still required.

The first focused service-contract attempt passed four pure cases and failed 28
cases at service startup. The future OpenAPI schemas had entered Fastify's AJV
registry, where the OpenAPI boolean `exclusiveMinimum` is a different dialect
from executable JSON Schema. The future schemas now reside directly in Swagger
components and are not registered as route validators. The unchanged existing
service route schemas retain their original validation owner.

After that correction, the same focused file passed all 32 cases:

```sh
node node_modules/vitest/vitest.mjs run --project unit tests/unit/api/service-contracts.test.ts
```

The case covering generated OpenAPI checks the independent navigation/native
versions, published bounds and all four decision variants. The existing cohort
also verifies unchanged service availability, current body limits and the 404
status of future inventory routes. This focused run does not establish final
navigation-schema or image-admission coverage.

Existing service-contract tests own OpenAPI integration and the continued absence
of executable future routes. Existing task-journey, authentication and page-context
tests own local projection compatibility. The assigned navigation and static-PNG
contract tests own distinct malformed, stale, unknown-reference and encoded-budget
regressions. The final combined cohort includes 12 navigation-contract cases and
10 static-PNG cases. The latter preserve the legacy permissive OCR admission,
errors and four MiB/four-megapixel limits while testing the separate strict PNG
profile. The exact 24,000-byte projected envelope passes; one additional metadata
byte fails. All four decision variants reject changed generations and native
identities, and server time cannot extend the original browser deadline.

## Evidence limits

This milestone establishes a schema and validation boundary. Live model
inference, provider cancellation, actual image masking and capture consent,
cross-browser cloud transport, navigation quality and future desktop-native
permissions remain separate work. Earlier signed-in or native identity evidence
does not prove those capabilities. Screen-reader checks and full release
certification are not claimed by pure or HTTP contract checks.
