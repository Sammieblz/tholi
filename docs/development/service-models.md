# Service model adapters

Operator guide for [issue #39](https://github.com/Sammieblz/tholi/issues/39).
The deterministic fake and an explicitly approved Vertex experiment share one
application contract. Ordinary HTTP/Compose startup remains fake-only until
the browser transmission and consent milestone. This guide does not enable cloud
navigation, certify model quality or authorize a paid call. Recorded checks and
remaining gates are in the [validation record](testing/model-adapters-validation.md).

## Local default and ownership

Normal development uses a deterministic fake and the existing
[local stack](local-stack.md). It requires no provider credentials or remote
inference. Provider configuration belongs to the API's composition/configuration
boundary; cloud SDKs and authentication stay in adapters. The application-facing
model contract accepts bounded sanitized observations and returns validated
proposals plus content-free usage. It does not provide browser or OS authority.

The existing [navigation application](../../apps/api/src/application/navigation.ts)
validates observations and joins proposals against the retained references. The
[model contract](../../apps/api/src/application/model-contracts.ts),
[configuration](../../apps/api/src/config.ts) and
[operator entrypoint](../../apps/api/src/model-experiment.ts) own admission;
[Vertex](../../apps/api/src/adapters/vertex-navigation-model.ts) and
[ADC](../../apps/api/src/adapters/google-model-auth.ts) remain adapters. The legacy
SQLite/private API retains its local NLP/OCR behavior and public protocol.
Selecting a service model must not eagerly start its local model workers.
Browser transmission/consent is [#40](https://github.com/Sammieblz/tholi/issues/40);
integration with the single journey owner is
[#41](https://github.com/Sammieblz/tholi/issues/41). An adapter alone does not
enable either capability.

## Reviewed provider profile

Official sources reviewed on 2026-10-30 describe `gemini-3.8-flash` with text/image
input, structured output, GenerateContent and CountTokens support. Its supported
thinking levels are `LOW`, `MEDIUM` and `HIGH`; `MINIMAL` is invalid. These are
documented capabilities, not proof that Tholi's configured project can use them.
See [Google's model reference](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/gemini/3-8-flash).

The adapter uses the reviewed v1 wire profile. The official
[API Discovery document](https://raw.githubusercontent.com/googleapis/discovery-artifact-manager/master/discoveries/aiplatform.v1.json)
defines `generationConfig.responseFormat` as an array; structured text uses
`text.mimeType: APPLICATION_JSON` and a schema. Older response-format fields are
deprecated. A tutorial or an older SDK example is not a substitute for validating
the selected wire shape. Retain the reviewed API/schema configuration with each
experiment rather than following a moving model alias silently.

| Location profile | Google endpoint host                       |
| ---------------- | ------------------------------------------ |
| `global`         | `https://aiplatform.googleapis.com`        |
| `us`             | `https://aiplatform.us.rep.googleapis.com` |
| `eu`             | `https://aiplatform.eu.rep.googleapis.com` |

Use an explicitly configured project, exact model and reviewed location. General
endpoint availability does not prove model availability in every listed region.
Google distinguishes global and multi-region routing and cautions that an
endpoint name alone does not establish every residency guarantee. Validate the
chosen service's actual policy before sending data. See
[deployments and endpoints](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/locations).

Credentials remain server-side. Google's
[Application Default Credentials guidance](https://docs.cloud.google.com/docs/authentication/provide-credentials-adc)
distinguishes local, container and attached-service-account setup; a CLI login is
not automatically the application's ADC configuration. Do not place credentials
in extension assets, website configuration, URLs, logs or committed files.

## Admission and configuration

The existing observation/image limits still apply: 24,000 UTF-8 projection bytes,
one masked PNG within 2 MiB and four megapixels, and the encoded envelope bound.
Masking and native capture provenance remain owned by the
[existing capture pipeline](testing/masked-capture-validation.md). A provider's
larger input allowance does not raise these application limits.

Provider-specific configuration must additionally bound input tokens, generated
tokens, response bytes, deadline, concurrency and total approved cost. It must
reject malformed, oversized, expired, unknown-reference or semantically invalid
output rather than accepting arbitrary selectors, tools, actions or completion
claims. Cancellation and uncertain provider outcomes must remain explicit; an
aborted caller does not prove that an executing request was unbilled.

The experiment parser is `parseModelExperimentConfig` in the existing config
owner. Its settings are separate from ordinary service/Compose startup, which
continues to reject a live provider until the transport/consent milestone.

| Environment variable               | Value                                                                           |
| ---------------------------------- | ------------------------------------------------------------------------------- |
| `THOLI_MODEL_PROVIDER`             | `fake` by default; explicit experiment provider `vertex`                        |
| `THOLI_MODEL_API`                  | Required for live: `v1`                                                         |
| `THOLI_MODEL_PROJECT`              | Explicit approved Google Cloud project                                          |
| `THOLI_MODEL_REGION`               | Reviewed location: `global`, `us` or `eu`                                       |
| `THOLI_MODEL_ID`                   | Required for this live profile: `gemini-3.8-flash`                              |
| `THOLI_MODEL_RETENTION_PROFILE`    | `provider-default-acknowledged`; acknowledgement is not verified zero retention |
| `THOLI_MODEL_EXPERIMENT_STATE_DIR` | Required for live: absolute, durable operator-state directory                   |

The following integer settings may lower their limits, not raise them:

| Environment variable             |                Default and maximum |
| -------------------------------- | ---------------------------------: |
| `THOLI_MODEL_MAX_INPUT_TOKENS`   |                              32768 |
| `THOLI_MODEL_MAX_OUTPUT_TOKENS`  |                               2048 |
| `THOLI_MODEL_MAX_RESPONSE_BYTES` |                              32768 |
| `THOLI_MODEL_MAX_IMAGES`         |            1; zero disables images |
| `THOLI_MODEL_MAX_IMAGE_BYTES`    |                            2097152 |
| `THOLI_MODEL_MAX_IMAGE_PIXELS`   |                            4000000 |
| `THOLI_MODEL_TIMEOUT_MS`         | Default 20000; range 1000 to 25000 |

## Operator experiment

After `npm run build:api`, the entrypoint is:

```sh
npm run model:experiment -- --input FILE [--approval FILE]
```

The default is `fake`, with no ADC lookup or network call. The input is a strict
JSON object with `version: 1`, `observation` and `validation`. It is a regular file
bounded to 4 MiB plus 64 KiB. The latter fields must satisfy the shared
[navigation observation and validation contracts](../architecture/navigation-contracts.md).
Use an explicitly reviewed synthetic/public fixture; plausible native-looking
identifiers in a fixture do not establish browser authority.

Live experiments require all live configuration above and `--approval FILE`.
The approval is a regular JSON file of at most 8,192 bytes. Every field below is
required; extra fields are rejected. Its literals record explicit approval of
the exact data and spending, rather than permission inferred from credentials.

| Field              | Required value or constraint                                                        |
| ------------------ | ----------------------------------------------------------------------------------- |
| `version`          | `1`                                                                                 |
| `id`               | Fresh UUID, consumed once                                                           |
| `approvedAtMs`     | Nonnegative safe integer Unix milliseconds, no later than now                       |
| `expiresAtMs`      | Positive safe integer, after now and approval time, at most one hour after approval |
| `approvedData`     | `true`                                                                              |
| `approvedSpending` | `true`                                                                              |
| `inputSha256`      | Exact input-file bytes, 64 lowercase hexadecimal characters                         |
| `api`              | `v1`                                                                                |
| `project`          | Exact configured project, matching `^[a-z][a-z0-9-]{4,28}[a-z0-9]$`                 |
| `location`         | Exact configured `global`, `us` or `eu`                                             |
| `model`            | `gemini-3.8-flash`                                                                  |
| `retentionProfile` | `provider-default-acknowledged`                                                     |
| `maxCostUsdMicros` | Positive integer, no more than 10,000,000 microdollars ($10)                        |
| `priceRevision`    | `vertex-3.8-standard-2026-10-31`                                                    |

Changing even input whitespace invalidates its hash. The configured project,
API, location, model and retention profile must match the approval exactly.
The reviewed price profile refuses live calls on or after January 1, 2027 UTC.
Refresh its source review and implementation before that cutoff.

Use the same durable `THOLI_MODEL_EXPERIMENT_STATE_DIR` across invocations and
replicas that share this operator's approvals. Symlink aliases are rejected.
Exclusive creation of `ID.jsonl` consumes the approval before network use, and
claim, reservation and final-result records are appended and synced. Protect the
directory with operating-system permissions. Do not erase claims or select a
fresh directory to retry an approval. Failed or uncertain attempts require a
new approval and review of the prior outcome.

The adapter obtains credentials, rechecks the approval and sends CountTokens.
Over-budget counts prevent generation. Before generation, the operator durably
reserves the conservative price of the configured input and output ceilings,
not just the count estimate. It then obtains fresh credentials and rechecks
expiry, approval-file bytes, cancellation and deadline immediately before the
generation send. Both sends have their own final guard. There is no automatic
generation retry. This per-experiment store does not implement the production
account quota, credits or reconciliation ledger required by #44.

Operator credentials use ADC through the pinned server authentication dependency;
no client API key is involved. The live profile must fail closed if required
configuration, approved data or a bounded allowance is missing. Ordinary CI must
not use live credentials or make paid requests. Cloud project and billing setup
alone do not establish successful inference, retention configuration or permission
to send a particular observation.

The command writes one JSON report to stdout and exits unsuccessfully when no
proposal is admitted. The report includes run/configuration identity, input
hash, allowance, reservation, elapsed time, safe outcome/error and any validated
usage/cost estimate. It excludes goals, page text, image bytes and raw provider
replies. `accepted: true` means schema/reference admission only. It does not
establish task arrival, useful navigation or model quality. `unknown` outcomes
must not be reported as zero cost; `not-sent` describes generation dispatch,
and does not assert that no credential or CountTokens request occurred.

## Retention and data handling

Google's training restriction does not establish zero retention. Its current
documentation describes default implicit in-memory and durable caching, each
retained for no more than 24 hours, plus abuse-monitoring and advanced-feature
exceptions. Request/response logging can also be enabled at project/model level.
Caching controls require actual project configuration and appropriate IAM; an
application flag or missing cache handle does not prove that caching is off.
See [Google's retention guidance](https://docs.cloud.google.com/gemini-enterprise-agent-platform/resources/zero-data-retention).

Before a live experiment, record the actual project settings and applicable
terms. Do not claim verified zero retention, residency or disabled training from
an adapter's configuration alone. Keep provider tools, web grounding, stored
conversations and unrelated data paths outside the navigation request. Tholi's
own routine telemetry must exclude goals, page text, images, credentials and raw
provider responses; measured token totals and safe failure classes are separate
from retained prompt data.

## Pricing and bounded experiments

The reviewed standard on-demand USD rates for this model are:

| Location   | Input per million tokens | Output per million tokens |
| ---------- | -----------------------: | ------------------------: |
| Global     |                    $1.50 |                     $7.50 |
| Non-global |                    $1.65 |                     $8.25 |

Google advertises introductory effective global rates of $0.75/$3.75 through
December 31, 2026, with standard rates starting January 1, 2027. The promotion uses
credits back; admission must not assume that later credits have already reduced
the charge. Thinking tokens are billed as output. Review the selected SKU and
current terms before a call; this is not a Tholi subscription-price promise.
See [Google's pricing](https://cloud.google.com/model-garden/pricing).

The implementation uses price revision `vertex-3.8-standard-2026-10-31` and rounds
estimates upward to integer USD microdollars. At the default token ceilings, the
generation reservation is 64,512 microdollars globally or 70,964 for `us`/`eu`.
Thinking tokens count toward the output ceiling and measured cost. Account for all attempts and uncertain
completion; do not automatically retry a possibly billed generation or report an
unknown charge as zero. Provider usage metadata is measured usage, not a billing
invoice. Durable cross-account quotas, credit policy and reconciliation belong
to [#44](https://github.com/Sammieblz/tholi/issues/44), using the existing ledger.

A limited live experiment requires approved synthetic/public input, an exact
project/model/API/location, verified retention settings, working server
credentials, a maximum call/token/image allowance and a spending ceiling. Keep
the result content-free and record the build, prompt/schema/capture policy,
price assumptions, token totals, latency, outcome and any unresolved charge.
This guide does not establish dataset approval or spending authorization.

## Validation record

| Evidence                                                                   | Current status                                                                                                         |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| Official provider capability, endpoint, auth, pricing and retention review | Reviewed profile exercised; actual default cache/logging settings recorded                                             |
| Deterministic fake, adapter, configuration and operator regressions        | Fresh focused 207/207 pass; earlier failures retained in the validation record                                         |
| Fresh whole-project types and version check                                | Passed; linked validation record retains the log hash                                                                  |
| Fresh production build and complete CI                                     | Passed production build and 990/990 complete local PR cases                                                            |
| Actual multimodal and structured-output experiment                         | One approved synthetic call passed, API v1 / Gemini 3.8 Flash / global                                                 |
| Provider usage and project retention                                       | Measured 2,525 tokens; standard-rate estimate $0.005012; settled bill unverified; default caching and logging recorded |
| Complete local and final-head hosted PR gates                              | Required through the repository's existing process                                                                     |

The approved experiment and full evidence are in the
[validation record](testing/model-adapters-validation.md#approved-live-compatibility-result).
Its $0.02 single-use approval is consumed. Further live calls require their own
reviewed data and spending authorization. Endpoint compatibility does not
establish navigation quality or task arrival.

Attach fresh exact-source evidence to issue #39 and its pull request. Documentation
review, fake tests and provider documentation do not certify live quality or
billing, and neither PR evidence nor a live experiment replaces full release
certification or release authorization.
