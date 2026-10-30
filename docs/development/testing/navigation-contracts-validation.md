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
The production build, complete `test:ci` and exact-head hosted PR checks remain
pending. No artifact digest or previous milestone's run is claimed as current
evidence.

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
