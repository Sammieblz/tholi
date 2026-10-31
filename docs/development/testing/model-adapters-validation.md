# Model adapter validation

Owner: [issue #39](https://github.com/Sammieblz/tholi/issues/39). Setup, exact
configuration and approval semantics are in the [operator guide](../service-models.md).
This is implementation and PR feedback, not a release certification or paid
experiment authorization. Extension/API 0.11.0 and website 0.1.1 remain unchanged.
Ordinary service/Compose remains fake-only; browser transmission belongs to #40.

## Ownership and admission

The existing API [navigation application](../../../apps/api/src/application/navigation.ts)
uses the shared observation and decision join. The [model contract](../../../apps/api/src/application/model-contracts.ts)
defines bounded proposals, usage and safe failure classes. A deterministic
[fake](../../../apps/api/src/adapters/fake-navigation-model.ts) and
[Vertex adapter](../../../apps/api/src/adapters/vertex-navigation-model.ts) extend
that boundary without starting legacy local NLP/OCR workers.

The [operator entrypoint](../../../apps/api/src/model-experiment.ts) requires an
exact input hash, explicit data/spending approval, expiry, conservative maximum
reservation and durable exclusive approval claim for live use. Fresh credentials
and an immediate approval guard precede both CountTokens and generation. Tests
inject credentials and HTTP responses; no actual model call is implied.

Permanent regressions remain with the existing API test owners:

| Owner                                            | Distinct behavior                                                                                                                     |
| ------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| `tests/unit/api/config.test.ts`                  | Fake defaults, explicit experiment configuration, lower-only limits and ordinary-service isolation                                    |
| `tests/unit/api/navigation-contracts.test.ts`    | Shared navigation contract and reference admission                                                                                    |
| `tests/unit/api/navigation-model.test.ts`        | Deterministic eligible proposals, mutation/stale-context refusal, deadline/cancellation and trustworthy usage                         |
| `tests/unit/api/vertex-navigation-model.test.ts` | Exact v1 hosts/wire, admitted PNGs, bounded reads, credential/send guards, count admission, safe provider failures and measured usage |
| `tests/unit/api/model-experiment.test.ts`        | Single-use concurrent claims, exact approvals, ceiling reservation, unknown-outcome handling and lazy bounded ADC                     |

No frozen corpus, task oracle, public contract identifier, host grant or journey
authority is changed by this feedback. Proposal acceptance is not task arrival.

## Fresh focused cohort

Run `6364c926-ea98-45dd-83d2-7b01ab06a1f1` passed **207/207** across five owners:
configuration 84, navigation contracts 19, navigation model 20, Vertex adapter 56
and experiment 28. It includes the conservative input-ceiling reservation and
unknown-versus-reported usage corrections.

Report:
`output/qa/model-39-final-focused/6364c926-ea98-45dd-83d2-7b01ab06a1f1/unit.json`,
SHA-256 `b8efad7a2eebe6808ac5da5d7fad8e20447bb3bf924772bbbcf62748174abedf`.

These focused tests import current source from the modified worktree based on
`df80cf602799cf69b759dfec1bec40bbca7af017`. Their report retains the preceding
Chromium build digest `d684b89d75f745a3d5cec1ac0a985e879976d0b752e653442f814fb09d3d8ab1`.
That digest is not a newly built #39 artifact and does not certify this source.
Fresh production build, complete local CI and exact-head hosted checks remain
separate gates.

Fresh whole-project `typecheck`, including the version consistency check, passed.
Log: `output/qa/model-39-typecheck/3c2e0ea2-7c86-4ff0-b464-151c836927d1/typecheck.log`,
SHA-256 `e4fd22a4087c56ad6fb9e8123fb903426d33c3129c2b1b54860112ed5d3c584b`.

## Production build and complete local PR gate

The production build passed, including both extension targets, website, API and
browser fixtures. Its manifest SHA-256 is
`6f39874f2e0d9fc3bf581956e5717cd5cda574e9465b939b9cbdefaae8b9ad9e`.
No release archives were produced.

Complete PR cohort `2015195a-ac0c-4e68-9a2f-c58f163842f2` passed **990/990**:
854 unit, 47 core, 20 integration, 2 installed Firefox and 67 UI/website cases.
The coordinator verified the immutable prepared build before running every group.
Chromium digest: `b97bd2b21c4861150f8c962511f88466f4b04df646787c0aa1ea317c7b034413`.
Firefox digest: `60981684dd5bc7fd2f9993e085922136d6d2d01b8d4a1e8c144d29e490d9741d`.
All eight reports are preserved under
`output/qa/model-39-ci/2015195a-ac0c-4e68-9a2f-c58f163842f2/reports/`.
Their summary SHA-256 is
`82abc3900c8875860616a636f03144340090a9f03815be51126b9fb2ee4a75d9`.

The first complete attempt, `95741400-7370-4360-95fb-b6bb2005104b`, stopped
at 853/854 unit cases after an existing real-HTTP authorization test exceeded
5,000 ms. Its failure remains preserved. The unchanged authorization owner then
passed 17/17 in isolated run `477fd113-8e6f-4188-8621-5ce17e921406` and passed
again in the fresh complete cohort. No timeout or security assertion was weakened.
A subsequent import-only fixture cleanup passed 19/19 navigation contracts in
`7c178191-070f-4ec4-a847-e5f2bb5b07e8`; compiled artifacts were unchanged.

## Synthetic experiment preparation

The built fake CLI admitted a synthetic privacy-policy request without credential
lookup or remote inference. Run: `c093eafe-70e1-4740-acb9-8374fae30716`;
report: `output/qa/model-39-live/fake-report-utf8.json`. Its exact input SHA-256 is
`4566f2be776d2a57cbd7a1857a1ebc0b8b2f5d540e17687892e27958a257780c`.
It reuses `tests/fixtures/vision/light.png`, a synthetic 640 by 180 image with
the text "Deploy website" and "Privacy policy". It contains no real browser data
and grants no browser authority.

Read-only development-project checks returned `DURABLE` caching and no publisher
model logging configuration for the proposed global model profile. Google's
[logging documentation](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/capabilities/request-response-logging)
defines that configuration's `404 NOT_FOUND` as default-disabled request/response
logging. This does not establish disabled abuse monitoring or zero retention.
The actual text/image experiment remains unrun, pending separate approval of
the synthetic data and a bounded spending allowance. A monthly project cap does
not supply that experiment approval.

## Earlier feedback retained separately

The earlier cohorts below preceded the final reservation/usage corrections.
They remain historical feedback, without relabeling them as final-source checks.
Each report is under `output/qa/AREA/RUN/unit.json`.

| Area                  | Run                                    | Actual result                                           | Report SHA-256                                                     |
| --------------------- | -------------------------------------- | ------------------------------------------------------- | ------------------------------------------------------------------ |
| `model-39-focused`    | `b06ff90d-ba48-495c-ac60-481f057c9891` | 36/37, safe-error usage regression failed               | `52f017d970117261948ff02651e8177ab7db6fc097bba8d23bf44dea68c0eb42` |
| `model-39-focused`    | `a62edcca-4c75-41d1-b775-b8d0a46b81be` | 37/37 passed                                            | `eac5e8554d1ee931e9a5f12fb630ced577b9a454a63a2593782878a7760f4b56` |
| `model-39-focused`    | `880b3006-5c90-4ec9-ade7-4df97f829ecc` | 53/54, invalid-observation no-egress regression failed  | `7659adedd44aa8dfbc98812ed213f1529518dcd6b0b44ae889b31a37a59ee8fd` |
| `model-39-focused`    | `b076e5c7-519c-4f69-bc61-8173a73f9ec1` | 54/54 passed                                            | `68fc371bbb0c921a50528928b4574d7b3c22951671ede1c646fc9602c60b79cd` |
| `model-39-focused`    | `33af9837-af34-4981-8d10-6e12e3eb1b6a` | 56/56 passed after adding final-send guard cases        | `0d3a721ad096e51d1af8a8fa34e6f0da543e926fd074cb3ca971855b279e336f` |
| `model-39-experiment` | `a7385983-2238-46bc-aaac-fed3e92341c5` | 111/112, approved usage/durable-record assertion failed | `ab1cdd9c8cb92e57c35e15fb8a2ee042de6242a9ffe98b9f9d5e96269608448b` |
| `model-39-experiment` | `57d3f2a0-d025-4fd4-a54c-3497854951f3` | 112/112 passed                                          | `17104bbb8ddde7da80b87256df7db44d43f1fe847ee2e1e08784c5d05f2a6643` |

Invocation `17a89b15-0c4e-49e8-8ad4-55cfe2821806` exited 1 after 497 ms.
Its report is a byte-identical copy of the `a62edcca` report with that earlier
internal run ID. It is excluded as fresh passing evidence; its failed timing and
copied artifact are preserved.

## Remaining gates

| Gate                                                    | Status at this source snapshot                                                                      |
| ------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Fresh whole-project typecheck and version check         | Passed; log and hash above                                                                          |
| Fresh production build                                  | Passed; manifest and target digests above                                                           |
| Complete local `test:ci`                                | Passed 990/990 in the fresh complete cohort                                                         |
| Exact-head hosted checks                                | Required before merge; pending                                                                      |
| Live text/image structured-output experiment            | Not run; requires reviewed input, verified ADC/configuration and explicit bounded spending approval |
| Actual project retention, model access and billed usage | Default cache/logging settings reviewed above; live model access and billed usage remain unverified |
| Fresh held-out navigation quality                       | Separate #43 work; not inferred from accepted proposal fixtures                                     |
| Production credits and quota reconciliation             | Separate #44 work; operator claims are not account credits                                          |
| Release, packaging or deployment                        | Not performed or authorized by this record                                                          |

Reviewable final-source results belong on issue #39 and its pull request. Preserve
earlier failed attempts when recording later success. Fake or injected provider
responses cannot establish real endpoint compatibility, residency, zero retention,
cost or user outcomes.
